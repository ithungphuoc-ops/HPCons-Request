## Context

`lib/congno.ts` hiện CHỈ ĐỌC Firestore project Công nợ qua Admin SDK (service account `CONGNO_FIREBASE_SERVICE_ACCOUNT`, cũng có sẵn trên môi trường Preview của Vercel, không chỉ Production). Agent điều tra 01/10/2026 (đọc trực tiếp code HPCons-Congno, không đoán) xác nhận:

- Schema `Subcontractor` thật (`HPCons-Congno/lib/data.ts:141-155`): `ma?`, `ten` (bắt buộc DUY NHẤT phía Công nợ), `tenVietTat?`, `mst?`, `nhom?` (mặc định `"THẦU PHỤ"`), `diaChi?`, `nguon?: "goc"|"xetduyet"`, `hopDong?`, `createdAt?`, `updatedAt?`, `updatedBy?`.
- `nguon` là enum PHÂN LOẠI CÁCH TẠO (không phải tên người) — Công nợ dùng để hiện badge "Danh sách gốc"/"Từ xét duyệt" (`components/Subcontractors.tsx:582-586`) và lọc chip "Từ xét duyệt" — ghi giá trị lạ vào đây sẽ phá UI đó.
- Công nợ CÓ route `POST /api/subcontractors` nhưng: (a) không validate gì server-side, (b) đòi Bearer token là ID token CỦA CHÍNH project Công nợ — base-request-app chưa có cơ chế mint loại token này.
- Công nợ KHÔNG dùng Cloud Functions, không có `firestore.rules` trong repo — comment chính code Công nợ xác nhận collection `subcontractors` "chưa có luật [Security Rules] cho collection mới" nên mọi ghi/đọc collection này đi qua Admin SDK ở server, không có client-side rule nào mở.
- `ntpVietTat` (`HPCons-Congno/lib/subcontractors.ts:118-154`) là hàm thuần (không phụ thuộc Firestore/React) — port an toàn 1:1 sang `lib/ntp-viet-tat.ts`, đã verify khớp 2 ví dụ thật trong comment gốc ("COMIN AN AN HÒA" → "AN AN HÒA", "...ĐẠI VIỆT" → "ĐẠI VIỆT").

## Decisions

### Decision 1 — Ghi bằng Admin SDK trực tiếp, không qua route của Công nợ

Route `/api/subcontractors` của Công nợ không mang lại lợi ích an toàn nào (không validate) trong khi đòi hỏi thêm cơ chế mint ID token riêng — phức tạp hơn mà không an toàn hơn. `createSubcontractorInCongNo` (lib/congno.ts) gọi thẳng `getCongNoDb().collection("subcontractors").add(...)`.

**Rủi ro chưa xác nhận bằng code**: service account hiện tại được cấp quyền gì ở tầng IAM (Google Cloud) — Firestore Admin SDK không bị chặn bởi Security Rules, nhưng NẾU IAM của service account bị giới hạn chỉ đọc (vd custom role) thì lệnh `.add()` sẽ throw lúc runtime. Không có cách xác nhận trước bằng cách đọc code (IAM nằm ngoài repo) — xử lý bằng cách thử ghi 1 bản ghi test thật trên Preview deployment (có cùng biến môi trường) trước khi coi là xong, và để lỗi runtime (nếu có) hiện rõ ràng qua `apiErrorResponse`, không nuốt lỗi âm thầm.

### Decision 2 — Field `nguon` giữ nguyên ý nghĩa cũ, thêm field MỚI `ghiChuNguon`

```ts
await getCongNoDb().collection("subcontractors").add({
  ten, tenVietTat, mst, nhom, diaChi,
  nguon: "goc",                                   // KHÔNG đổi ý nghĩa field cũ
  ghiChuNguon: `Thêm qua app Đề xuất — ${nguoiThem}`, // field MỚI, Công nợ không hiện ở đâu
  createdAt: now, updatedAt: now,
});
```

Sếp xác nhận 01/10/2026: KHÔNG cần sửa giao diện Công nợ để hiện `ghiChuNguon` — chỉ cần lưu, ai mở thẳng dữ liệu Firestore thì thấy.

**Thay thế đã cân nhắc**: ghi đè tên người vào `nguon` — bị bác vì phá hỏng badge/lọc "Từ xét duyệt" của Công nợ (chỉ so sánh `=== "xetduyet"`, giá trị lạ nào khác đều rơi về "Danh sách gốc", và vẫn làm lệch số liệu chip lọc).

