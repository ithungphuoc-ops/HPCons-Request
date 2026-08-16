## Context

Hiện trạng đã xác nhận qua khảo sát (không phải giả định):

- `app/request/list/page.tsx:124-126,144-146` và `components/request/RequestDetailView.tsx:241,404` hiện cứng dùng `request.groupNameSnapshot` (tên NHÓM) làm tiêu đề hiển thị — mọi đề xuất cùng nhóm hiện trùng tên.
- Quy ước đúng (ưu tiên field có `code` thuộc `TITLE_FIELD_CODES = ["ten_de_xuat","ten_de_nghi","ten_phieu","ten_dang_ky"]`, fallback tên nhóm nếu rỗng) đã tồn tại và hoạt động ở 3 nơi: `lib/print-template.ts:94,251-259` (hàm `resolveNameValue`, dùng khi in .docx), `app/api/requests/[id]/export/route.ts:108-111` (đặt tên file xuất), `lib/qlkctr-sync.ts:15,61` (webhook) — nhưng đây là **3 bản copy độc lập** của cùng 1 hằng số.
- Field kiểu `"formula"` (`lib/types.ts:51,73,91`) là placeholder rỗng — `AddFieldModal.tsx:315-325` chỉ cho gõ 1 chuỗi tự do không ai đọc lại, `submit/page.tsx:717-722` hiện "chưa được hỗ trợ" khi gặp field này. Không dùng làm nền được.
- Cú pháp `${code}` cho việc điền dữ liệu vào file .docx dùng thật qua thư viện `docxtemplater` (`lib/server/print-engine.ts:4,206,364`, `delimiters: { start: "\${", end: "}" }`) — đây là engine xử lý file .docx (thao tác trên cấu trúc XML/pizzip), **không phải 1 hàm thay thế chuỗi thuần tuý** có thể import thẳng cho input là 1 chuỗi JS bình thường.
- Cơ chế "theo dõi field liên quan để tránh tính lại thừa" đã có cho phần preview người duyệt (`submit/page.tsx:96-107`, biến `conditionFieldIds`/`relevantValuesKey`) — build 1 `Set<field.id>` từ mọi `code` field được tham chiếu, dùng làm dependency key cho `useEffect`.
- `ConditionGroup`/`evaluateConditionGroup` (từ change `extend-condition-rules`, đã archive) là cơ chế điều kiện dùng chung hiện có, đánh giá AND/OR dựa trên giá trị field khác.

## Goals / Non-Goals

**Goals:**
- Sửa danh sách + trang chi tiết hiện đúng tên riêng từng đề xuất (không phải tên nhóm) — gộp `TITLE_FIELD_CODES` về 1 nơi dùng chung.
- Cho phép 1 field kiểu `short_text`/`paragraph` tự tính giá trị từ mẫu chuỗi `${code}` + điều kiện nhánh (tái dùng `ConditionGroup`), KHÔNG đổi `dataType` của field đó.
- Giá trị tính ra được LƯU BÌNH THƯỜNG vào `values[field.id]` giống hệt field gõ tay — để mọi nơi đang đọc field này (in ấn, xuất file, webhook, tìm kiếm) không cần sửa gì, tự động "thấy" giá trị đúng.
- Form Gửi đề xuất tự tính lại real-time, không cần bấm nút.
- Máy chủ (server) tự tính lại giá trị field computed tại thời điểm gửi chính thức, KHÔNG tin giá trị client gửi lên cho field này — để tránh giả mạo/giá trị cũ.

**Non-Goals:**
- Không làm công thức TOÁN HỌC (cộng/trừ/nhân/chia số) — đây vẫn là phạm vi (chưa làm) của dataType `"formula"`, đổi tên/định nghĩa lại khác hẳn, không đụng trong change này.
- Không cho phép 1 field computed tham chiếu tới field computed KHÁC (không có chuỗi tính toán nhiều tầng/đệ quy) — chỉ tham chiếu field "thường" (đã có giá trị nhập tay hoặc chọn). Tránh vòng lặp vô hạn/phụ thuộc vòng tròn.
- Không làm cây điều kiện toán tử ngày tương đối, không làm UI kéo-thả sắp xếp thứ tự nhánh phức tạp — danh sách nhánh chỉ cần thêm/xoá/sửa tuần tự, đánh giá từ trên xuống, nhánh đầu tiên khớp thắng.

