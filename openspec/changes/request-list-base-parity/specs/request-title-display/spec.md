## ADDED Requirements

### Requirement: Dòng danh sách đề xuất hiển thị đầy đủ thông tin kiểu Base.vn
Mỗi dòng trên danh sách đề xuất SHALL hiển thị: tiêu đề đề xuất; chuỗi thông tin phụ gồm tên nhóm và tối đa 3 field nổi bật ĐÃ CÓ GIÁ TRỊ của chính đề xuất đó (field kiểu lựa chọn/bộ phận/ngày/số, bỏ qua field tên đề xuất, theo thứ tự field trong nhóm, dạng "Tên field: giá trị"); trạng thái; ảnh + tên người gửi; cụm ảnh người duyệt (tối đa 3 + "+N") kèm chỉ báo quyết định từng người (đã duyệt/từ chối/đang chờ — dùng icon kèm màu, không chỉ màu); và ngày đề nghị.

#### Scenario: Đề xuất có bộ phận và ngày đề nghị cấp hiện đủ trên dòng
- **WHEN** 1 đề xuất thuộc nhóm có field "Bộ phận" (đã chọn) và "Ngày đề nghị cấp" (đã điền)
- **THEN** dòng danh sách hiện chuỗi phụ chứa "Bộ phận: <giá trị>" và "Ngày đề nghị cấp: <giá trị>" cùng tên nhóm

#### Scenario: Người duyệt đã chấp thuận có dấu tích trên avatar trong cụm người duyệt
- **WHEN** 1 đề xuất có 2 người duyệt, trong đó 1 người đã chấp thuận
- **THEN** cụm ảnh người duyệt hiện avatar cả 2, avatar của người đã chấp thuận có chấm tích xanh, người còn lại có chấm chờ

#### Scenario: Nhiều hơn 3 người duyệt hiện "+N"
- **WHEN** 1 đề xuất có 5 người duyệt
- **THEN** cụm hiện 3 avatar đầu + vòng tròn "+2"
