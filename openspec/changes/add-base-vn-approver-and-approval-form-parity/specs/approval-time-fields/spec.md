## ADDED Requirements

### Requirement: Field tuỳ chỉnh gắn theo bước duyệt và hành động
`ProposalGroup` SHALL hỗ trợ danh sách `approvalTimeFields` — mỗi phần tử là 1 field tuỳ chỉnh gắn với đúng 1 bước duyệt (`approverStepCode`, chỉ chấp nhận bước `kind: "fixed"`) và đúng 1 hành động duyệt (`decisionAction`: chấp thuận/từ chối/chuyển tiếp/chấp thuận và chuyển tiếp). Field này KHÁC field của "Mẫu form đề xuất" (`ProposalGroup.fields`) — không do người gửi điền.

#### Scenario: Thêm field vào Mẫu form phê duyệt
- **WHEN** Admin thêm 1 field vào "Mẫu form phê duyệt", chọn "Liên kết đến" = bước duyệt cố định "KTTCH" và "Thuộc phần duyệt" = "Chấp thuận"
- **THEN** field được lưu vào `approvalTimeFields` của nhóm, không xuất hiện trong "Mẫu form đề xuất" của người gửi

#### Scenario: Chỉ liệt kê được bước duyệt cố định
- **WHEN** Admin mở dropdown "Liên kết đến (Khối người duyệt)" khi thêm field vào Mẫu form phê duyệt
- **THEN** dropdown chỉ hiển thị các bước duyệt có `kind: "fixed"` của nhóm, không hiển thị bước `submitter_manager`/`flexible_approver`

### Requirement: Hiển thị field đúng lúc người duyệt xử lý
Khi 1 người duyệt thuộc bước `fixed` mở hộp thoại thực hiện 1 hành động duyệt, hệ thống SHALL hiển thị thêm các field trong `approvalTimeFields` khớp đúng (`approverStepCode`, `decisionAction`) của bước và hành động đang xử lý, bắt buộc điền theo `field.required` trước khi xác nhận hành động.

#### Scenario: Field hiện đúng lúc Chấp thuận
- **WHEN** người duyệt thuộc bước "KTTCH" bấm "Chấp thuận" và nhóm có 1 field Mẫu form phê duyệt gắn (KTTCH, Chấp thuận)
- **THEN** hộp thoại xác nhận Chấp thuận hiển thị thêm field đó; nếu field bắt buộc mà chưa điền, hệ thống chặn xác nhận

#### Scenario: Field không hiện cho hành động khác
- **WHEN** người duyệt thuộc bước "KTTCH" bấm "Từ chối" (khác hành động đã gắn field là "Chấp thuận")
- **THEN** hộp thoại xác nhận Từ chối KHÔNG hiển thị field đó

#### Scenario: Field không hiện cho người duyệt khác bước
- **WHEN** người duyệt thuộc bước "TGĐ" bấm "Chấp thuận" và field Mẫu form phê duyệt chỉ gắn với bước "KTTCH"
- **THEN** hộp thoại xác nhận của "TGĐ" KHÔNG hiển thị field đó

### Requirement: Lưu giá trị tách biệt khỏi dữ liệu form gửi
Giá trị người duyệt điền vào field của Mẫu form phê duyệt SHALL được lưu vào `FirestoreRequest.approvalTimeValues` (khoá theo id field), KHÔNG ghi vào `values` (dữ liệu form người gửi điền ban đầu).

#### Scenario: Giá trị Mẫu form phê duyệt không lẫn vào dữ liệu gửi
- **WHEN** người duyệt điền giá trị vào field Mẫu form phê duyệt lúc Chấp thuận
- **THEN** giá trị được lưu vào `approvalTimeValues` của đề xuất, trang chi tiết đề xuất hiển thị riêng khu vực này, không trộn vào khối "Thông tin khác (mẫu đăng ký đề xuất)"
