# post-approval-supplement Specification

## Purpose
TBD - created by archiving change add-post-approval-supplement. Update Purpose after archive.
## Requirements
### Requirement: Khu vực "Bổ sung sau duyệt" chỉ hiện cho submitter của đề xuất đã duyệt
Hệ thống SHALL chỉ hiện khu vực "Bổ sung sau duyệt" (nối dòng bảng, đính file) trên trang chi tiết đề xuất khi `request.status === "approved"` VÀ người xem là `submittedBy.uid` của chính đề xuất đó. Owner/Admin KHÔNG được thao tác thay, kể cả khi có quyền quản trị toàn hệ thống.

#### Scenario: Submitter thấy khu vực bổ sung trên đề xuất đã duyệt của mình
- **WHEN** submitter mở trang chi tiết 1 đề xuất do chính mình tạo, đang ở trạng thái `"approved"`
- **THEN** hệ thống hiện nút "+ Bổ sung dữ liệu" cạnh mỗi field kiểu bảng, và nút "Thêm tài liệu" ở khu vực đính kèm

#### Scenario: Owner/Admin KHÔNG thấy nút bổ sung trên đề xuất người khác dù đã duyệt
- **WHEN** Owner hoặc Admin mở trang chi tiết 1 đề xuất đã duyệt do người khác tạo
- **THEN** hệ thống KHÔNG hiện nút "+ Bổ sung dữ liệu" và KHÔNG hiện nút "Thêm tài liệu"

#### Scenario: Submitter KHÔNG thấy khu vực bổ sung khi đề xuất chưa duyệt xong
- **WHEN** submitter mở trang chi tiết đề xuất của chính mình đang ở trạng thái `"draft"`, `"pending"`, `"returned"`, hoặc `"rejected"`
- **THEN** hệ thống KHÔNG hiện nút "+ Bổ sung dữ liệu"

### Requirement: Nối thêm dòng vào field bảng đã duyệt, không sửa/xoá dòng cũ
Hệ thống SHALL cho phép submitter nối thêm dòng mới vào field kiểu "table"/"base_table" của đề xuất đã duyệt, qua route riêng biệt với `PATCH /api/requests/[id]`. Dòng đã tồn tại trước đó SHALL giữ nguyên nội dung và thứ tự — hệ thống SHALL KHÔNG cung cấp bất kỳ cách nào (kể cả gián tiếp) để sửa hoặc xoá dòng đã có qua route này.

#### Scenario: Nối dòng mới thành công, giữ nguyên dòng cũ
- **WHEN** submitter tải file mẫu, điền 1 dòng dữ liệu đầy đủ theo đúng cột hiện có, rồi tải lên qua khu vực "Bổ sung sau duyệt"
- **THEN** hệ thống thêm dòng mới vào cuối bảng của field đó, giữ nguyên toàn bộ dòng cũ không đổi

#### Scenario: File import có cột lạ, tự thêm cột chỉ cho đề xuất này
- **WHEN** file tải lên có 1 cột chưa từng có trong bảng của field (ví dụ "Đơn giá")
- **THEN** hệ thống tự thêm cột đó vào `fieldsSnapshot` của đúng đề xuất này, dòng cũ hiển thị ô trống ở cột mới, dòng mới hiển thị giá trị đã nhập — field config của group (dùng cho các đề xuất khác/tương lai) SHALL KHÔNG bị thay đổi

#### Scenario: Không phải submitter thì bị từ chối
- **WHEN** một người không phải `submittedBy.uid` của đề xuất (kể cả Owner/Admin) gọi trực tiếp route nối dòng
- **THEN** hệ thống trả lỗi quyền, KHÔNG ghi thay đổi nào vào bảng

#### Scenario: Đề xuất chưa duyệt thì bị từ chối
- **WHEN** submitter gọi route nối dòng cho 1 đề xuất đang ở trạng thái khác `"approved"`
- **THEN** hệ thống trả lỗi, KHÔNG ghi thay đổi nào vào bảng

### Requirement: Đính kèm tài liệu vào đề xuất đã duyệt chỉ dành cho submitter
Hệ thống SHALL giữ nguyên quy tắc "submitter hoặc Owner/Admin" cho việc thêm tài liệu đính kèm cấp đề xuất khi đề xuất CHƯA ở trạng thái `"approved"`. Khi đề xuất ĐÃ ở trạng thái `"approved"`, hệ thống SHALL chỉ cho phép chính submitter thêm tài liệu — Owner/Admin SHALL bị từ chối.

#### Scenario: Submitter đính file vào đề xuất đã duyệt của mình
- **WHEN** submitter tải lên 1 file và bấm "Thêm tài liệu" trên đề xuất đã duyệt của chính mình
- **THEN** hệ thống thêm file vào `attachments[]` của đề xuất

#### Scenario: Owner/Admin bị từ chối đính file vào đề xuất đã duyệt của người khác
- **WHEN** Owner hoặc Admin gọi API thêm tài liệu cho 1 đề xuất đã duyệt do người khác tạo
- **THEN** hệ thống trả lỗi quyền, KHÔNG thêm file vào `attachments[]`

#### Scenario: Owner/Admin vẫn đính file được khi đề xuất chưa duyệt (hành vi cũ giữ nguyên)
- **WHEN** Owner hoặc Admin gọi API thêm tài liệu cho 1 đề xuất đang ở trạng thái `"draft"`, `"pending"`, hoặc `"returned"`
- **THEN** hệ thống vẫn cho phép thêm file như hành vi hiện có, không bị siết theo quy tắc mới

### Requirement: Mỗi lần bổ sung được ghi lại và đếm được thứ tự qua nhật ký hoạt động
Hệ thống SHALL ghi 1 dòng vào `history[]` của đề xuất mỗi khi nối dòng bảng hoặc đính file thành công sau khi đã duyệt, đủ thông tin để tính và hiển thị được "lần thứ mấy" và thời điểm thực hiện — không cần thêm trường lưu vết riêng trên dữ liệu bảng hoặc tệp đính kèm.

#### Scenario: Bổ sung dòng bảng lần đầu
- **WHEN** submitter nối dòng bảng lần đầu tiên sau khi đề xuất được duyệt
- **THEN** hệ thống ghi 1 dòng `history` với nội dung thể hiện đây là lần thứ 1, và trang chi tiết hiện nhãn "Bổ sung sau duyệt · lần 1 · <thời điểm>" cạnh bảng

#### Scenario: Bổ sung dòng bảng lần thứ hai trở đi
- **WHEN** submitter tiếp tục nối thêm dòng bảng ở 1 lượt khác, sau khi đã có ít nhất 1 lần bổ sung trước đó cho cùng đề xuất
- **THEN** hệ thống đếm đúng số lần bổ sung đã có trong `history` và ghi lần mới với số thứ tự tăng thêm 1, không trùng số với lần trước

