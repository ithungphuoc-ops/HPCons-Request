## Why

Field "Số Hợp Đồng CĐT" trong các mẫu đề xuất hiện là văn bản gõ tự do — không có gì đảm bảo người gửi gõ đúng số hợp đồng thật đang tồn tại, dễ gõ sai/gõ thiếu, khó đối chiếu về sau với app Công nợ (congno.hpcore.vn, dữ liệu hợp đồng thật của công ty). Sếp chốt (26/09/2026, qua demo HTML đã duyệt): chỉ cần ràng buộc ĐÚNG field "Số Hợp Đồng CĐT" phải khớp danh sách hợp đồng thật — field "Tên công trình" giữ nguyên gõ tự do như hiện tại, không đổi gì.

## What Changes

- Thêm 1 công tắc cấu hình MỚI cho field kiểu "Văn bản ngắn" khi Admin thiết lập mẫu: "Bắt buộc khớp danh sách hợp đồng (app Công nợ)" — theo đúng mẫu đã có của `suggestFromHistory` (cờ trên từng field cụ thể, không đoán theo tên field).
- Field đã bật cờ này: lúc điền đề xuất, ô nhập gợi ý (datalist) các Số Hợp Đồng CĐT thật, đọc trực tiếp từ project Firestore riêng của app Công nợ ("hpcons-congno", collection `contracts`) qua 1 kết nối cross-project MỚI ở server (cùng mẫu `lib/hpcore.ts` đã dùng để đọc App Tổng) — KHÔNG lộ dữ liệu nhạy cảm (số tiền hợp đồng...) ra client, chỉ trả về `code` (+ `project`/`group` để hỗ trợ hiển thị phụ khi tìm).
- Gửi đề xuất (chính thức, không áp dụng cho nháp) mà giá trị field này KHÔNG khớp đúng 1 Số Hợp Đồng CĐT thật (đối chiếu lại tại thời điểm gửi, không tin dữ liệu client) → chặn gửi, báo lỗi rõ ràng — cùng cơ chế với `findMissingRequiredFields`/`findBlockedDateLeadTimeFields` đã có.
- Field "Tên công trình" và mọi field khác: KHÔNG đổi gì.

## Capabilities

### New Capabilities
- `contract-code-lookup`: cờ cấu hình field + nguồn gợi ý cross-project + validate chặn gửi khi giá trị không khớp danh sách hợp đồng thật từ app Công nợ.

### Modified Capabilities
(không có — đây là khả năng hoàn toàn mới, không đổi requirement đã đặc tả nào khác)

## Impact

- **Thêm mới**: `lib/congno.ts` (Admin SDK cross-project, mẫu `lib/hpcore.ts`), route `GET /api/groups/[id]/contract-code-suggestions`, hàm `findInvalidContractCodeFields` trong `lib/server/requests.ts`, component `ShortTextWithContractCodeLookup` trong submit page.
- **Sửa**: `lib/types.ts` (thêm `contractCodeLookup?: boolean` vào `ProposalField`), `components/request/modals/AddFieldModal.tsx` (thêm công tắc cấu hình), `app/request/groups/[groupId]/submit/page.tsx` (`FieldControl` dùng component mới khi field bật cờ), `app/api/requests/route.ts` + `app/api/requests/[id]/route.ts` (gọi validate mới, chỉ khi gửi chính thức).
- **Hạ tầng ngoài code**: cần biến môi trường mới `CONGNO_FIREBASE_SERVICE_ACCOUNT` (service account JSON project "hpcons-congno") — Sếp cấp, thêm vào Vercel. Chưa có key thì tính năng này không hoạt động được (route trả lỗi rõ ràng, không chặn các field khác/không sập app).
