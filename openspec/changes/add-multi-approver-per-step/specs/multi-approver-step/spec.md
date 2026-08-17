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

### Requirement: Người gửi thêm được người cùng duyệt tại hàng "Quản lý trực tiếp" trên form gửi
Trên form Gửi đề xuất, tại hàng của bước "Quản lý trực tiếp" (`kind: "submitter_manager"`), người gửi SHALL thêm được (@ tag) một hoặc nhiều người duyệt NGOÀI quản lý đã chọn — tất cả (quản lý + người thêm) đều trở thành người duyệt của đề xuất và với quy trình đồng thời/lần lượt, TẤT CẢ phải chấp thuận. Máy chủ SHALL tự xác thực từng uid gửi lên (tồn tại thật trong hồ sơ nhân sự), không tin danh tính client gửi. (Sếp yêu cầu 16/08/2026, cùng quyết định "tất cả phải duyệt".)

#### Scenario: Thêm 1 người cùng duyệt với quản lý trực tiếp
- **WHEN** người gửi đã chọn quản lý trực tiếp, gõ @ thêm 1 người nữa vào cùng hàng rồi gửi đề xuất
- **THEN** đề xuất có CẢ quản lý lẫn người được thêm trong danh sách người duyệt; chỉ 1 trong 2 duyệt thì đề xuất vẫn chờ, cả 2 duyệt mới hoàn tất (quy trình đồng thời)

#### Scenario: uid người thêm không tồn tại bị loại bỏ ở máy chủ
- **WHEN** client gửi lên danh sách chứa 1 uid không tồn tại trong hồ sơ nhân sự
- **THEN** máy chủ bỏ qua uid không hợp lệ đó, chỉ giữ những người xác thực được
