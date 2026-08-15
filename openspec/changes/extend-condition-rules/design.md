## Context

`ConditionRule` (`lib/types.ts:97-111`) là kiểu dữ liệu điều kiện dùng chung hiện tại — 1 object `{ fieldCode, operator: "equals"|"not_equals"|"includes", value: string }`, được đánh giá bởi `evaluateCondition()` (`lib/server/conditions.ts:12-30`) và tái dùng ở 3 nơi: `field.visibleWhen` (ẩn/hiện field trên form), `approverStep.condition` (bước duyệt có điều kiện), `followersConditional[].condition` (người theo dõi có điều kiện).

Thiết kế gốc (change `add-base-vn-group-settings-parity`) cố tình giới hạn 1 field/1 điều kiện và chỉ nhận field kiểu rời rạc (`single_choice`/`multiple_choice`/`department_select`, xem `CONDITION_ELIGIBLE_TYPES` tại `components/request/ApproverStepsEditor.tsx:44`) làm trigger — lý do nêu trong design.md gốc: "chưa có bằng chứng Base.vn thật cần điều đó". Nhu cầu thực tế hiện nay (field thanh toán cần nhiều điều kiện kết hợp, cần lọc theo ngưỡng giá trị đơn hàng) vượt qua giới hạn này.

Có 3 nơi gọi `evaluateCondition`/`filterApplicableSteps`/`mergeFollowers` từ bên ngoài `lib/server/conditions.ts` (`submit/page.tsx:141`, `lib/server/requests.ts:57,248,295`, `app/api/requests/route.ts:271-277`, `app/api/requests/[id]/route.ts:158`) — tất cả chỉ gọi hàm, không đọc trực tiếp field bên trong `ConditionRule`, nên đổi cấu trúc rule không đòi hỏi sửa các nơi này.

## Goals / Non-Goals

**Goals:**
- Cho phép kết hợp nhiều điều kiện (AND/OR) cho 1 field/bước duyệt/người theo dõi.
- Cho phép dùng field kiểu số (`integer`/`decimal`/`currency`) và `date` làm điều kiện, với toán tử so sánh ngưỡng (`greater_than`/`less_than`/`between`).
- Giữ nguyên hành vi hiện có cho mọi rule đơn kiểu cũ (không phá vỡ dữ liệu/cấu hình đang chạy) — migrate tự động, không cần admin cấu hình lại.
- Một điểm neo logic duy nhất (`evaluateCondition` hoặc hàm kế thừa) vẫn dùng chung cho cả 3 nơi tiêu thụ — không viết 3 bộ logic riêng.

**Non-Goals:**
- Không làm cây điều kiện lồng nhau (nhóm điều kiện trong nhóm điều kiện, kiểu `(A AND B) OR (C AND D)`) — chỉ 1 tầng `conjunction` áp dụng cho toàn bộ mảng rule, đúng mức độ phức tạp thực tế đang cần (form.io gọi đây là "Simple Conditions", đủ dùng, không cần tới JsonLogic đầy đủ).
- Không đổi 3 toán tử cũ (`equals`/`not_equals`/`includes`) hay hành vi so sánh string/array hiện có.
- Không thêm operator ngày kiểu tương đối ("trong vòng N ngày tới") — chỉ so sánh giá trị tĩnh admin nhập khi cấu hình, giống model equals/includes hiện tại.

## Decisions

### 1. Cấu trúc dữ liệu mới: `ConditionGroup` thay vì mảng lồng

```ts
export interface ConditionRule {
  fieldCode: string;
  operator: "equals" | "not_equals" | "includes" | "greater_than" | "less_than" | "between";
  value: string;      // dùng cho equals/not_equals/includes/greater_than/less_than
  valueTo?: string;   // chỉ dùng khi operator === "between" (giá trị trên của khoảng)
}

export interface ConditionGroup {
  conjunction: "all" | "any";
  rules: ConditionRule[];
}
```
`field.visibleWhen`, `approverStep.condition`, `followersConditional[].condition` đổi kiểu từ `ConditionRule | undefined` → `ConditionGroup | undefined`.

