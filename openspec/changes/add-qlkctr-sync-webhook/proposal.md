## Why

Đề xuất mua vật tư (nhóm "2. Phiếu đề nghị") sau khi duyệt xong hiện chỉ nằm trong App Request — bộ phận kho ở công trình phải tự nhập lại thủ công vào app quản lý kho riêng (QLK CTR) để theo dõi nhập/xuất/tồn theo công trình. Việc nhập lại tay dễ sai lệch số liệu và tốn thời gian. Muốn đề xuất đã duyệt tự động "nhảy" sang đúng công trình bên QLK CTR mà không cần ai nhập lại.

## What Changes

- Ngay sau khi 1 đề xuất được duyệt xong hoàn toàn (`status` chuyển `"approved"` tại `app/api/requests/[id]/decision/route.ts`), gọi thêm 1 API riêng của QLK CTR, gửi kèm: chuỗi giá trị field "Tên đề xuất" (quy ước có sẵn: `Số hợp đồng + tên công trình`) và danh sách vật tư từ bảng "Chi tiết".
- **Không thêm/đổi field nào** trong mẫu form đề xuất — chỉ đọc lại 2 field đã có sẵn ("Tên đề xuất", "Chi tiết").
- **Không lọc theo nhóm đề xuất (`groupId`)** — mọi đề xuất duyệt xong (bất kỳ nhóm nào) đều thử gọi; QLK CTR tự nhận diện được công trình hay không dựa trên nội dung "Tên đề xuất" (đề xuất không liên quan công trình sẽ không tự tạo gì bên đó, nằm chờ Admin bên QLK CTR xử lý tay).
- Nếu không tìm đủ dữ liệu cần thiết (thiếu field, thiếu cột bắt buộc "Tên hàng"/"Số lượng", bảng rỗng) → bỏ qua êm, không gọi gì, không ảnh hưởng việc duyệt.
- Nếu gọi API thất bại (mạng lỗi, QLK CTR đang bảo trì...) → đề xuất vẫn duyệt thành công bình thường, chỉ ghi thêm 1 dòng vào lịch sử xử lý cho biết đồng bộ thất bại.
- Tính năng tự tắt hoàn toàn nếu chưa cấu hình biến môi trường `QLKCTR_API_URL` (không gọi gì ra ngoài, không lỗi) — an toàn để merge trước khi có domain/API key thật.

## Capabilities

### New Capabilities
- `qlkctr-sync`: Tự động gửi dữ liệu đề xuất đã duyệt sang QLK CTR ngay sau khi duyệt xong hoàn toàn, không cần thao tác thêm từ người dùng.

### Modified Capabilities
(không có — luồng duyệt/từ chối/chuyển tiếp/trả lại hiện có giữ nguyên hành vi, chỉ thêm 1 bước phụ chạy sau khi đã duyệt xong)

## Impact

- **Code mới**: `lib/qlkctr-sync.ts` (trích xuất dữ liệu + gọi API), sửa thêm vào `app/api/requests/[id]/decision/route.ts` (không đổi các nhánh quyết định khác).
- **Biến môi trường mới**: `QLKCTR_API_URL`, `QLKCTR_API_KEY` (xem `.env.local.example`) — cần domain thật + API key thật của QLK CTR mới hoạt động, tự tắt nếu để trống.
- **Không đụng**: `lib/print-template.ts`/logic in ấn hiện có, không đổi cấu trúc field nào của bất kỳ nhóm đề xuất nào.
- **Đã xác nhận với "Sếp" (không cần trao đổi thêm với người giữ repo này trước khi code)**: chuỗi "Tên đề xuất" và bảng "Chi tiết" của nhóm "2. Phiếu đề nghị" đã đúng định dạng cần dùng, xác nhận bằng dữ liệu thật (đề xuất #000012).
