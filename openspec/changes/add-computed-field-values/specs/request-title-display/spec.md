## ADDED Requirements

### Requirement: Tiêu đề hiển thị 1 đề xuất ưu tiên tên riêng, chỉ dự phòng bằng tên nhóm
Hệ thống SHALL xác định tiêu đề hiển thị của 1 đề xuất bằng cách: tìm field trong `fieldsSnapshot` có `code` thuộc tập mã đã quy ước cho "tên đề xuất" (`ten_de_xuat`, `ten_de_nghi`, `ten_phieu`, `ten_dang_ky`), lấy giá trị đã nhập của field đó làm tiêu đề nếu khác rỗng; nếu không tìm thấy field nào khớp hoặc giá trị rỗng, hệ thống SHALL dùng `groupNameSnapshot` (tên nhóm) làm tiêu đề dự phòng. Quy tắc này SHALL được áp dụng NHẤT QUÁN ở mọi nơi hệ thống hiển thị hoặc dùng tên của 1 đề xuất — không được có nơi nào tự ý dùng logic khác.

#### Scenario: Đề xuất có field tên riêng đã điền hiện đúng tên đó trên danh sách
- **WHEN** 1 đề xuất có field với `code` thuộc tập mã quy ước, đã có giá trị khác rỗng
- **THEN** trang danh sách đề xuất hiển thị đúng giá trị đó làm tiêu đề dòng, không hiển thị tên nhóm

#### Scenario: Đề xuất có field tên riêng đã điền hiện đúng tên đó trên trang chi tiết
- **WHEN** 1 đề xuất có field với `code` thuộc tập mã quy ước, đã có giá trị khác rỗng
- **THEN** trang xem chi tiết đề xuất đó hiển thị đúng giá trị đó làm tiêu đề, không hiển thị tên nhóm

#### Scenario: Đề xuất không có field tên riêng thì dùng tên nhóm như cũ
- **WHEN** 1 đề xuất không có field nào khớp tập mã quy ước, hoặc field đó rỗng
- **THEN** hệ thống hiển thị tên nhóm (`groupNameSnapshot`) làm tiêu đề, giữ nguyên hành vi trước đây