### Decision 3 — API route mới trong base-request-app, scope theo field đã cấu hình

Route mới (`app/api/groups/[id]/congno-subcontractors/route.ts`, POST) nhận `{ fieldId, ten, tenVietTat?, mst, nhom, diaChi? }`:
- `requireSession()` — bắt buộc đăng nhập, không giới hạn vai trò thêm (Sếp chốt: mọi người làm đề xuất).
- Đọc `group.fields` tìm đúng `fieldId`, xác nhận field đó THẬT SỰ bật `externalCodeLookup.sourceId === "congno_subcontractors"` qua `resolveExternalCodeLookup` — chặn gọi route này cho field không liên quan.
- `isWithinUsedForScope(group.usedFor, ...)` — cùng kiểu kiểm tra phạm vi đã dùng ở route `external-code-suggestions`, đảm bảo chỉ người có quyền dùng nhóm đề xuất đó mới gọi được.
- Validate tối thiểu: `ten`/`mst` non-empty (trả lỗi rõ nếu thiếu); `nhom` chỉ nhận `"THẦU PHỤ"|"TỔ ĐỘI"` (literal, không tin giá trị khác từ client).
- `nguoiThem` lấy từ `session.name` (KHÔNG nhận từ body — tránh giả mạo tên người thêm).
- Gọi `createSubcontractorInCongNo`, trả về `{ id, record: { fields: {...} } }` cùng shape `ExternalCodeRecord` mà client đã dùng — client chọn luôn bản ghi mới không cần gọi lại `external-code-suggestions`.

### Decision 4 — UI chỉ bật cho nguồn `congno_subcontractors`

`ShortTextWithExternalCodeLookup` nhận thêm prop/điều kiện: khi `sourceId === "congno_subcontractors"`, dropdown gợi ý có thêm 1 dòng cuối "+ Thêm nhà thầu phụ mới: '<đang gõ>'" (hiện khi ô đang gõ có nội dung). Bấm vào mở modal (dùng component `Modal` + style `form-styles` đã có sẵn trong file, không tạo style mới) với đúng 5 trường theo demo đã duyệt: Tên nhà cung cấp* / Tên viết tắt (không bắt buộc, có gợi ý tự rút gọn qua `ntpVietTat` lúc đang gõ) / MST hoặc CCCD* (ghi chú nhỏ "điền đúng bằng số") / Nhóm (mặc định "Thầu phụ") / Địa chỉ (không bắt buộc). Ghi chú đầu modal: "Nhà cung cấp chưa có trong danh sách? Điền đầy đủ thông tin bên dưới rồi bấm Thêm & chọn luôn — app sẽ tự động thêm vào Công nợ."

Ghi thành công → đóng modal, `onChange(record.ten)` (chọn luôn bản ghi mới cho field đang gõ), và đẩy `record` vào state `records` cục bộ của component (không cần gọi lại API) để `matchedRow`/autofill chéo field (nếu có field khác đang "tự động điền" theo field này) hoạt động NGAY mà không cần đợi.

Ghi thất bại (vd lỗi quyền ghi, lỗi mạng) → hiện lỗi NGAY TRONG modal, giữ nguyên dữ liệu đã nhập để thử lại, không đóng modal.

## Risks / Trade-offs

- [Rủi ro] IAM của service account có thể chưa được cấp quyền ghi — không xác nhận được bằng code, chỉ biết chắc lúc thử ghi thật. Mitigation: thử trên Preview deployment (cùng biến môi trường Production) với 1 bản ghi rõ ràng đánh dấu TEST trước khi coi hoàn tất, xoá lại sau khi xác nhận.
- [Rủi ro] 2 người cùng thêm gần như đồng thời 1 nhà thầu trùng/gần trùng tên → có thể tạo 2 bản ghi trùng. Mitigation: chấp nhận (Công nợ hiện cũng không chặn cứng trùng MST ở chính route/UI của họ, chỉ cảnh báo).
- [Trade-off] Không port validate định dạng MST (Công nợ cũng không có) — chỉ bắt buộc non-empty theo đúng yêu cầu Sếp, không kiểm tra đủ 10/12 số.

## Migration Plan

Không cần migration dữ liệu — tính năng CHỈ THÊM document mới, không đổi document cũ nào. Rollback: revert commit, không ảnh hưởng dữ liệu Firestore đã ghi trước đó (bản ghi test sẽ được xoá tay qua giao diện Công nợ sau khi xác nhận ghi thành công).
