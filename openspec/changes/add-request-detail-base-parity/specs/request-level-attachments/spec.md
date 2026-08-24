## ADDED Requirements

### Requirement: Card "Tài liệu đính kèm" ở cấp đề xuất
Trang chi tiết đề xuất SHALL hiển thị 1 card riêng "Tài liệu đính kèm", đặt sau card "Thông tin khác" và trước card "Thảo luận", liệt kê các file thuộc `RequestInstance.attachments` (KHÁC file đính kèm trong `values` của field kiểu "Tệp tin" — 2 danh sách độc lập, không gộp chung).

#### Scenario: Đề xuất chưa có tài liệu đính kèm cấp đề xuất
- **WHEN** `attachments` của đề xuất rỗng hoặc chưa có
- **THEN** card "Tài liệu đính kèm" vẫn hiển thị, kèm trạng thái trống (ví dụ "Chưa có tài liệu nào") và nút thêm tài liệu

#### Scenario: Đề xuất đã có tài liệu đính kèm cấp đề xuất
- **WHEN** `attachments` của đề xuất có ít nhất 1 file
- **THEN** card hiển thị danh sách file (tên + dung lượng)

### Requirement: Thêm tài liệu vào đề xuất — chỉ chủ đề xuất hoặc Owner/Admin
Card "Tài liệu đính kèm" SHALL có nút thêm tài liệu, chỉ hiển thị/hoạt động cho người là chủ đề xuất (`isOwnRequest`) hoặc có `canManageGroupsAtAppScope(session.role)`. Người khác SHALL chỉ xem, không thêm được.

#### Scenario: Chủ đề xuất thêm 1 tài liệu
- **WHEN** chủ đề xuất chọn 1 file và bấm thêm vào card "Tài liệu đính kèm"
- **THEN** file được tải lên qua cơ chế tải file hiện có (`/api/uploads`), rồi thêm vào `attachments` của đề xuất, hiển thị ngay trong danh sách

#### Scenario: Owner/Admin thêm tài liệu vào đề xuất không phải của mình
- **WHEN** người dùng có vai trò Owner hoặc Admin (không phải chủ đề xuất) thêm 1 tài liệu vào đề xuất của người khác
- **THEN** hệ thống cho phép thêm thành công

#### Scenario: Người xem thường (không phải chủ, không phải Owner/Admin) cố thêm tài liệu
- **WHEN** người dùng không phải chủ đề xuất và không có `canManageGroupsAtAppScope` cố gọi API thêm tài liệu
- **THEN** hệ thống từ chối với lỗi 403; nút thêm cũng không hiển thị cho người này ở UI

### Requirement: Xem trước tài liệu đính kèm cấp đề xuất
Bấm vào 1 tài liệu trong card "Tài liệu đính kèm" SHALL mở popup xem trước (tái dùng `FilePreviewModal` đã có), không điều hướng rời trang, không tạo modal riêng.

#### Scenario: Xem trước 1 tài liệu
- **WHEN** người dùng bấm vào 1 dòng tài liệu trong card "Tài liệu đính kèm"
- **THEN** `FilePreviewModal` mở ra hiển thị đúng file đó
