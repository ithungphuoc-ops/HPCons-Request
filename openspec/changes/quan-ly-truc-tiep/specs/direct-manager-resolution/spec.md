## ADDED Requirements

### Requirement: Luật xác định quản lý trực tiếp
Hệ thống SHALL xác định quản lý trực tiếp của người gửi theo thứ tự: (1) phần tử đầu tiên của `users/{uid}.directManagerIds` khác chính người gửi và có hồ sơ `users/{id}` tồn tại; (2) nếu không có, `leaderId` của đơn vị chính `users/{uid}.departmentId` khác chính người gửi, đi lên `departments/{id}.parentId` tối đa 10 bậc; (3) nếu vẫn không có thì kết quả là rỗng.

#### Scenario: Có quản lý gán tay
- **WHEN** người gửi có `directManagerIds = [m1, m2]` và m1 tồn tại
- **THEN** quản lý trực tiếp là m1

#### Scenario: Phần tử đầu là chính mình
- **WHEN** `directManagerIds = [chính mình, m2]`
- **THEN** quản lý trực tiếp là m2

#### Scenario: Không gán tay, đơn vị có trưởng
- **WHEN** `directManagerIds` trống và đơn vị chính có `leaderId` khác người gửi
- **THEN** quản lý trực tiếp là trưởng đơn vị đó

#### Scenario: Đơn vị chưa có trưởng hoặc người gửi là trưởng
- **WHEN** đơn vị chính không có `leaderId` hoặc `leaderId` là chính người gửi
- **THEN** hệ thống lấy trưởng của nhóm cha gần nhất có trưởng khác người gửi

#### Scenario: Vòng lặp nhóm cha
- **WHEN** chuỗi `parentId` tạo vòng lặp
- **THEN** hệ thống dừng sau tối đa 10 bậc và không treo

### Requirement: Bước duyệt quản lý trực tiếp khi gửi đề xuất
Bước `submitter_manager` không có lựa chọn tay SHALL dùng quản lý trực tiếp theo luật trên; nếu luật trả rỗng hệ thống SHALL chặn gửi với thông báo rõ ràng. Người duyệt đã lưu trong đề xuất đã gửi SHALL không bị thay đổi.

#### Scenario: Luật trả rỗng
- **WHEN** người gửi không chọn tay và luật không xác định được ai
- **THEN** hệ thống từ chối gửi và báo chưa xác định được quản lý trực tiếp

#### Scenario: Đề xuất cũ
- **WHEN** hồ sơ quản lý trực tiếp thay đổi sau khi đề xuất đã gửi
- **THEN** danh sách người duyệt đã lưu của đề xuất đó giữ nguyên

### Requirement: Gợi ý mặc định trên form gửi
Form gửi đề xuất SHALL điền sẵn quản lý trực tiếp đã xác định vào ô "Quản lý trực tiếp" kèm ghi chú đây là mặc định, và SHALL vẫn cho người gửi đổi sang người khác.

#### Scenario: Có quản lý trực tiếp
- **WHEN** người gửi mở form có bước `submitter_manager` và luật xác định được quản lý
- **THEN** ô hiện sẵn tên người đó, ghi "Mặc định…", có nút "Đổi"

#### Scenario: Không xác định được
- **WHEN** luật trả rỗng
- **THEN** ô để trống và bắt người gửi tự chọn như trước

### Requirement: Ưu tiên quản lý gán tay trong danh sách chọn
Danh sách "Chọn quản lý trực tiếp" SHALL giữ nguồn hiện có và đưa người trong `directManagerIds` của chính người đang chọn lên đầu theo đúng thứ tự; bộ nhớ đệm của phần này SHALL được khoá theo uid người dùng.

#### Scenario: Người dùng có directManagerIds
- **WHEN** người dùng có `directManagerIds = [a, b]` mở danh sách
- **THEN** a rồi b đứng đầu danh sách, phần còn lại giữ thứ tự cũ

### Requirement: Báo quản lý khi người gửi chọn người khác duyệt thay
Thông báo "người gửi chọn người khác duyệt thay" SHALL gửi cho quản lý trực tiếp xác định theo luật trên khi người đó không có trong danh sách người duyệt của đề xuất.

#### Scenario: Quản lý gán tay bị qua mặt
- **WHEN** nhóm bật báo quản lý, người gửi có `directManagerIds[0] = m1` và chọn người khác duyệt
- **THEN** m1 thấy đề xuất đó trong thông báo bị qua mặt
