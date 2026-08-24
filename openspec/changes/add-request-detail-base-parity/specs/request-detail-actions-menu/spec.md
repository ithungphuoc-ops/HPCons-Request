## ADDED Requirements

### Requirement: Menu "Thêm" đầy đủ nhóm hành động trên trang chi tiết đề xuất
Menu "⋯ Thêm" trên trang chi tiết đề xuất SHALL hiển thị đủ các dòng sau, chia thành các nhóm bằng đường kẻ ngang, theo đúng thứ tự: (1) Sao chép đường dẫn, Xem ở trong tab mới; (2) In đề xuất, In đề xuất và thảo luận, In đề xuất theo mẫu ra file Word, In đề xuất theo mẫu ra file PDF; (3) Đánh dấu đề xuất, Lịch sử webhook; (4) Thêm nhiều người theo dõi, Xuất dữ liệu cho bảng; (5) Nhân bản, Xóa.

#### Scenario: Mở menu Thêm thấy đủ các nhóm
- **WHEN** người dùng bấm nút "⋯ Thêm" trên trang chi tiết đề xuất
- **THEN** menu hiện đủ 10 dòng chia 5 nhóm theo đúng thứ tự ở trên

### Requirement: Sao chép đường dẫn đề xuất
Bấm "Sao chép đường dẫn" SHALL chép URL hiện tại của trang chi tiết đề xuất vào clipboard trình duyệt, không gọi server.

#### Scenario: Sao chép đường dẫn thành công
- **WHEN** người dùng bấm "Sao chép đường dẫn"
- **THEN** URL trang hiện tại được ghi vào clipboard; hệ thống hiện xác nhận ngắn (toast) báo đã chép xong

### Requirement: Xem đề xuất ở tab mới
Bấm "Xem ở trong tab mới" SHALL mở URL hiện tại của trang chi tiết đề xuất trong 1 tab trình duyệt mới, giữ nguyên tab hiện tại.

#### Scenario: Mở tab mới
- **WHEN** người dùng bấm "Xem ở trong tab mới"
- **THEN** 1 tab mới mở ra với đúng URL đề xuất đang xem; tab hiện tại không đổi

### Requirement: In nhanh đề xuất qua trình duyệt
Bấm "In đề xuất" SHALL mở hộp thoại in của trình duyệt, chỉ hiển thị phần thông tin đề xuất (ẩn sidebar, nút bấm, không hiện khung Thảo luận). Bấm "In đề xuất và thảo luận" SHALL làm tương tự nhưng KHÔNG ẩn khung Thảo luận.

#### Scenario: In đề xuất (không kèm thảo luận)
- **WHEN** người dùng bấm "In đề xuất"
- **THEN** hộp thoại in trình duyệt mở ra, bản in không có sidebar/nút bấm/khung Thảo luận

#### Scenario: In đề xuất và thảo luận
- **WHEN** người dùng bấm "In đề xuất và thảo luận"
- **THEN** hộp thoại in trình duyệt mở ra, bản in có thêm nội dung khung Thảo luận, vẫn ẩn sidebar/nút bấm

### Requirement: In theo mẫu Word (gộp cơ chế đã có)
Dòng "In đề xuất theo mẫu ra file Word" trong menu "Thêm" SHALL dẫn tới đúng danh sách mẫu in (`printTemplates`) và cơ chế xuất file đã có (`/api/requests/[id]/export?templateId=`), không tạo luồng tải mẫu mới.

#### Scenario: Chọn "In theo mẫu ra file Word"
- **WHEN** người dùng bấm dòng "In đề xuất theo mẫu ra file Word" và chọn 1 mẫu in
- **THEN** file Word được xuất đúng như cơ chế "In theo mẫu" hiện có trên trang

### Requirement: Đặt chỗ UI cho In theo mẫu PDF (chưa triển khai thật)
Dòng "In đề xuất theo mẫu ra file PDF" SHALL hiển thị ở trạng thái disabled kèm chú thích ngắn (ví dụ "Sắp có"), KHÔNG thực thi xuất PDF thật — việc xuất PDF thuộc phạm vi change `add-pdf-export` (đang chờ hạ tầng), không triển khai ở change này.

#### Scenario: Bấm dòng "In theo mẫu ra file PDF" (đang disabled)
- **WHEN** người dùng bấm vào dòng "In đề xuất theo mẫu ra file PDF"
- **THEN** không có hành động xuất file nào xảy ra (dòng ở trạng thái disabled/chỉ mang tính đặt chỗ)

### Requirement: Đặt chỗ UI cho Lịch sử webhook (chưa triển khai thật)
Dòng "Lịch sử webhook" SHALL hiển thị ở trạng thái disabled kèm chú thích ngắn, KHÔNG có hạ tầng webhook thật cho từng đề xuất trong change này.

#### Scenario: Bấm dòng "Lịch sử webhook" (đang disabled)
- **WHEN** người dùng bấm vào dòng "Lịch sử webhook"
- **THEN** không có hành động nào xảy ra (dòng ở trạng thái disabled/chỉ mang tính đặt chỗ)

### Requirement: Xuất dữ liệu đề xuất ra CSV
Dòng "Xuất dữ liệu cho bảng" SHALL tạo 1 file CSV (tên field làm cột, giá trị đề xuất hiện tại làm 1 dòng dữ liệu) và tải xuống ngay phía trình duyệt, không gọi API server, không thêm dependency mới.

#### Scenario: Xuất CSV
- **WHEN** người dùng bấm "Xuất dữ liệu cho bảng"
- **THEN** 1 file `.csv` được tải xuống, dòng tiêu đề là tên các field của đề xuất, dòng dữ liệu là giá trị hiện tại

### Requirement: Nhân bản và Xóa giữ nguyên hành vi hiện có
Dòng "Nhân bản" và "Xóa" trong menu mở rộng SHALL giữ nguyên đúng hành vi/quyền hiện có của `RequestDetailView.tsx` (không đổi logic, chỉ đổi vị trí hiển thị vào nhóm cuối của menu mới).

#### Scenario: Nhân bản đề xuất từ menu mới
- **WHEN** người dùng bấm "Nhân bản" trong menu "Thêm" đã mở rộng
- **THEN** hành vi nhân bản giữ nguyên như trước khi mở rộng menu (điều hướng tới bản sao ở trạng thái nháp)
