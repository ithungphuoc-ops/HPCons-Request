## ADDED Requirements

### Requirement: Thêm nhà thầu phụ mới ngay tại app Đề xuất
Với field kiểu `short_text` bật `externalCodeLookup.sourceId === "congno_subcontractors"`, người làm đề xuất SHALL có thể thêm 1 nhà thầu phụ mới chưa có trong Công nợ ngay tại ô nhập, mà không cần rời khỏi app Đề xuất. Hệ thống SHALL KHÔNG cung cấp khả năng này cho nguồn `congno_contracts` hay bất kỳ nguồn nào khác.

#### Scenario: Gõ không khớp bản ghi nào, bấm thêm mới
- **WHEN** người dùng gõ vào field đã bật ràng buộc nguồn `congno_subcontractors` một giá trị không khớp bất kỳ nhà thầu phụ nào đang có
- **THEN** danh sách gợi ý hiện thêm 1 dòng "+ Thêm nhà thầu phụ mới", bấm vào mở modal nhập liệu nhà thầu phụ mới

#### Scenario: Field nguồn khác không có khả năng này
- **WHEN** người dùng gõ vào field đã bật ràng buộc nguồn `congno_contracts` (Số Hợp Đồng CĐT)
- **THEN** danh sách gợi ý KHÔNG hiện bất kỳ lựa chọn "thêm mới" nào

### Requirement: Validate tối thiểu trước khi ghi
Hệ thống SHALL yêu cầu "Tên nhà cung cấp" và "MST hoặc CCCD" không rỗng trước khi cho phép ghi nhà thầu phụ mới; "Tên viết tắt" và "Địa chỉ" KHÔNG bắt buộc. "Nhóm" mặc định "THẦU PHỤ", chỉ nhận đúng 2 giá trị "THẦU PHỤ" hoặc "TỔ ĐỘI".

#### Scenario: Thiếu tên nhà cung cấp
- **WHEN** người dùng bấm "Thêm & chọn luôn" mà để trống "Tên nhà cung cấp"
- **THEN** hệ thống báo lỗi ngay tại modal, KHÔNG gọi API ghi

#### Scenario: Thiếu MST/CCCD
- **WHEN** người dùng bấm "Thêm & chọn luôn" mà để trống "MST hoặc CCCD"
- **THEN** hệ thống báo lỗi ngay tại modal, KHÔNG gọi API ghi

#### Scenario: Để trống Tên viết tắt
- **WHEN** người dùng để trống "Tên viết tắt" rồi bấm "Thêm & chọn luôn"
- **THEN** hệ thống tự tính Tên viết tắt bằng thuật toán `ntpVietTat` trước khi ghi, không chặn lại yêu cầu bắt buộc gõ tay

### Requirement: Ghi về đúng collection Công nợ, không đụng ý nghĩa field cũ
Hệ thống SHALL ghi bản ghi mới vào collection `subcontractors` của project Firestore Công nợ qua Admin SDK, giữ nguyên ý nghĩa field `nguon` hiện có của Công nợ (ghi giá trị `"goc"`, không ghi tên người hay giá trị khác), và lưu thêm 1 field mới `ghiChuNguon` ghi nhận tên người đã thêm (lấy từ phiên đăng nhập, không tin giá trị từ client gửi lên).

#### Scenario: Ghi thành công
- **WHEN** người dùng điền đủ thông tin hợp lệ và bấm "Thêm & chọn luôn"
- **THEN** hệ thống tạo 1 document mới trong collection `subcontractors` của Công nợ với `nguon: "goc"` và `ghiChuNguon` chứa tên người đăng nhập thật đã thêm

#### Scenario: Bản ghi mới chọn được ngay, không cần đợi cache
- **WHEN** nhà thầu phụ mới vừa được ghi thành công
- **THEN** field đang gõ tự động chọn bản ghi vừa thêm, và các lần tải danh sách gợi ý tiếp theo (kể cả trong vòng 5 phút) đều thấy được bản ghi mới

#### Scenario: Field khác không được phép gọi API này
- **WHEN** có yêu cầu gọi API tạo nhà thầu phụ với `fieldId` của 1 field KHÔNG bật `externalCodeLookup.sourceId === "congno_subcontractors"`
- **THEN** hệ thống từ chối yêu cầu, không ghi gì vào Công nợ

#### Scenario: Ngoài phạm vi nhóm không gọi được
- **WHEN** người gọi API không nằm trong phạm vi "Sử dụng cho" (`usedFor`) của nhóm đề xuất chứa field đó
- **THEN** hệ thống từ chối yêu cầu, không ghi gì vào Công nợ
