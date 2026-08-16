## ADDED Requirements

### Requirement: Field văn bản tự tính giá trị từ mẫu chuỗi có điều kiện
Hệ thống SHALL cho phép field kiểu `short_text` hoặc `paragraph` được cấu hình một danh sách nhánh (`computedFrom.branches`), mỗi nhánh gồm một điều kiện tuỳ chọn (`ConditionGroup`, dùng chung cơ chế với `visibleWhen`) và một mẫu chuỗi dùng cú pháp `${code}` để tham chiếu giá trị field khác trong CÙNG đề xuất. Cấu hình này KHÔNG làm thay đổi `dataType` của field.

Hệ thống SHALL đánh giá các nhánh theo thứ tự khai báo, dùng mẫu chuỗi của nhánh ĐẦU TIÊN có điều kiện thoả mãn (hoặc không có điều kiện — luôn khớp) để tính ra giá trị cuối cùng.

#### Scenario: Nhánh có điều kiện thoả mãn được dùng để tính giá trị
- **WHEN** field khác được điều kiện của 1 nhánh tham chiếu có giá trị khớp điều kiện đó
- **THEN** giá trị của field computed được tính bằng cách thay thế mọi `${code}` trong mẫu chuỗi của nhánh đó bằng giá trị field tương ứng

#### Scenario: Không nhánh nào khớp thì field cho nhập tay bình thường
- **WHEN** không có nhánh nào (kể cả nhánh không điều kiện) khớp với giá trị hiện tại của đề xuất
- **THEN** field được coi là chưa tính được giá trị, người dùng SHALL được phép tự gõ tay như field thường

#### Scenario: Mẫu chuỗi tham chiếu field không tồn tại
- **WHEN** mẫu chuỗi chứa `${code}` mà `code` đó không khớp field nào trong nhóm
- **THEN** hệ thống SHALL giữ nguyên chuỗi `${code}` không thay thế (không xoá trắng, không lỗi ngưng chương trình) để dễ phát hiện cấu hình sai

### Requirement: Field computed hiển thị chỉ đọc và tự tính lại theo thời gian thực
Trên form Gửi đề xuất, khi field có `computedFrom` VÀ tính ra được giá trị (có nhánh khớp), hệ thống SHALL hiển thị ô nhập ở chế độ chỉ đọc (không cho gõ tay) và SHALL tự động tính lại giá trị ngay khi bất kỳ field nguồn nào được tham chiếu trong mẫu chuỗi đang dùng thay đổi giá trị, không cần người dùng bấm nút nào.

#### Scenario: Đổi giá trị field nguồn cập nhật ngay field computed
- **WHEN** người dùng thay đổi giá trị của 1 field được tham chiếu trong mẫu chuỗi của nhánh đang khớp
- **THEN** giá trị hiển thị của field computed thay đổi theo ngay lập tức, không cần thao tác thêm

### Requirement: Máy chủ tự tính lại giá trị computed khi gửi chính thức, không tin giá trị từ client
Hệ thống SHALL tính lại giá trị của mọi field có `computedFrom` ngay tại máy chủ khi đề xuất được gửi chính thức, ghi đè bất kỳ giá trị nào client gửi lên cho field đó.

#### Scenario: Giá trị client gửi lên cho field computed bị ghi đè bởi giá trị máy chủ tự tính
- **WHEN** một request gửi đề xuất chính thức chứa giá trị tự đặt (khác giá trị đúng theo mẫu chuỗi) cho 1 field có `computedFrom`
- **THEN** hệ thống lưu giá trị đề xuất với field đó bằng giá trị máy chủ tự tính lại, không dùng giá trị client gửi lên

### Requirement: Ngăn field computed tham chiếu vòng tròn tới field computed khác
Hệ thống SHALL từ chối lưu cấu hình nhóm nếu mẫu chuỗi của 1 field computed tham chiếu (`${code}`) tới 1 field KHÁC cũng có `computedFrom` (không cho phép chuỗi tính toán nhiều tầng/đệ quy).

#### Scenario: Cấu hình field computed tham chiếu field computed khác bị từ chối
- **WHEN** quản trị viên cố lưu mẫu chuỗi của field A chứa `${code_cua_field_B}`, và field B cũng có `computedFrom`
- **THEN** API lưu nhóm trả về lỗi, giải thích rõ không được tham chiếu field computed khác
