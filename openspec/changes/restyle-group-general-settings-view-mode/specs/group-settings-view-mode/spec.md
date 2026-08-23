## ADDED Requirements

### Requirement: Xem trước dạng thẻ trước khi sửa
Tab "Thiết lập chung" của 1 nhóm đề xuất SHALL mặc định hiển thị chế độ xem (không phải form sửa trực tiếp), gồm các thẻ: "Thông tin chung", "Người duyệt", "Luồng phê duyệt", "Người theo dõi". Mỗi thẻ SHALL có cách kích hoạt sửa riêng (nút "Chỉnh sửa" mở modal, hoặc bấm vào 1 mục để sửa tại chỗ) mà KHÔNG điều hướng sang URL khác.

#### Scenario: Vào tab lần đầu
- **WHEN** người quản trị mở tab "Thiết lập chung" của 1 nhóm
- **THEN** hệ thống hiển thị 4 thẻ ở chế độ chỉ xem, không có ô nhập liệu nào hiện sẵn

#### Scenario: Sửa Thông tin chung không rời trang
- **WHEN** người quản trị bấm "Chỉnh sửa" trên thẻ "Thông tin chung"
- **THEN** hệ thống mở 1 modal đè lên trang hiện tại (URL không đổi), chứa đúng các field: Tên nhóm đề xuất, Mô tả, Phân loại, Thời hạn xử lý, Sử dụng cho, "Mẫu form đề xuất?", Mô tả nhóm đề xuất (rich text), Trạng thái
- **AND** bấm "Huỷ bỏ" đóng modal mà không lưu thay đổi; bấm nút lưu thì gọi đúng cơ chế `updateGroup()` đang có và đóng modal

### Requirement: Thẻ Người duyệt dùng lại logic bước duyệt đang có
Thẻ "Người duyệt" SHALL hiển thị danh sách bước duyệt hiện có của nhóm dưới dạng rút gọn (tên bước hoặc badge "LINH ĐỘNG" khi chưa gán người, mã bước, hạn xử lý riêng nếu nhóm bật cờ tương ứng) và nút "+ Thêm" SHALL mở 1 menu với các lựa chọn tương ứng 3 loại bước hiện có (Cố định, Quản lý trực tiếp, Linh động) — KHÔNG tạo loại bước mới nào ngoài 3 loại đã hỗ trợ.

#### Scenario: Thêm bước duyệt qua menu mới
- **WHEN** người quản trị bấm "+ Thêm" trên thẻ "Người duyệt" rồi chọn 1 trong 3 loại
- **THEN** hệ thống thêm đúng 1 bước cùng loại vào danh sách, dùng đúng cơ chế validate/dedupe đang có trong `ApproverStepsEditor`

#### Scenario: Sửa 1 bước đã có
- **WHEN** người quản trị bấm vào 1 bước trong danh sách rút gọn
- **THEN** hệ thống hiện lại đúng phần sửa đầy đủ của bước đó (tên, người/quản lý trực tiếp, hạn xử lý, điều kiện) tại chỗ, không mất dữ liệu các bước khác

### Requirement: Không rớt tính năng cấu hình đã có
Các field cấu hình đã tồn tại trước khi đổi giao diện (Quy trình xử lý, 2 cờ SLA, 4 cờ bắt buộc ghi chú, Báo quản lý trực tiếp, Người theo dõi mặc định, Người theo dõi theo điều kiện) SHALL vẫn sửa được sau khi đổi sang chế độ xem-thẻ, dù không xuất hiện trong bản demo gốc.

#### Scenario: Sửa Quy trình xử lý sau khi đổi giao diện
- **WHEN** người quản trị mở modal sửa trên thẻ "Luồng phê duyệt"
- **THEN** hệ thống cho sửa đủ: Quy trình xử lý, Thời hạn xử lý riêng từng bước duyệt, Thời hạn xử lý theo lịch làm việc, Bắt buộc nhập ý kiến phê duyệt (4 hành động), Báo quản lý trực tiếp — đúng giá trị đang lưu, lưu qua đúng `updateGroup()` đang có
