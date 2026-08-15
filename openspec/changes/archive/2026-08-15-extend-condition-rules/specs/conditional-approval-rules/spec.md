## MODIFIED Requirements

### Requirement: Điều kiện dựa trên giá trị field của đề xuất
Hệ thống SHALL cung cấp một cơ chế "điều kiện" dùng chung, cho phép đánh giá TRUE/FALSE dựa trên giá trị của MỘT HOẶC NHIỀU field trong đề xuất tại thời điểm gửi chính thức. Cơ chế này SHALL được dùng lại cho cả bước duyệt có điều kiện (`approver-steps`), người theo dõi theo điều kiện (`followers`), và field hiển thị theo điều kiện (`visibleWhen`) — không viết nhiều bộ logic đánh giá riêng.

Một điều kiện SHALL là một nhóm gồm: toán tử kết hợp (`all` = AND, `any` = OR), và danh sách một hoặc nhiều rule con. Mỗi rule con SHALL gồm: field tham chiếu (theo `code` ổn định của field, không theo `id` hay tên hiển thị), toán tử so sánh, và (các) giá trị so sánh.

Bộ toán tử SHALL gồm: "bằng" và "khác" cho field kiểu `single_choice`/`department_select`; "chứa" và "không chứa" cho field kiểu `multiple_choice`; "lớn hơn", "nhỏ hơn", và "trong khoảng" (2 giá trị, đóng 2 đầu) cho field kiểu `integer`/`decimal`/`currency`/`date`; "rỗng" và "không rỗng" cho MỌI kiểu field (không cần giá trị so sánh). Với "lớn hơn"/"nhỏ hơn"/"trong khoảng", hệ thống SHALL ép kiểu giá trị field và giá trị điều kiện về số (hoặc thời điểm, với field `date`) trước khi so sánh; nếu không ép kiểu được, điều kiện đó SHALL được coi là không thoả mãn.

Một nhóm điều kiện KHÔNG có rule con nào (danh sách rỗng) SHALL được coi là luôn thoả mãn.

#### Scenario: Điều kiện đơn thoả mãn khi field bằng giá trị chỉ định
- **WHEN** đề xuất được gửi chính thức và field có `code` được rule con tham chiếu có giá trị đúng bằng giá trị yêu cầu
- **THEN** rule con đó được đánh giá là thoả mãn (true)

#### Scenario: Điều kiện đơn không thoả mãn khi field khác giá trị chỉ định
- **WHEN** đề xuất được gửi chính thức và field có `code` được rule con tham chiếu có giá trị khác giá trị yêu cầu (hoặc field chưa có giá trị)
- **THEN** rule con đó được đánh giá là không thoả mãn (false)

#### Scenario: Nhóm điều kiện AND chỉ thoả mãn khi TẤT CẢ rule con thoả mãn
- **WHEN** nhóm điều kiện có `conjunction: "all"` và có ít nhất 1 rule con không thoả mãn
- **THEN** cả nhóm điều kiện được đánh giá là không thoả mãn (false)

#### Scenario: Nhóm điều kiện OR thoả mãn khi ÍT NHẤT MỘT rule con thoả mãn
- **WHEN** nhóm điều kiện có `conjunction: "any"` và có ít nhất 1 rule con thoả mãn
- **THEN** cả nhóm điều kiện được đánh giá là thoả mãn (true)

#### Scenario: So sánh ngưỡng số thoả mãn đúng theo toán tử
- **WHEN** field kiểu `integer`/`decimal`/`currency` có giá trị số và rule con dùng toán tử "lớn hơn"/"nhỏ hơn"/"trong khoảng" với ngưỡng tương ứng
- **THEN** rule con được đánh giá đúng theo phép so sánh số học (không so sánh chuỗi ký tự)

#### Scenario: So sánh số/ngày không thoả mãn khi không ép kiểu được
- **WHEN** rule con dùng toán tử "lớn hơn"/"nhỏ hơn"/"trong khoảng" nhưng giá trị field hiện tại không thể chuyển thành số hoặc thời điểm hợp lệ
- **THEN** rule con đó được đánh giá là không thoả mãn (false), hệ thống KHÔNG báo lỗi và KHÔNG chặn việc gửi đề xuất

#### Scenario: Field tham chiếu không còn tồn tại trong nhóm
- **WHEN** một rule con tham chiếu tới một `code` field không còn tồn tại trong `ProposalGroup.fields` tại thời điểm gửi
- **THEN** hệ thống coi rule con đó là không thoả mãn (false), KHÔNG chặn việc gửi đề xuất, và ghi log cảnh báo phía server nêu rõ `code` field không tìm thấy

#### Scenario: Nhóm điều kiện rỗng luôn thoả mãn
- **WHEN** một nhóm điều kiện được cấu hình (hoặc migrate) mà không có rule con nào
- **THEN** nhóm điều kiện đó được đánh giá là thoả mãn (true)

#### Scenario: Toán tử "rỗng"/"không rỗng" không cần giá trị so sánh
- **WHEN** rule con dùng toán tử "rỗng" và field tham chiếu chưa có giá trị (hoặc mảng rỗng với field nhiều lựa chọn)
- **THEN** rule con được đánh giá là thoả mãn (true), không cần và không dùng tới giá trị so sánh cấu hình sẵn

### Requirement: Quản trị viên cấu hình điều kiện qua UI
Người có quyền quản lý nhóm (`requireWriteAccess`) SHALL cấu hình được một hoặc nhiều rule con, kết hợp bằng AND hoặc OR, khi thêm/sửa: field hiển thị theo điều kiện, bước duyệt có điều kiện, hoặc người theo dõi theo điều kiện. Với mỗi rule con, quản trị viên SHALL chọn field từ danh sách field hiện có của nhóm (không nhập tay `code`), và danh sách toán tử hiển thị SHALL được lọc theo kiểu dữ liệu của field đã chọn (field rời rạc chỉ hiện "bằng"/"khác"/"chứa"/"không chứa"/"rỗng"/"không rỗng"; field số/ngày chỉ hiện "bằng"/"khác"/"lớn hơn"/"nhỏ hơn"/"trong khoảng"/"rỗng"/"không rỗng"). Với toán tử "rỗng"/"không rỗng", giao diện SHALL ẩn ô nhập giá trị vì không cần thiết.

#### Scenario: Chọn field không hợp lệ bị từ chối khi lưu
- **WHEN** người quản lý cố lưu một rule con (thuộc field `visibleWhen`, bước duyệt, hoặc người theo dõi) tham chiếu tới field không thuộc nhóm hiện tại
- **THEN** API PATCH nhóm trả về lỗi 400 với thông báo rõ field không tồn tại trong nhóm — áp dụng đồng nhất cho cả 3 nơi dùng điều kiện, không chỉ riêng bước duyệt

#### Scenario: Thêm rule con thứ hai hiện lựa chọn kết hợp
- **WHEN** người quản lý thêm rule con thứ hai vào một nhóm điều kiện đang chỉ có 1 rule con
- **THEN** giao diện hiện thêm lựa chọn kết hợp ("và"/"hoặc") để người quản lý chọn cách 2 rule con được kết hợp
