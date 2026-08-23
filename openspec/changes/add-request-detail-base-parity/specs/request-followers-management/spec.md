## ADDED Requirements

### Requirement: Thêm người theo dõi vào 1 đề xuất đã tồn tại, bất kể trạng thái
Hệ thống SHALL cho phép thêm 1 người vào `followers` của 1 đề xuất đã tồn tại (kể cả đã "approved"/"rejected"), khác với cơ chế cũ (chỉ sửa được `followers` khi đề xuất còn ở trạng thái nháp/bị trả lại/đang chờ duyệt CỦA CHÍNH CHỦ, qua `PATCH /api/requests/[id]`). Bất kỳ ai xem được đề xuất (`canView()`) SHALL thêm được người theo dõi mới.

#### Scenario: Thêm người theo dõi vào đề xuất đã duyệt xong
- **WHEN** người dùng xem được 1 đề xuất đã ở trạng thái "approved" và thêm 1 người vào danh sách theo dõi
- **THEN** người đó được thêm vào `followers` của đề xuất thành công, không bị chặn bởi trạng thái "approved"

#### Scenario: Thêm người đã có trong danh sách theo dõi
- **WHEN** người dùng cố thêm 1 người ĐÃ CÓ trong `followers` của đề xuất
- **THEN** hệ thống không thêm trùng (danh sách vẫn giữ nguyên, không có 2 bản ghi cho cùng 1 người)

### Requirement: Hiển thị "Người theo dõi" dạng avatar chồng ngang
Sidebar trang chi tiết đề xuất SHALL hiển thị card "Người theo dõi" dưới dạng avatar tròn xếp chồng nhẹ lên nhau theo chiều ngang (thay cho danh sách dọc mỗi người 1 dòng), kèm 1 nút tròn "+" ở cuối để mở luồng thêm người theo dõi mới (Requirement trên).

#### Scenario: Có người theo dõi
- **WHEN** đề xuất có ít nhất 1 người theo dõi
- **THEN** card hiển thị các avatar chồng ngang tương ứng, cộng nút "+" ở cuối

#### Scenario: Chưa có người theo dõi nào
- **WHEN** `followers` của đề xuất rỗng
- **THEN** card vẫn hiển thị (khác hành vi cũ là ẩn hẳn card khi rỗng), chỉ có nút "+" để bắt đầu thêm
