## ADDED Requirements

### Requirement: Cờ cấu hình trên field kiểu Văn bản ngắn
Hệ thống SHALL cho phép Admin/Owner bật/tắt cờ `contractCodeLookup` trên bất kỳ field kiểu `short_text` nào khi thiết lập mẫu đề xuất, độc lập với các cờ khác đã có (`suggestFromHistory`, `dateLeadTimeRule`...). Cờ này KHÔNG được suy luận từ tên field.

#### Scenario: Bật cờ cho field "Số Hợp Đồng CĐT"
- **WHEN** Admin mở cấu hình 1 field kiểu "Văn bản ngắn" và bật công tắc "Bắt buộc khớp Số Hợp Đồng CĐT (app Công nợ)"
- **THEN** hệ thống lưu `contractCodeLookup: true` trên field đó trong mẫu của nhóm

#### Scenario: Field kiểu khác không có tuỳ chọn này
- **WHEN** Admin cấu hình 1 field không phải kiểu "Văn bản ngắn" (vd "Một lựa chọn", "Ngày")
- **THEN** hệ thống KHÔNG hiện công tắc "Bắt buộc khớp Số Hợp Đồng CĐT"

### Requirement: Gợi ý từ danh sách hợp đồng thật, không lộ dữ liệu tài chính
Hệ thống SHALL cung cấp gợi ý (danh sách Số Hợp Đồng CĐT) cho field đã bật `contractCodeLookup`, đọc từ collection `contracts` của project Firestore riêng của app Công nợ ("hpcons-congno"). Phản hồi SHALL CHỈ chứa `code`, `project` (tên dự án) và `work` ("hạng mục" — mô tả công việc) của mỗi hợp đồng — KHÔNG chứa bất kỳ field tài chính/nhạy cảm nào khác (số tiền hợp đồng, tên chủ đầu tư...).

#### Scenario: Lấy gợi ý cho field đã bật cờ
- **WHEN** người dùng mở form gửi đề xuất có field bật `contractCodeLookup`
- **THEN** hệ thống trả về danh sách hợp đồng thật (mỗi phần tử có `code`, `project`, `work`) để hiện gợi ý

#### Scenario: Hiện hạng mục để đối chiếu, phát hiện gõ nhầm số hợp đồng
- **WHEN** người dùng chọn/gõ đúng 1 Số Hợp Đồng CĐT thật khớp trong danh sách gợi ý
- **THEN** hệ thống hiện ngay "Hạng mục" (`work`) của đúng hợp đồng đó ngay dưới ô nhập, để người dùng tự đối chiếu có đang nhầm số hợp đồng của 1 hạng mục khác không

#### Scenario: Hợp đồng chưa có sẵn hạng mục
- **WHEN** hợp đồng khớp đúng nhưng field `work` rỗng/chưa điền bên app Công nợ
- **THEN** hệ thống KHÔNG hiện dòng "Hạng mục" (không hiện dòng trống gây hiểu nhầm)

#### Scenario: Gọi cho field chưa bật cờ
- **WHEN** có request gọi thẳng route gợi ý với `fieldId` của 1 field KHÔNG bật `contractCodeLookup` (hoặc không tồn tại)
- **THEN** hệ thống từ chối, không trả về dữ liệu hợp đồng nào

#### Scenario: Chưa cấu hình được kết nối tới app Công nợ
- **WHEN** biến môi trường service account của project Công nợ chưa được thiết lập trên máy chủ
- **THEN** hệ thống trả lỗi rõ ràng cho route gợi ý, KHÔNG làm sập trang gửi đề xuất — các field khác của form vẫn hoạt động bình thường

### Requirement: Chặn gửi đề xuất chính thức nếu giá trị không khớp hợp đồng thật
Hệ thống SHALL kiểm tra lại (phía máy chủ, đọc trực tiếp dữ liệu hợp đồng tại thời điểm gửi — không tin danh sách phía trình duyệt) mọi field có `contractCodeLookup: true` VÀ có giá trị khác rỗng khi gửi đề xuất CHÍNH THỨC (tạo mới hoặc gửi từ nháp). Giá trị không khớp CHÍNH XÁC 1 `code` thật SHALL bị chặn gửi, kèm thông báo lỗi rõ ràng nêu tên field. Luật này SHALL KHÔNG áp dụng khi lưu nháp.

#### Scenario: Gửi đề xuất với giá trị khớp đúng hợp đồng thật
- **WHEN** người dùng gửi chính thức 1 đề xuất, field bật `contractCodeLookup` có giá trị đúng bằng 1 `code` thật đang tồn tại
- **THEN** hệ thống cho gửi bình thường

#### Scenario: Gửi đề xuất với giá trị không khớp hợp đồng nào
- **WHEN** người dùng gửi chính thức 1 đề xuất, field bật `contractCodeLookup` có giá trị KHÔNG khớp `code` thật nào
- **THEN** hệ thống từ chối gửi, trả lỗi nêu rõ tên field, KHÔNG tạo/cập nhật đề xuất

#### Scenario: Field không bắt buộc, để trống
- **WHEN** field bật `contractCodeLookup` nhưng `required: false`, người dùng để trống khi gửi chính thức
- **THEN** hệ thống KHÔNG áp luật khớp hợp đồng (rỗng vẫn hợp lệ, giống mọi field không bắt buộc khác)

#### Scenario: Lưu nháp không bị chặn
- **WHEN** người dùng lưu nháp 1 đề xuất có field bật `contractCodeLookup` với giá trị không khớp hợp đồng nào (hoặc để trống)
- **THEN** hệ thống vẫn lưu nháp bình thường, không kiểm tra luật này

### Requirement: Field "Tên công trình" và các field khác không thay đổi hành vi
Hệ thống SHALL KHÔNG áp dụng bất kỳ ràng buộc, gợi ý ép buộc, hay tự động điền chéo nào giữa field bật `contractCodeLookup` và các field khác của cùng đề xuất.

#### Scenario: Tên công trình vẫn gõ tự do
- **WHEN** người dùng điền field "Tên công trình" (hoặc bất kỳ field short_text nào khác không bật `contractCodeLookup`) trên cùng đề xuất
- **THEN** hệ thống cho gõ nội dung bất kỳ, không kiểm tra đối chiếu với dữ liệu hợp đồng, không tự động điền từ field kia
