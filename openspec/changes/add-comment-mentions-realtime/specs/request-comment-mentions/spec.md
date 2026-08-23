## ADDED Requirements

### Requirement: Bình luận cập nhật real-time trên trang chi tiết đề xuất
Khi đang mở trang chi tiết 1 đề xuất, hệ thống SHALL tự động hiển thị bình luận mới do người khác vừa đăng, không yêu cầu tải lại trang.

#### Scenario: Người khác vừa đăng bình luận khi đang mở cùng đề xuất
- **WHEN** người dùng đang mở trang chi tiết 1 đề xuất, và một người khác có quyền xem đề xuất đó vừa gửi 1 bình luận mới
- **THEN** bình luận mới xuất hiện trong khung Thảo luận của người dùng đang xem mà không cần thao tác tải lại

### Requirement: @mention người và nhóm/phòng ban trong bình luận
Ô nhập bình luận SHALL cho phép gõ để tìm và chọn cả nhân viên lẫn nhóm thành viên/phòng ban, lưu id có cấu trúc vào `mentionIds` của bình luận.

#### Scenario: Mention 1 nhân viên cụ thể
- **WHEN** người dùng gõ tìm và chọn 1 nhân viên trong ô nhập bình luận
- **THEN** uid của nhân viên đó được thêm vào `mentionIds` khi gửi bình luận

#### Scenario: Mention 1 nhóm/phòng ban
- **WHEN** người dùng gõ tìm và chọn 1 nhóm thành viên hoặc phòng ban trong ô nhập bình luận
- **THEN** id của nhóm/phòng ban đó được thêm vào `mentionIds` khi gửi bình luận

### Requirement: Mention hiển thị trong chuông thông báo
Đề xuất có bình luận mention 1 người SHALL xuất hiện trong danh sách thông báo của người đó (qua `NotificationBell`); mention 1 nhóm/phòng ban SHALL khiến đề xuất xuất hiện trong thông báo của TẤT CẢ thành viên nhóm/phòng ban đó.

#### Scenario: Mention 1 người — thấy trong chuông thông báo
- **WHEN** 1 bình luận mention 1 nhân viên cụ thể được gửi trên 1 đề xuất
- **THEN** khi nhân viên đó tải lại trang có `NotificationBell`, họ thấy mục thông báo liên quan đến đề xuất đó

#### Scenario: Mention 1 nhóm — mọi thành viên đều thấy
- **WHEN** 1 bình luận mention 1 nhóm thành viên có N người
- **THEN** khi bất kỳ ai trong N người đó tải lại trang, họ đều thấy mục thông báo liên quan đến đề xuất đó

### Requirement: Danh sách bình luận hiển thị phẳng, không trả lời lồng cấp
Hệ thống SHALL hiển thị mọi bình luận trên 1 đề xuất ở dạng danh sách phẳng, sắp xếp theo thời gian đăng. Hệ thống SHALL KHÔNG cung cấp chức năng "trả lời" gắn 1 bình luận vào bình luận khác — không có UI, không có endpoint tạo `parentId` mới. Đây là ĐỔI HƯỚNG so với thiết kế ban đầu của capability này (từng có "trả lời 1 cấp") — bỏ theo quyết định của Sếp ngày 24/08/2026.

#### Scenario: Gửi bình luận mới luôn là ngang hàng
- **WHEN** người dùng gửi 1 bình luận mới trên đề xuất (không có cách nào chỉ định nó là "trả lời" cho bình luận khác)
- **THEN** bình luận được lưu không có `parentId`, hiển thị ngang hàng với mọi bình luận khác theo đúng thứ tự thời gian

#### Scenario: Dữ liệu trả lời cũ (nếu có từ trước) vẫn hiển thị được, không lỗi
- **WHEN** đề xuất có bình luận cũ từng được lưu với `parentId` (từ trước khi tính năng trả lời bị bỏ)
- **THEN** hệ thống vẫn hiển thị bình luận đó bình thường trong danh sách phẳng (không cần xóa dữ liệu cũ, không throw lỗi vì có `parentId`)

### Requirement: Tác giả tự sửa/xóa bình luận của mình trong 10 phút kể từ lúc đăng
Tác giả 1 bình luận SHALL được phép sửa nội dung hoặc xóa bình luận đó của chính mình, CHỈ trong vòng 10 phút kể từ thời điểm đăng (`comment.at`, tính theo đồng hồ server). Sau 10 phút, tác giả SHALL KHÔNG còn quyền sửa hoặc xóa bình luận đó nữa.