## Decisions

### 1. Tên & cấu trúc thuộc tính mới trên `ProposalField`

```ts
export interface ComputedTemplateBranch {
  /** Không có = nhánh mặc định (luôn khớp) — nên đặt cuối danh sách. */
  condition?: ConditionGroup;
  /** Cú pháp ${code} — tái dùng ĐÚNG delimiter với file in .docx cho nhất
   * quán trực giác, nhưng bộ máy thay thế là hàm MỚI viết riêng (xem Decision 3),
   * không phải docxtemplater (thư viện đó xử lý file .docx, không nhận input
   * là 1 chuỗi JS thuần). */
  template: string;
}

export interface ComputedFieldConfig {
  branches: ComputedTemplateBranch[];
}
```
Thêm vào `ProposalField`: `computedFrom?: ComputedFieldConfig;`

**Vì sao không gộp vào `formula`:** `formula` hiện diện diện cho dataType RIÊNG (đổi cả loại field) — nếu tái dùng, bắt buộc đổi `dataType` của "Tên đề xuất" từ `short_text` sang `formula`, phá vỡ giả định "field này là văn bản thường" ở mọi nơi khác đang đọc nó (in ấn, xuất file, webhook, `TITLE_FIELD_CODES`...). `computedFrom` là thuộc tính CỘNG THÊM, độc lập với `dataType` — field vẫn `short_text` y hệt trước, chỉ thêm hành vi tự tính.

### 2. Hàm thay thế mẫu chuỗi — viết MỚI, nhẹ, KHÔNG dùng docxtemplater

```ts
// lib/server/computed-fields.ts (file mới)
export function resolveTemplate(
  template: string,
  values: Record<string, unknown>,
  fields: ProposalField[],
): string {
  return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (match, code) => {
    const field = fields.find((f) => f.code === code);
    if (!field) return match; // giữ nguyên "${code}" nếu không tìm thấy — dễ debug hơn là xoá trắng
    const raw = values[field.id];
    return raw === undefined || raw === null ? "" : String(raw);
  });
}

export function resolveComputedValue(
  config: ComputedFieldConfig,
  values: Record<string, unknown>,
  fields: ProposalField[],
): string | null {
  for (const branch of config.branches) {
    if (!branch.condition || evaluateConditionGroup(branch.condition, values, fields)) {
      return resolveTemplate(branch.template, values, fields);
    }
  }
  return null; // không nhánh nào khớp — field cho gõ tay bình thường
}
```
Đặt cùng thư mục `lib/server/` như `conditions.ts` (không import `"server-only"`, để unit test + client component gọi thẳng được, đúng khuôn mẫu `conditions.ts` đã dùng).

**Field bị xoá/đổi mã trong template:** giữ nguyên chuỗi `${code}` không thay thế (khác với `evaluateConditionGroup` — ở đó field thiếu coi là "không thoả", còn ở đây không có khái niệm true/false, nên chọn cách AN TOÀN NHẤT: hiện rõ "${code}" bị lỗi thay vì âm thầm xoá trắng, giúp admin phát hiện cấu hình hỏng ngay khi nhìn form thay vì tưởng nhầm là bug khác).

### 3. Render trên form Gửi đề xuất: field có `computedFrom` → luôn tính lại, khoá không cho gõ tay khi có nhánh khớp

```
Mỗi lần values đổi (field nguồn thay đổi)
        │
        ▼
resolveComputedValue(field.computedFrom, values, group.fields)
        │
   ┌────┴────┐
   ▼         ▼
 null    chuỗi kết quả
   │         │
   ▼         ▼
cho gõ    tự set vào values[field.id],
tay như   input hiển thị readOnly + nền xám
cũ (chưa
đủ dữ
liệu để
tính)
```
Tái dùng đúng mẫu `conditionFieldIds`/`relevantValuesKey` đã có (`submit/page.tsx:96-107`) — nhưng tổng quát hoá thành 1 Set gộp CẢ field làm điều kiện approver-step LẪN field được tham chiếu trong mọi `computedFrom` đang hoạt động của nhóm, để không tính lại/re-render thừa khi gõ ở field không liên quan.