**Vì sao không dùng cây lồng nhau (`{and: [...], or: [...]}` kiểu JsonLogic)**: mức phức tạp hiện tại (form.io "Simple Conditions": 1 conjunction phẳng + danh sách rule) đã đủ cho mọi ví dụ nghiệp vụ đã biết. Cây lồng nhau cần UI phức tạp hơn nhiều (kéo-thả nhóm con) mà chưa có bằng chứng cần — giữ đúng triết lý "đơn giản trước, mở rộng khi cần" của thiết kế gốc, chỉ mở rộng đúng phần đã xác nhận cần.

### 2. `evaluateCondition` nhận `ConditionGroup`, lặp `rules` bằng `every`/`some`

```ts
export function evaluateConditionGroup(
  group: ConditionGroup,
  values: Record<string, unknown>,
  fields: ProposalField[],
): boolean {
  if (group.rules.length === 0) return true; // nhóm rỗng = luôn thoả (an toàn khi migrate)
  const results = group.rules.map((rule) => evaluateRule(rule, values, fields));
  return group.conjunction === "all" ? results.every(Boolean) : results.some(Boolean);
}
```
`evaluateRule` (đổi tên từ `evaluateCondition` cũ, giữ nguyên logic 3 toán tử string/array, thêm nhánh số/ngày cho 3 toán tử mới) là hàm nội bộ, không export — chỉ `evaluateConditionGroup` được export và dùng ở 3 nơi tiêu thụ. Đặt tên hàm mới thay vì giữ nguyên `evaluateCondition` để buộc mọi lời gọi phải cập nhật rõ ràng (compile-time break) thay vì âm thầm nhận sai kiểu dữ liệu.

### 3. So sánh số/ngày: parse tại thời điểm đánh giá, không lưu kiểu đã parse

`greater_than`/`less_than`: parse `Number(rawValue)` và `Number(rule.value)` — nếu 1 trong 2 là `NaN` (field không phải số, hoặc giá trị không hợp lệ) → coi là không thoả (an toàn, không throw). Field kiểu `date` parse bằng `Date.parse()` tương tự trước khi so sánh (so `getTime()`), không parse thủ công định dạng ngày.
`between`: `value` là cận dưới, `valueTo` là cận trên, thoả khi `value <= raw <= valueTo` (đóng 2 đầu).

**Vì sao không thêm kiểu `number`/`Date` mới vào `ConditionRule.value`** (thay vì luôn là `string`): giữ `value`/`valueTo` là `string` để không phá vỡ hợp đồng dữ liệu hiện tại (form input HTML luôn trả string) — ép kiểu chỉ xảy ra ở tầng đánh giá (`evaluateRule`), input/lưu trữ vẫn nhất quán 1 kiểu.

### 4. Mở `CONDITION_ELIGIBLE_TYPES`, nhưng field kiểu `single_choice`/`multiple_choice`/`department_select` chỉ cho phép operator cũ

UI `ConditionEditor` phải lọc operator hiển thị theo `dataType` của field đang chọn làm điều kiện: field rời rạc (3 loại cũ) → chỉ hiện `equals`/`not_equals`/`includes` (giữ nguyên hành vi cũ); field số/ngày (4 loại mới) → chỉ hiện `equals`/`not_equals`/`greater_than`/`less_than`/`between` (không có `includes`, vì field số/ngày không phải mảng nhiều lựa chọn).

### 5. Validate `fieldCode` tồn tại: gộp thành 1 hàm validate dùng chung cho cả 3 nơi

Hiện tại `app/api/groups/[id]/route.ts:61-75` chỉ validate cho `approverSteps.condition`. Viết 1 hàm `validateConditionGroupFieldCodes(group: ConditionGroup, knownFieldCodes: Set<string>)` dùng lại cho `patch.fields[].visibleWhen`, `patch.approverSteps[].condition`, `patch.followersConditional[].condition` — tránh lặp code validate 3 lần khác nhau (rủi ro lệch nhau như đã phát hiện).

### 6. Đồng bộ spec cũ về hành vi log

Chọn **bổ sung `console.warn`** vào nhánh field-không-tồn-tại (thay vì sửa spec để xoá yêu cầu log) — vì log cảnh báo giúp admin phát hiện sớm cấu hình rule tham chiếu field đã xoá, đúng tinh thần "không chặn gửi đề xuất nhưng cần biết để sửa" mà spec gốc đã hướng tới.

