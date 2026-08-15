## ADDED Requirements

### Requirement: Chỉ kích hoạt khi đề xuất duyệt xong hoàn toàn
Hệ thống SHALL chỉ gọi đồng bộ sang QLK CTR khi trạng thái đề xuất (`status`, tính bởi `getRequestStatus()`) chuyển thành `"approved"` — không gọi khi mới có 1 phần người duyệt xử lý, khi từ chối, khi trả lại, hay khi chuyển tiếp.

#### Scenario: Duyệt xong 1 phần (còn người duyệt khác chưa xử lý)
- **WHEN** 1 người duyệt chấp thuận nhưng quy trình duyệt (đồng thời/lần lượt) chưa hoàn tất
- **THEN** không có lệnh gọi nào sang QLK CTR

#### Scenario: Duyệt xong hoàn toàn
- **WHEN** người duyệt cuối cùng cần thiết chấp thuận, `status` chuyển `"approved"`
- **THEN** hệ thống trích xuất dữ liệu và gọi API đồng bộ sang QLK CTR đúng 1 lần

### Requirement: Bỏ qua êm khi không đủ dữ liệu cần thiết
Hệ thống SHALL không gọi API đồng bộ nếu không tìm thấy field "Tên đề xuất"/"Chi tiết" tương ứng, hoặc bảng "Chi tiết" thiếu cột bắt buộc ("Tên hàng", "Số lượng"), hoặc không có dòng vật tư hợp lệ nào (tên rỗng hoặc số lượng ≤ 0) — không được báo lỗi cho người duyệt.

#### Scenario: Đề xuất không thuộc nhóm có 2 field cần dùng
- **WHEN** đề xuất duyệt xong không có field nào khớp "Tên đề xuất" hoặc "Chi tiết" (dạng bảng)
- **THEN** hệ thống bỏ qua, không gọi API, không ghi thêm gì vào lịch sử, thao tác duyệt vẫn thành công bình thường

#### Scenario: Bảng "Chi tiết" thiếu cột bắt buộc
- **WHEN** field bảng được xác định là "Chi tiết" nhưng cấu hình cột không có cột nào tên gần đúng "Tên hàng" hoặc "Số lượng"
- **THEN** hệ thống bỏ qua, không gọi API

### Requirement: Không phụ thuộc thứ tự cột cố định
Hệ thống SHALL xác định vị trí từng cột dữ liệu (Tên hàng, Quy cách, Số lượng, ĐVT, Mục đích sử dụng) bằng cách so khớp TÊN cột đã cấu hình trên field (`tableColumns`), không giả định vị trí cột theo số thứ tự cố định.

#### Scenario: Cột trong bảng bị sắp xếp khác thứ tự thông thường
- **WHEN** field "Chi tiết" có cột theo thứ tự khác (vd ĐVT đứng trước Số lượng)
- **THEN** dữ liệu vẫn được trích xuất đúng vào từng trường tương ứng, không bị lệch cột

### Requirement: Lỗi đồng bộ không ảnh hưởng thao tác duyệt
Nếu bước trích xuất dữ liệu hoặc gọi API đồng bộ gặp lỗi (thiếu cấu hình `QLKCTR_API_URL`, lỗi mạng, QLK CTR phản hồi lỗi/timeout), hệ thống SHALL vẫn trả về kết quả duyệt thành công cho người dùng — lỗi đồng bộ chỉ được ghi lại, không được ném ra ngoài làm hỏng response.

#### Scenario: QLK CTR không phản hồi hoặc lỗi
- **WHEN** lệnh gọi API sang QLK CTR bị lỗi mạng, timeout, hoặc trả về lỗi
- **THEN** đề xuất vẫn ở trạng thái "Đã chấp thuận" bình thường, người duyệt nhận response thành công như cũ

### Requirement: Ghi lại kết quả đồng bộ vào lịch sử xử lý
Khi đã gọi API đồng bộ (tìm đủ dữ liệu để gửi), hệ thống SHALL ghi thêm 1 mục vào `history` của đề xuất, actor `"Hệ thống"`, cho biết đồng bộ thành công (kèm tên công trình nhận diện được) hay thất bại (kèm lý do).

#### Scenario: Đồng bộ thành công
- **WHEN** QLK CTR xác nhận đã tạo đề nghị hoặc đưa vào hàng chờ xác nhận công trình
- **THEN** `history` có thêm 1 dòng "Đã đồng bộ sang QLK CTR" kèm tên công trình (nếu tự nhận diện được) hoặc ghi chú "chờ xác nhận"

#### Scenario: Đồng bộ thất bại
- **WHEN** lệnh gọi API thất bại vì bất kỳ lý do gì
- **THEN** `history` có thêm 1 dòng "Đồng bộ QLK CTR thất bại" kèm lý do lỗi ngắn gọn
