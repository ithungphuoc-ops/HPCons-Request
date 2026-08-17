## ADDED Requirements

### Requirement: Ảnh đại diện thật lấy từ hồ sơ người dùng app tổng
Hệ thống SHALL cung cấp API trả về `avatarUrl` (từ `users/{uid}.avatarUrl` của Firestore app tổng hpcons-portal) cho một danh sách uid, yêu cầu người gọi đã đăng nhập. Nơi hiển thị người dùng SHALL ưu tiên ảnh thật; khi người dùng chưa có ảnh hoặc ảnh tải lỗi, hệ thống SHALL hiển thị vòng tròn chữ cái đầu của tên như trước — không hiện ô ảnh vỡ.

#### Scenario: Người dùng đã cập nhật ảnh ở app tổng thấy ảnh thật trên danh sách
- **WHEN** người gửi 1 đề xuất đã tải ảnh đại diện lên trang Tài khoản của app tổng
- **THEN** dòng đề xuất đó trên danh sách hiển thị đúng ảnh thật của người gửi

#### Scenario: Người chưa có ảnh hiện chữ cái đầu như cũ
- **WHEN** người gửi chưa từng tải ảnh (avatarUrl trống) hoặc URL ảnh tải lỗi
- **THEN** hiển thị vòng tròn chữ cái đầu của tên, không có ô ảnh vỡ

#### Scenario: API avatar chặn người chưa đăng nhập
- **WHEN** một request không có phiên đăng nhập hợp lệ gọi API avatars
- **THEN** API trả lỗi xác thực, không lộ dữ liệu hồ sơ
