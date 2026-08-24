## ADDED Requirements

### Requirement: Gửi email thật khi nhóm bật cờ
Khi `group.notificationRules.emailNotify` bật, hệ thống SHALL gửi email thật (không chỉ lưu cấu hình) cho các sự kiện: đề xuất tới lượt 1 người duyệt, đề xuất hoàn tất (chấp thuận/từ chối) cho người tạo, đề xuất được gửi/chấp thuận hoàn toàn cho người theo dõi.

#### Scenario: Người duyệt tới lượt
- **GIVEN** nhóm bật `emailNotify` và `sequentialTurnBasedNotify` (luồng "Lần lượt")
- **WHEN** 1 đề xuất được gửi hoặc chuyển sang bước kế tiếp
- **THEN** đúng người đang có thể thao tác (`canApproverAct` trả `true`) nhận được email "đang chờ bạn duyệt"

#### Scenario: Người tạo nhận kết quả
- **WHEN** đề xuất chuyển sang trạng thái "approved" hoặc "rejected"
- **THEN** người tạo đề xuất luôn nhận được email kết quả, không phụ thuộc `sequentialTurnBasedNotify`/`perStepBlockNotify`

### Requirement: Không gửi khi thiếu cấu hình
Hệ thống SHALL không gửi email và KHÔNG throw lỗi khi nhóm tắt `emailNotify`, hoặc khi thiếu biến môi trường gửi mail (`GMAIL_USER`/`GMAIL_APP_PASSWORD`).

#### Scenario: Thiếu biến môi trường
- **WHEN** server chưa có `GMAIL_USER`/`GMAIL_APP_PASSWORD`
- **THEN** `sendMail()` trả `false`, không gửi gì, không làm hỏng response của route gọi nó

### Requirement: Cờ chuyển tiếp cho duyệt trước có tác dụng thật
Khi `group.permissionRules.approversCanDelegateApproval` tắt, hệ thống SHALL không cho phép hành động "Chuyển tiếp và Duyệt" (`forward_then_approve`) — chặn cả ở giao diện (ẩn tuỳ chọn) và server (từ chối request nếu cố gọi trực tiếp).

#### Scenario: Nhóm tắt cờ
- **GIVEN** nhóm có `approversCanDelegateApproval: false`
- **WHEN** người duyệt mở hộp thoại "Chuyển tiếp đề xuất"
- **THEN** chỉ còn tuỳ chọn "Chấp nhận và chuyển tiếp", không còn "Chuyển tiếp và Duyệt"
- **AND** nếu gọi thẳng API với `decision: "forward_then_approve"`, server trả lỗi 403

#### Scenario: Nhóm cũ chưa từng cấu hình
- **WHEN** 1 nhóm được tạo trước ngày có cờ này, chưa từng đụng tới `permissionRules`
- **THEN** "Chuyển tiếp và Duyệt" vẫn hoạt động như trước (mặc định cho phép), không bị mất tính năng
