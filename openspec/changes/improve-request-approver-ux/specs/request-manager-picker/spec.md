## ADDED Requirements

### Requirement: Xem trước và xác nhận quản lý trực tiếp lúc điền form
Khi 1 bước duyệt trong nhóm đề xuất có kiểu `submitter_manager`, khu vực xem trước "Người duyệt" trên form tạo đề xuất SHALL cho phép người gửi đổi lại người được auto-resolve cho bước đó, không chỉ hiển thị đọc-only như hiện tại.

#### Scenario: Auto-resolve thành công, hiện sẵn giá trị kèm tuỳ chọn đổi
- **WHEN** người gửi mở form tạo đề xuất có bước duyệt `submitter_manager`, và phòng ban của người gửi có `leaderId` hợp lệ
- **THEN** khu vực "Người duyệt" hiện pill tên người đang là trưởng phòng ban đó, kèm 1 nút nhỏ để đổi lại nếu cần

#### Scenario: Auto-resolve thất bại, bắt buộc chọn tay
- **WHEN** người gửi mở form tạo đề xuất có bước duyệt `submitter_manager`, nhưng phòng ban của người gửi KHÔNG có `leaderId`
- **THEN** khu vực "Người duyệt" hiện ngay ô chọn (không phải pill tĩnh) kèm thông báo lỗi hiện tại, và form yêu cầu người gửi tự chọn 1 người trước khi gửi được

### Requirement: Chọn quản lý trực tiếp từ danh sách giới hạn
Ô "Quản lý trực tiếp" SHALL cung cấp 1 cách duyệt/tìm kiếm toàn bộ danh sách người hiện đang là trưởng phòng/đơn vị (không cần gõ ký tự nào trước), và danh sách này SHALL chỉ chứa những người đang là `leaderId` của ít nhất 1 phòng ban — không phải toàn bộ danh bạ công ty.

#### Scenario: Bấm nút mở danh sách đầy đủ
- **WHEN** người gửi bấm "Chọn quản lý trực tiếp" mà chưa gõ chữ nào
- **THEN** hệ thống hiện ngay toàn bộ danh sách người đang là trưởng phòng/đơn vị, có ô tìm kiếm để lọc thêm

#### Scenario: Danh sách không chứa người không phải quản lý
- **WHEN** hệ thống nạp danh sách cho picker "Chọn quản lý trực tiếp"
- **THEN** danh sách chỉ gồm người đang là `leaderId` của ≥1 phòng ban; nhân viên không giữ vai trò trưởng đơn vị nào SHALL không xuất hiện trong danh sách này

### Requirement: Server xác thực lại lựa chọn quản lý trực tiếp
Khi người gửi tự chọn 1 người khác thay cho giá trị auto-resolve, server SHALL xác thực người được chọn thực sự đang là `leaderId` của ≥1 phòng ban trước khi chấp nhận; nếu không hợp lệ hoặc không được gửi lên, server SHALL rơi về đúng hành vi auto-resolve theo `department.leaderId` như trước khi có tính năng này.

#### Scenario: Chọn 1 quản lý hợp lệ khác với auto-resolve
- **WHEN** người gửi chọn 1 người đang là trưởng phòng ban khác (không phải phòng ban của chính mình) làm quản lý trực tiếp, rồi gửi đề xuất
- **THEN** server chấp nhận người đó làm người duyệt bước `submitter_manager` của đề xuất này

#### Scenario: Giá trị gửi lên không hợp lệ
- **WHEN** đề xuất được gửi lên với 1 id người dùng cho bước `submitter_manager` nhưng người đó KHÔNG đang là `leaderId` của bất kỳ phòng ban nào
- **THEN** server bỏ qua giá trị đó và rơi về auto-resolve theo `department.leaderId` của người gửi như hành vi hiện tại

#### Scenario: Không gửi giá trị nào (tương thích ngược)
- **WHEN** đề xuất được gửi lên không kèm giá trị nào cho bước `submitter_manager` (client cũ hoặc không đổi gì)
- **THEN** server hoạt động y hệt hành vi hiện tại, tự resolve theo `department.leaderId`
