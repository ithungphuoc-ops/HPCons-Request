## ADDED Requirements

### Requirement: Tải file mẫu Excel theo đúng cột đang cấu hình
Khi soạn 1 đề xuất có field kiểu "table"/"base_table", hệ thống SHALL cung cấp nút "Tải file mẫu" sinh 1 file `.xlsx` có dòng tiêu đề là ĐÚNG các cột hiện có trong `field.tableColumns`, không có dòng dữ liệu mẫu bên dưới.

#### Scenario: Tải file mẫu cho field bảng có cột
- **WHEN** người dùng bấm "Tải file mẫu" trên 1 field bảng có `tableColumns = ["Nội dung", "Số lượng", "Đơn giá"]`
- **THEN** file `.xlsx` tải xuống có dòng đầu đúng 3 cột đó, theo đúng thứ tự

#### Scenario: Field bảng chưa có cột nào
- **WHEN** field bảng chưa cấu hình `tableColumns` (rỗng)
- **THEN** nút "Tải file mẫu" không hiển thị hoặc hiển thị disabled (không có gì để sinh mẫu)

### Requirement: Nhập dữ liệu bảng từ file đã điền — nối thêm dòng vào cột khớp tên
Hệ thống SHALL cho phép chọn 1 file `.xlsx`/`.csv` đã điền dữ liệu, đọc dòng tiêu đề để xác định cột, và với MỖI CỘT trong file có tên KHỚP (so sánh không phân biệt hoa/thường, bỏ khoảng trắng đầu-cuối) với 1 cột đã có trong `field.tableColumns`: mỗi dòng dữ liệu còn lại trong file (sau dòng tiêu đề) SHALL được thêm thành 1 dòng MỚI vào giá trị bảng hiện tại của field đó, KHÔNG xóa/ghi đè các dòng đã có trước.

#### Scenario: Import file có toàn bộ cột khớp tên
- **WHEN** người dùng chọn 1 file có dòng tiêu đề khớp hoàn toàn với `field.tableColumns` hiện có, và 2 dòng dữ liệu
- **THEN** 2 dòng dữ liệu đó được thêm vào cuối bảng hiện tại của đề xuất đang soạn, các dòng cũ (nếu có) vẫn còn nguyên

#### Scenario: File trống (chỉ có dòng tiêu đề, không có dữ liệu)
- **WHEN** người dùng chọn 1 file chỉ có dòng tiêu đề, không có dòng dữ liệu nào
- **THEN** hệ thống không thêm dòng nào, hiển thị thông báo không có dữ liệu để nhập

### Requirement: Tự động thêm cột mới nếu file có cột chưa từng cấu hình
Nếu file import có 1 cột ở dòng tiêu đề KHÔNG khớp tên với bất kỳ cột nào trong `field.tableColumns` hiện có, hệ thống SHALL tự động thêm cột đó vào `field.tableColumns` của field (áp dụng cho toàn bộ field đó trong nhóm đề xuất, không chỉ riêng đề xuất đang soạn), rồi mới nối dữ liệu dòng tương ứng vào cột mới đó.

#### Scenario: File có 1 cột chưa từng cấu hình
- **WHEN** file import có cột "Ghi chú nghiệm thu" chưa có trong `field.tableColumns` hiện có
- **THEN** cột "Ghi chú nghiệm thu" được thêm vào cuối `field.tableColumns` của field đó (thuộc cấu hình nhóm), và dữ liệu cột này từ file được nối vào đúng dòng mới thêm

#### Scenario: Cột mới thêm ảnh hưởng các đề xuất khác của cùng nhóm
- **WHEN** 1 cột mới được tự động thêm vào `field.tableColumns` từ hành động import của 1 đề xuất
- **THEN** các đề xuất KHÁC tạo sau đó trong cùng nhóm cũng thấy cột mới này khi nhập bảng (vì cấu hình cột thuộc về field của nhóm, không phải riêng 1 đề xuất)