## Risks / Trade-offs

- **[Risk] Đổi kiểu dữ liệu là BREAKING với dữ liệu Firestore đang có** → Mitigation: script migration 1 lần bọc mọi `ConditionRule` đơn cũ thành `{ conjunction: "all", rules: [rule] }` trước khi deploy code mới; code mới chỉ đọc `ConditionGroup`, không còn nhánh tương thích ngược đọc rule đơn (tránh giữ 2 nhánh code song song vĩnh viễn).
- **[Risk] So sánh số/ngày có thể cho kết quả sai nếu field bị đổi `dataType` sau khi đã có rule tham chiếu** (ví dụ field đổi từ `integer` sang `short_text`, rule cũ dùng `greater_than` không còn ý nghĩa) → Mitigation: `evaluateRule` luôn thử parse số trước khi so sánh bằng `greater_than`/`less_than`/`between` bất kể `dataType` hiện tại của field là gì; nếu parse ra `NaN` thì coi là không thoả (nhất quán với hành vi "field không hợp lệ = false, không throw" đã có).
- **[Risk] Nhóm điều kiện rỗng sau migrate lỗi (mảng `rules` rỗng)** → Mitigation: `evaluateConditionGroup` coi nhóm rỗng là **luôn thoả mãn** (an toàn hơn là chặn nhầm) — field/bước duyệt/follower sẽ hiện ra thay vì biến mất khi có lỗi migrate, dễ phát hiện qua QA hơn là mất field âm thầm.
- **[Trade-off] Không hỗ trợ điều kiện tương đối theo thời gian thực** (VD: "trong vòng 7 ngày kể từ hôm nay") — chấp nhận được vì chưa có ví dụ nghiệp vụ nào cần, và thêm phức tạp đáng kể (cần đánh giá lại theo thời gian, không chỉ theo giá trị đề xuất).

## Migration Plan

1. Viết script 1 lần (`scripts/migrate-condition-rules.ts`, chạy qua Admin SDK giống các script trước đây trong dự án) — quét mọi `ProposalGroup`, với mỗi field có `visibleWhen`, mỗi `approverStep.condition`, mỗi `followersConditional[].condition` dạng object đơn cũ (phát hiện bằng: có `fieldCode` nhưng KHÔNG có `rules`) → bọc thành `{ conjunction: "all", rules: [{ ...rule đơn cũ }] }`.
2. Chạy script ở môi trường staging/thử trước, đối chiếu số lượng nhóm/field bị đổi khớp với số lượng rule cũ tìm thấy (log ra để soát tay).
3. Deploy code mới (đọc `ConditionGroup`) **sau khi** migration chạy xong trên production — thứ tự bắt buộc: migrate trước, deploy sau (không được deploy code mới trước vì sẽ đọc sai kiểu dữ liệu cũ).
4. Không cần rollback dữ liệu nếu revert code: `ConditionGroup` dạng `{conjunction:"all", rules:[1 rule]}` tương đương hệt hành vi rule đơn cũ về mặt kết quả — nhưng code CŨ sẽ không đọc được kiểu MỚI (thiếu field `rules`), nên rollback code cần đi kèm rollback dữ liệu (khôi phục backup Firestore trước migration) nếu thực sự cần lùi lại.

## Open Questions

- Admin hiện có được phép trộn field rời rạc và field số/ngày trong CÙNG 1 `ConditionGroup` (VD: "Phương thức thanh toán = Chuyển khoản" AND "Số tiền > 20 triệu")? Đề xuất: có, vì mỗi `rule` tự chọn field/operator độc lập, không có lý do kỹ thuật để cấm — cần Sếp xác nhận đây có phải nhu cầu thật hay chỉ nên cho phép cùng loại field trong 1 nhóm cho đơn giản.
- Giới hạn số lượng rule tối đa trong 1 `ConditionGroup` (UI) — đề xuất mềm: không giới hạn cứng trong code, nhưng UI có thể gợi ý cảnh báo nhẹ nếu vượt quá ~5 điều kiện (dễ rối khi đọc lại cấu hình).
