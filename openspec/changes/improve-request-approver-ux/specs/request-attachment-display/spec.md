## ADDED Requirements

### Requirement: Hiển thị rõ khi chưa có tệp đính kèm
Trang xem chi tiết đề xuất SHALL hiển thị chữ giải thích rõ ràng khi trường tài liệu đính kèm chưa có tệp nào, thay vì chỉ hiện 1 ký tự gạch ngang không giải thích.

#### Scenario: Trường tệp đính kèm rỗng
- **WHEN** người dùng xem chi tiết 1 đề xuất có trường kiểu tệp đính kèm nhưng chưa có tệp nào được thêm
- **THEN** hệ thống hiển thị chữ nhỏ màu xám "Chưa có tệp nào" tại vị trí đó

#### Scenario: Trường tệp đính kèm có tệp
- **WHEN** người dùng xem chi tiết 1 đề xuất có ≥1 tệp đính kèm
- **THEN** hệ thống hiển thị danh sách tệp kèm liên kết tải về như hành vi hiện tại (không đổi)
