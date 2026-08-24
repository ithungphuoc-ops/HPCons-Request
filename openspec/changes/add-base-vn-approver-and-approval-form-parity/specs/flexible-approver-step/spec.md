## ADDED Requirements

### Requirement: Bước duyệt kiểu "linh động"
`ApproverStepDef` SHALL hỗ trợ thêm kind `flexible_approver`: 1 vai trò/nhóm người duyệt do Admin tự gán tay nhiều người (`users: TaggedUser[]`), có `name: string` bắt buộc (nhãn hiển thị, vd "QL BP"). `users` SHALL được phép là mảng rỗng, thể hiện trạng thái "chưa cài đặt danh sách duyệt".

#### Scenario: Tạo bước duyệt linh động chưa gán người
- **WHEN** Admin thêm 1 bước "Người duyệt linh động" mới, đặt tên nhưng chưa chọn người nào
- **THEN** bước được lưu với `kind: "flexible_approver"`, `users: []`, và trang cài đặt nhóm hiển thị dòng phụ "Chưa cài đặt danh sách duyệt" dưới tên bước

#### Scenario: Gán người vào bước duyệt linh động
- **WHEN** Admin chọn thêm 2 người vào 1 bước `flexible_approver` đang rỗng
- **THEN** `users` của bước đó được cập nhật đúng 2 người, dòng "Chưa cài đặt danh sách duyệt" không còn hiển thị

### Requirement: Bỏ qua bước duyệt linh động rỗng khi gửi đề xuất
Khi gửi đề xuất chính thức, hệ thống SHALL loại bỏ khỏi danh sách người duyệt thực tế mọi bước `flexible_approver` có `users` rỗng (sau khi đã lọc theo điều kiện, nếu có) — không chặn việc gửi đề xuất chỉ vì lý do này.

#### Scenario: Gửi đề xuất khi có bước linh động chưa gán người
- **WHEN** đề xuất được gửi chính thức và 1 trong các bước duyệt của nhóm là `flexible_approver` với `users: []`
- **THEN** bước đó không xuất hiện trong `approversSnapshot`/`approvers` của đề xuất; các bước khác vẫn được đưa vào bình thường theo đúng thứ tự

#### Scenario: Mọi bước duyệt đều rỗng hoặc bị loại
- **WHEN** sau khi loại các bước `flexible_approver` rỗng và các bước không thoả điều kiện, danh sách người duyệt cuối cùng trống
- **THEN** hệ thống chặn gửi chính thức, trả lỗi rõ ràng thay vì tạo đề xuất không có người duyệt (giữ đúng hành vi đã có với bước có điều kiện không thoả)

### Requirement: Menu thêm bước duyệt đủ 5 lựa chọn
`ApproverStepsEditor` SHALL cung cấp đủ 5 lựa chọn khi thêm bước duyệt mới: người duyệt cố định, nhiều người duyệt cố định, quản lý trực tiếp, người duyệt linh động, người duyệt theo điều kiện.

#### Scenario: Thêm bước duyệt linh động từ menu
- **WHEN** người quản lý nhóm bấm "+ Thêm" và chọn "Thêm người duyệt linh động"
- **THEN** hệ thống thêm 1 bước mới `kind: "flexible_approver"`, `users: []`, yêu cầu nhập tên trước khi lưu được nhóm
