## Why

Sếp so sánh trực tiếp danh sách đề xuất của app (request.hpcore.vn) với Base.vn thật (request.base.vn) ngày 17/08/2026: bản Base mỗi dòng hiện ĐẦY ĐỦ — tiêu đề + chuỗi thông tin phụ (Nhóm, Bộ phận, Nhóm đề xuất, Ngày đề nghị cấp...), nút trạng thái, ẢNH ĐẠI DIỆN THẬT người gửi + tên, cụm ảnh người duyệt kèm dấu tích đã duyệt, và ngày. Bản của app mới chỉ có tiêu đề + 1 dòng phụ ngắn + badge. Sếp yêu cầu hiển thị đầy đủ như Base, và ảnh đại diện phải lấy từ hồ sơ người dùng của app tổng hpcons-portal (nơi mọi người đã cập nhật thông tin/ảnh đầy đủ — field `users/{uid}.avatarUrl`, ảnh lưu Cloudflare R2, URL công khai).

## What Changes

- API mới `GET /api/directory/avatars?uids=...` — tra `avatarUrl` từ Firestore app tổng (project hpcore) cho 1 danh sách uid, trả map `{uid: url|null}`; yêu cầu đăng nhập
- Trang danh sách: dòng đề xuất hiện thêm (a) chuỗi thông tin phụ từ giá trị field nổi bật của chính đề xuất đó (Bộ phận, lựa chọn, ngày... — tối đa 3 field), (b) ảnh đại diện THẬT người gửi (fallback chữ cái đầu như hiện tại nếu chưa có ảnh), (c) cụm ảnh người duyệt chồng lên nhau kèm dấu tích xanh (đã duyệt)/dấu đỏ (từ chối), tối đa 3 + "+N"
- Client tải map avatar 1 lần cho mọi uid xuất hiện trong trang danh sách (người gửi + người duyệt), có cache theo phiên

## Capabilities

### Modified Capabilities
- `request-title-display`: dòng danh sách hiển thị đầy đủ thông tin kiểu Base.vn (mở rộng requirement hiển thị danh sách đã có trong change add-computed-field-values — capability này chưa archive nên sửa tiếp tại đây theo hướng ADDED requirement mới)

### New Capabilities
- `user-avatars`: ảnh đại diện thật từ hồ sơ app tổng dùng chung cho mọi nơi hiện người dùng trong app

## Impact

- `app/api/directory/avatars/route.ts` (mới)
- `app/request/list/page.tsx` (dòng danh sách + fetch avatar)
- Không đổi schema Firestore của app; chỉ ĐỌC thêm `users/{uid}.avatarUrl` từ project hpcore (đã có sẵn kết nối `getHpcoreDb()`)
