## ADDED Requirements

### Requirement: Cấu hình thông báo ở cấp nhóm đề xuất
`ProposalGroup` SHALL có `notificationRules: GroupNotificationRules` (3 cờ: thông báo theo lượt duyệt, thông báo theo từng khối người duyệt, thông báo email) — cấu hình này KHÁC với "Cài đặt thông báo" cá nhân của từng người dùng (`/request/settings/notifications`), áp dụng ở cấp NHÓM đề xuất.

#### Scenario: Cấu hình được lưu riêng theo từng nhóm
- **WHEN** người quản lý nhóm A đổi cờ thông báo của nhóm A
- **THEN** cấu hình thông báo của nhóm B không bị ảnh hưởng, mỗi nhóm giữ `notificationRules` độc lập

### Requirement: Cờ thông báo email chỉ lưu cấu hình
Cờ `notificationRules.emailNotify` SHALL được lưu và hiển thị đúng trạng thái Có/Không, nhưng hệ thống KHÔNG gửi email thật trong phạm vi tính năng này (chưa có hạ tầng gửi email).

#### Scenario: Bật cờ thông báo email không gửi email thật
- **WHEN** người quản lý nhóm bật "Thông báo email" cho nhóm
- **THEN** cấu hình được lưu đúng, nhưng không có email nào được gửi đi khi có sự kiện đề xuất mới/duyệt xong (do hệ thống chưa có hạ tầng gửi email)
