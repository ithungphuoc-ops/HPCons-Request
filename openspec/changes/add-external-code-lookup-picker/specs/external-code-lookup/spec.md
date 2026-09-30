## ADDED Requirements

### Requirement: Nguồn dữ liệu ngoài cố định trong registry
Hệ thống SHALL định nghĩa đúng 2 nguồn dữ liệu ngoài cho phép trong 1 registry cố định ở code (`congno_contracts` — Số Hợp Đồng CĐT; `congno_subcontractors` — Mã nhà thầu phụ), mỗi nguồn khai báo sẵn: nhãn hiển thị, danh sách field được coi là "mã" (1 hoặc nhiều), danh sách field hiện phụ. Hệ thống SHALL KHÔNG cho phép đọc hay liệt kê bất kỳ collection nào khác trong project Công nợ ngoài 2 nguồn này.

#### Scenario: Chỉ đúng 2 nguồn được liệt kê
- **WHEN** Admin mở màn Thêm/Sửa trường và bật ràng buộc mã tham chiếu ngoài
- **THEN** danh sách nguồn hiển thị đúng 2 lựa chọn (Số Hợp Đồng CĐT, Mã nhà thầu phụ) và không có lựa chọn nào khác

#### Scenario: Không đọc collection nhạy cảm
- **WHEN** hệ thống tải danh sách gợi ý hoặc kiểm tra khớp mã cho bất kỳ field nào
- **THEN** hệ thống chỉ gọi tới collection `contracts` hoặc `subcontractors`, không bao giờ đọc `subContracts`, `installments`, `approvals`, `users`, `allowedEmails`, `feedback`, hay `customers`

### Requirement: Field bắt buộc khớp mã tham chiếu ngoài
Field kiểu `short_text` SHALL cho phép gắn cấu hình `externalCodeLookup: { sourceId }` trỏ tới đúng 1 trong 2 nguồn đã đăng ký. Khi gửi đề xuất CHÍNH THỨC (không áp dụng khi lưu nháp), nếu field có cấu hình này và có giá trị, hệ thống SHALL chặn gửi nếu giá trị không khớp đúng bất kỳ field "mã" nào của bất kỳ bản ghi nào thuộc nguồn đó — đọc lại dữ liệu từ máy chủ tại thời điểm gửi, không tin danh sách phía trình duyệt.

#### Scenario: Gửi với mã hợp lệ
- **WHEN** người dùng gửi chính thức đề xuất có field ràng buộc nguồn `congno_contracts`, giá trị field khớp đúng 1 `code` thật đang có trong Công nợ
- **THEN** đề xuất được gửi thành công, không có lỗi liên quan field này

#### Scenario: Gửi với mã không tồn tại
- **WHEN** người dùng gửi chính thức đề xuất có field ràng buộc, giá trị field KHÔNG khớp bất kỳ mã thật nào của nguồn đó
- **THEN** hệ thống trả lỗi rõ ràng nêu tên field, chặn không tạo/không chuyển trạng thái đề xuất

#### Scenario: Lưu nháp không bị chặn
- **WHEN** người dùng chỉ lưu nháp (chưa gửi chính thức) với giá trị field không khớp mã thật
- **THEN** hệ thống KHÔNG chặn lưu nháp

#### Scenario: Field rỗng hoặc bị ẩn không bị chặn
- **WHEN** field ràng buộc mã tham chiếu đang trống, hoặc đang bị ẩn bởi điều kiện hiển thị (`visibleWhen` không thoả)
- **THEN** hệ thống không tính là lỗi cho field này khi gửi chính thức

### Requirement: Khớp một trong nhiều field mã (OR)
Với nguồn có khai báo nhiều field "mã" (vd `subcontractors`: `ma` và `mst`), hệ thống SHALL coi giá trị field là hợp lệ nếu khớp CHÍNH XÁC bất kỳ MỘT trong các field mã đó của bất kỳ bản ghi nào — không bắt buộc khớp cả hai.

#### Scenario: Khớp theo field mã thứ nhất
- **WHEN** giá trị field bằng đúng `ma` của 1 nhà thầu phụ thật, nhưng khác `mst` của nhà thầu đó
- **THEN** hệ thống coi là khớp hợp lệ

#### Scenario: Khớp theo field mã thứ hai
- **WHEN** giá trị field bằng đúng `mst` của 1 nhà thầu phụ thật (nhà thầu này không có `ma`)
- **THEN** hệ thống coi là khớp hợp lệ

### Requirement: Gợi ý tự động khi nhập
Ô nhập của field có ràng buộc mã tham chiếu SHALL hiện gợi ý dạng danh sách thả xuống, lọc theo phần đã gõ, kèm cột phụ theo đúng field hiện phụ đã khai báo cho nguồn đó. Đây là hỗ trợ trải nghiệm — không thay thế việc kiểm tra lại ở máy chủ lúc gửi chính thức.

#### Scenario: Gợi ý hiện đúng cột phụ theo nguồn
- **WHEN** Admin ràng buộc field theo nguồn "Mã nhà thầu phụ"
- **THEN** gợi ý dropdown hiện tên, MST, địa chỉ nhà thầu phụ — không hiện field nào khác của bản ghi

### Requirement: Không lộ dữ liệu tài chính
Cột phụ hiển thị trong gợi ý và trong dữ liệu trả về từ máy chủ cho client SHALL chỉ gồm đúng field đã khai báo hiện phụ cho nguồn đó — hệ thống SHALL KHÔNG bao giờ forward nguyên document thô hoặc bất kỳ field tài chính nào (vd `totalAfterTax` của `contracts`) ra khỏi máy chủ.

#### Scenario: Field tài chính không xuất hiện trong phản hồi API
- **WHEN** client gọi API lấy gợi ý cho field ràng buộc nguồn `congno_contracts`
- **THEN** phản hồi JSON không chứa field `totalAfterTax` hay bất kỳ field nào ngoài danh sách hiện phụ đã khai báo

### Requirement: Tương thích ngược với cờ cũ
Field đã lưu `contractCodeLookup: true` trước khi có cấu hình mới SHALL tiếp tục hoạt động đúng như trước (validate/gợi ý theo nguồn `congno_contracts`) mà không cần Admin sửa lại field đó.

#### Scenario: Field cũ chưa migrate vẫn hoạt động
- **WHEN** 1 field trên production có `contractCodeLookup: true` và chưa từng được sửa lại sau khi triển khai thay đổi này
- **THEN** field đó vẫn chặn gửi chính thức nếu giá trị không khớp Số Hợp Đồng CĐT thật, giống hệt hành vi trước khi thay đổi