#### Scenario: Tác giả sửa bình luận trong 10 phút đầu
- **WHEN** tác giả gửi yêu cầu sửa nội dung 1 bình luận do chính họ tạo, và chưa quá 10 phút kể từ lúc đăng
- **THEN** nội dung được cập nhật, đánh dấu đã sửa (`editedAt`); mốc 10 phút KHÔNG được làm mới lại theo `editedAt` — vẫn tính từ `comment.at` ban đầu

#### Scenario: Tác giả xóa bình luận trong 10 phút đầu
- **WHEN** tác giả gửi yêu cầu xóa 1 bình luận do chính họ tạo, và chưa quá 10 phút kể từ lúc đăng
- **THEN** bình luận bị xóa khỏi đề xuất

#### Scenario: Tác giả cố sửa/xóa sau khi đã quá 10 phút
- **WHEN** tác giả gửi yêu cầu sửa hoặc xóa 1 bình luận của chính họ, nhưng đã quá 10 phút kể từ `comment.at`
- **THEN** hệ thống từ chối với lỗi 403 (kiểm tra lại thời gian ở server, không tin trạng thái nút ẩn/hiện phía client)

#### Scenario: Người khác (không phải tác giả, không phải Owner) cố sửa/xóa
- **WHEN** một người dùng không phải tác giả và role không phải "owner" cố sửa hoặc xóa 1 bình luận không phải của họ
- **THEN** hệ thống từ chối với lỗi 403, bất kể bình luận đã khóa (quá 10 phút) hay chưa

### Requirement: Chỉ Owner xóa được bình luận đã khóa (quá 10 phút) của người khác
Sau khi 1 bình luận đã quá 10 phút kể từ lúc đăng (không còn thuộc quyền tự sửa/xóa của tác giả), CHỈ người dùng có `session.role === "owner"` SHALL được phép xóa bình luận đó. Owner SHALL KHÔNG có quyền sửa nội dung bình luận của người khác — chỉ có quyền xóa. Vai trò "admin" (khác "owner") SHALL KHÔNG có quyền này — thu hẹp hơn hành vi "Admin/Owner kiểm duyệt" ban đầu của capability này.

#### Scenario: Owner xóa bình luận đã khóa của người khác
- **WHEN** người dùng có `role === "owner"` gửi yêu cầu xóa 1 bình luận đã quá 10 phút, do người khác tạo
- **THEN** hệ thống cho phép xóa thành công

#### Scenario: Admin (không phải Owner) cố xóa bình luận đã khóa của người khác
- **WHEN** người dùng có `role === "admin"` (không phải "owner") gửi yêu cầu xóa 1 bình luận đã quá 10 phút, do người khác tạo
- **THEN** hệ thống từ chối với lỗi 403

#### Scenario: Owner cố sửa nội dung bình luận của người khác
- **WHEN** người dùng có `role === "owner"` gửi yêu cầu SỬA nội dung 1 bình luận do người khác tạo (bất kể đã khóa hay chưa)
- **THEN** hệ thống từ chối với lỗi 403 — Owner chỉ có quyền xóa, không có quyền sửa hộ

### Requirement: Đính kèm file trong bình luận
Ô soạn bình luận SHALL cho phép đính kèm tối đa 1 file trước khi gửi, tái dùng cơ chế tải file hiện có (`POST /api/uploads`, lưu Cloudflare R2). Bình luận có file đính kèm SHALL hiển thị tên + dung lượng file, bấm vào SHALL mở popup xem trước (tái dùng `FilePreviewModal` đã có, không tạo modal riêng).

#### Scenario: Gửi bình luận kèm 1 file
- **WHEN** người dùng chọn 1 file trong ô soạn bình luận rồi gửi
- **THEN** file được tải lên qua cơ chế tải file hiện có, và bình luận được lưu kèm thông tin file đó (tên, đường dẫn, dung lượng)

#### Scenario: Xem trước file đính kèm trong bình luận
- **WHEN** người dùng bấm vào dòng file đính kèm của 1 bình luận đã gửi
- **THEN** popup xem trước file (component xem trước đã dùng cho các tài liệu đính kèm khác của đề xuất) hiện ra, không điều hướng rời trang

#### Scenario: File đính kèm chịu chung luật 10 phút của bình luận
- **WHEN** 1 bình luận có file đính kèm đã quá 10 phút kể từ lúc đăng
- **THEN** không có cách nào xóa/thay riêng file đó — chỉ có thể xóa nguyên cả bình luận (theo đúng quyền xóa bình luận đã khóa ở trên), không có API xóa file độc lập
