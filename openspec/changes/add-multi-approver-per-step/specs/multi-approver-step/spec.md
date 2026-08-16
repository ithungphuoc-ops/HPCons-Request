## ADDED Requirements

### Requirement: Bước duyệt cố định chứa được nhiều người, tất cả phải duyệt
Hệ thống SHALL cho phép 1 bước duyệt `kind: "fixed"` gắn NHIỀU người duyệt (`users`), và khi đề xuất được gửi, MỌI người trong bước đó SHALL được đưa vào danh sách người duyệt của đề xuất — với quy trình "Xử lý đồng thời"/"Lần lượt", đề xuất chỉ hoàn tất khi TẤT CẢ những người này (cùng người của các bước khác) đã chấp thuận.

#### Scenario: Bước 2 người, cả 2 phải duyệt mới hoàn tất
- **WHEN** 1 bước duyệt cố định có 2 người A và B, quy trình nhóm là "Xử lý đồng thời", và chỉ A đã chấp thuận
- **THEN** đề xuất vẫn ở trạng thái chờ duyệt; chỉ khi cả A và B (cùng mọi người duyệt khác) chấp thuận, đề xuất mới hoàn tất

#### Scenario: Dữ liệu bước duyệt cũ (1 người) vẫn hoạt động nguyên trạng
- **WHEN** nhóm có bước duyệt cố định tạo từ trước (chỉ có `user` số ít, không có `users`)
- **THEN** hệ thống coi bước đó có đúng 1 người là `user`, hành vi gửi/duyệt giữ nguyên như trước — không cần migration dữ liệu

#### Scenario: Admin @tag thêm người vào cùng 1 bước trên UI cấu hình
- **WHEN** admin sửa "Người xét duyệt" của nhóm, gõ @ chọn thêm người thứ 2 vào ô của 1 bước cố định đã có người
- **THEN** cả 2 người hiển thị dạng thẻ trong cùng 1 bước và được lưu lại; xoá thẻ từng người được; bước cố định 0 người bị chặn lưu
