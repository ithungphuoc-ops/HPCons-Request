## ADDED Requirements

### Requirement: Tính lại hạn xử lý khi chuyển bước duyệt (luồng Lần lượt)
Khi đề xuất thuộc nhóm có `approverSlaEnabled` bật và luồng xử lý là "Lần lượt", hệ thống SHALL tính lại `deadlineAt` mỗi khi có quyết định làm đề xuất chuyển sang bước duyệt kế tiếp còn "pending" — dùng SLA riêng của bước kế tiếp (hoặc SLA chung của nhóm nếu bước đó không có SLA riêng), tính từ thời điểm quyết định đó.

#### Scenario: Duyệt xong bước 1, chuyển sang bước 2 có SLA riêng
- **GIVEN** nhóm bật `approverSlaEnabled`, luồng "Lần lượt", bước 2 có `slaHours = 8`
- **WHEN** người duyệt bước 1 chấp thuận
- **THEN** `deadlineAt` của đề xuất được cập nhật thành thời điểm hiện tại + 8 giờ (không cộng dồn hạn cũ)

#### Scenario: Chuyển tiếp cũng tính lại
- **WHEN** người duyệt bước hiện tại thực hiện "Chấp thuận và chuyển tiếp" hoặc "Chuyển tiếp cho duyệt trước"
- **THEN** `deadlineAt` được tính lại theo đúng bước sẽ tới lượt kế tiếp sau khi chèn người mới vào danh sách duyệt

### Requirement: Không tính lại ngoài phạm vi
Hệ thống SHALL KHÔNG tính lại `deadlineAt` khi: `approverSlaEnabled` tắt, luồng xử lý không phải "Lần lượt", hoặc đề xuất đã hoàn tất (approved/rejected).

#### Scenario: Luồng đồng thời không tính lại
- **GIVEN** nhóm dùng luồng "Đồng thời"
- **WHEN** 1 trong nhiều người duyệt ra quyết định
- **THEN** `deadlineAt` giữ nguyên như lúc gửi, không bị ghi đè

### Requirement: Dữ liệu bước duyệt không lệch khi chuyển tiếp
Khi 1 người được chèn vào danh sách duyệt qua hành động chuyển tiếp, hệ thống SHALL giữ `approverStepMeta` cùng độ dài và thứ tự với `approversSnapshot`/`approvers` sau khi chèn.

#### Scenario: Chuyển tiếp thêm người mới
- **WHEN** người duyệt bấm "Chấp thuận và chuyển tiếp" tới 1 người ngoài `approverSteps` cấu hình sẵn
- **THEN** `approverStepMeta` có thêm đúng 1 phần tử tại đúng vị trí người mới được chèn, không làm lệch vị trí của các phần tử khác
