## Why

Field kiểu văn bản ngắn có thể bật "Bắt buộc khớp Số Hợp Đồng CĐT (app Công nợ)" — nhưng cơ chế này hard-code cho ĐÚNG 1 trường hợp (`ProposalField.contractCodeLookup: boolean`, đọc cứng collection `contracts`). Sếp cần thêm 1 trường hợp thứ 2 thật (field "Mã nhà thầu phụ", đọc collection `subcontractors`), và xác nhận tương lai sẽ còn phát sinh thêm nhóm đề xuất khác cần lấy mã tham chiếu kiểu này. Nhân bản nguyên khối code cho mỗi trường hợp mới (như đã làm cho Số Hợp Đồng CĐT) sẽ lặp lại đúng lỗi CodeRabbit từng bắt ở PR #41 (2 nơi tự đọc/tự cache dữ liệu rồi lệch nhau dần).

Sau khi cân nhắc 5 hướng (từ "nhân bản code" tới "để app Công nợ tự khai báo, không cần bấm gì cả" — xem 4 demo HTML đã duyệt dưới đây), Sếp chốt hướng cân bằng nhất: Admin CHỌN nguồn ngay tại chỗ khi tạo/sửa field (không gõ tay tên collection/field, không cần deploy lại app khi có nhu cầu mới trong phạm vi các nguồn đã duyệt) — không cần màn cấu hình Admin riêng biệt vì phạm vi nguồn cho phép hiện tại đã chốt cứng, cố định.

Tham khảo: `tong-quan-demo/base-request-app/tong-quat-hoa-ma-tham-chieu-ngoai-2026-09-29/index.html`, `.../tong-quat-hoa-ma-tham-chieu-ngoai-2026-09-29-v02/index.html`, `.../tong-hop-5-cap-do-nguon-du-lieu-ngoai-2026-09-30/index.html`, `.../cap-do-D-chon-tai-cho-2026-09-30/index.html` (đã duyệt 29–30/09/2026).

## What Changes

- Thay `ProposalField.contractCodeLookup?: boolean` bằng cấu hình tổng quát `ProposalField.externalCodeLookup?: ExternalCodeLookupConfig` — mô tả nguồn (`sourceId`), field nào là "mã" (cho phép NHIỀU field, khớp 1 trong các field là đủ), field nào hiện phụ trong gợi ý. **BREAKING** ở tầng dữ liệu field (đổi tên/shape) — có lớp tương thích đọc field cũ cho dữ liệu production hiện có (xem design.md).
- Định nghĩa CỨNG (trong code, không phải cấu hình Firestore) đúng 2 nguồn cho phép ở đợt này:
  - `contracts` (Số Hợp Đồng CĐT) — field mã: `code`. Giữ nguyên hành vi/field hiện phụ đang chạy thật hôm nay.
  - `subcontractors` (Mã nhà thầu phụ) — field mã: `ma` HOẶC `mst` (khớp 1 trong 2 là đủ, vì nhà thầu tự thêm lúc "Ký kết hợp đồng" thường thiếu `ma`).
  - `customers` — **LOẠI KHỎI phạm vi đợt này**: xác nhận qua code thật (`HPCons-Congno/lib/data.ts`), collection này chỉ có `{ id, name }`, `id` là ID Firestore ngẫu nhiên — không có field "mã" nào hợp lý để ràng buộc. Ghi rõ trong design.md để không ai hiểu nhầm là bị quên.
- Đổi UI "Thêm/Sửa trường" (`AddFieldModal.tsx`): thay checkbox đơn bằng luồng chọn 4 bước (chọn nguồn đã liệt kê sẵn → xem field mẫu thật đã biết trước → tick 1/nhiều field làm "mã" → xác nhận) — KHÔNG tự động liệt kê toàn bộ collection thật của project Công nợ (chỉ hiện đúng 2 nguồn đã duyệt, chặn cứng ở code).
- Gộp route gợi ý (`/api/groups/[id]/contract-code-suggestions`) và hàm validate (`findInvalidContractCodeFields`) thành 1 cặp dùng chung cho mọi nguồn, thay vì code riêng cho từng nguồn.
- Thêm hàm đọc `subcontractors` từ Công nợ (`lib/congno.ts`), CHỈ forward đúng field cho phép (`ma`, `mst`, `ten`, `diaChi`) — không bao giờ forward field khác trong document (đặc biệt các field tài chính ở `contracts`, dù nằm cùng document với `code`).

## Capabilities

### New Capabilities
- `external-code-lookup`: Cơ chế tổng quát cho field văn bản ngắn bắt buộc khớp 1 mã tham chiếu thật từ 1 nguồn ngoài (app Công nợ) đã được duyệt sẵn — thay thế hoàn toàn `contract-code-lookup` cũ (chưa từng có spec riêng, gộp luôn vào đây).

### Modified Capabilities
- (không có capability nào đã archive trong `openspec/specs/` bị ảnh hưởng — cơ chế cũ chưa từng được viết thành spec chính thức)

## Impact

- **Dữ liệu:** field cũ có `contractCodeLookup: true` trên production phải tiếp tục hoạt động sau khi đổi kiến trúc (xem design.md mục tương thích ngược).
- **Code sửa:** `lib/types.ts`, `lib/congno.ts`, `lib/server/requests.ts`, `components/request/modals/AddFieldModal.tsx`, `app/request/groups/[groupId]/submit/page.tsx`, route `app/api/groups/[id]/contract-code-suggestions/route.ts` (đổi tên/tổng quát hoá).
- **Không đổi:** hành vi gửi/validate/gợi ý cho field Số Hợp Đồng CĐT đang chạy thật (chỉ đổi cách lưu cấu hình, không đổi trải nghiệm người dùng cuối).
- **Ngoài phạm vi:** màn "Nguồn dữ liệu ngoài" cấu hình qua Firestore (Cấp C), tự động liệt kê toàn bộ collection thật (Cấp D "cao" theo mô tả demo), bất kỳ project Firestore mới nào ngoài `congno` (Cấp E), và nguồn `customers`.