### 4. Máy chủ PHẢI tự tính lại, không tin giá trị client gửi lên

Tại `lib/server/requests.ts` (chỗ validate/lưu khi gửi chính thức): với mọi field có `computedFrom`, ghi đè `values[field.id]` bằng kết quả `resolveComputedValue(...)` tính trên SERVER trước khi lưu — bất kể client gửi gì lên. Lý do: field readonly ở UI không ngăn được request API giả mạo trực tiếp; tính lại ở server đảm bảo giá trị luôn đúng và nhất quán, giống triết lý "không tin client" đã áp dụng cho `visibleWhen`/`findMissingRequiredFields`.

### 5. Gộp `TITLE_FIELD_CODES` + áp dụng cho danh sách/chi tiết

Tạo `lib/request-title.ts` (file mới, dùng chung):
```ts
export const TITLE_FIELD_CODES = new Set(["ten_de_xuat", "ten_de_nghi", "ten_phieu", "ten_dang_ky"]);

export function resolveRequestTitle(request: {
  fieldsSnapshot: ProposalField[];
  values: Record<string, unknown>;
  groupNameSnapshot: string;
}): string {
  for (const field of request.fieldsSnapshot) {
    if (field.code && TITLE_FIELD_CODES.has(field.code)) {
      const raw = request.values[field.id];
      const value = raw === undefined || raw === null ? "" : String(raw).trim();
      if (value) return value;
    }
  }
  return request.groupNameSnapshot;
}
```
`lib/print-template.ts`, `app/api/requests/[id]/export/route.ts`, `lib/qlkctr-sync.ts` đổi sang import hàm này thay vì giữ bản copy riêng. `app/request/list/page.tsx` và `RequestDetailView.tsx` gọi hàm này thay vì đọc thẳng `groupNameSnapshot`.

## Risks / Trade-offs

- **[Risk] Vòng lặp phụ thuộc nếu lỡ cấu hình field A computed-từ-B, B computed-từ-A** → Mitigation: Non-Goal đã chặn (field computed không được tham chiếu field computed khác) — cần validate ở API lưu nhóm: nếu `template` của field X chứa `${code}` mà `code` đó thuộc 1 field cũng có `computedFrom` → từ chối lưu, báo lỗi rõ.
- **[Risk] Nhánh không khớp cái nào, và field đó `required=true`** → hành vi giữ nguyên cho gõ tay (theo Decision 3) — nhưng cần xác nhận: có nên tự động BẮT BUỘC nhập tay khi không nhánh nào khớp, hay để field đó vẫn optional? (giữ theo `required` gốc của field, không đổi gì thêm — nhất quán với field thường).
- **[Risk] Giá trị nguồn rỗng khi tính (VD Số hợp đồng chưa nhập, Tên công trình có) → mẫu ra "` -ctr1`" hoặc "`123-`"** → chấp nhận được ở bản đầu (không chặn tính một phần) — hiển thị đúng những gì có, admin/người dùng tự thấy thiếu phần nào qua chuỗi bị hụt.
- **[Trade-off] Không dùng lại được `docxtemplater`** cho việc thay thế chuỗi thuần — chấp nhận viết hàm mới nhẹ (Decision 2), vì dùng đúng thư viện xử lý .docx cho input là chuỗi JS thường là sai công cụ, không tiết kiệm được gì mà còn phức tạp hoá.
- **[Risk] Field bị xoá mã vẫn còn `${code}` cũ trong template field khác** → giữ hành vi "an toàn hiện rõ lỗi" (Decision 2) thay vì âm thầm sai — nhưng nên thêm validate khi lưu nhóm (tương tự `validateConditionGroupFieldCodes`) để cảnh báo SỚM lúc cấu hình, không đợi tới lúc gửi đề xuất mới phát hiện.
