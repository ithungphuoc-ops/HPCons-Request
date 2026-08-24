## ADDED Requirements

### Requirement: Đánh dấu 1 đề xuất là quan trọng, theo từng người xem
Trang chi tiết đề xuất SHALL hiển thị 1 icon sao (☆ chưa đánh dấu / ★ đã đánh dấu) cạnh badge trạng thái. Bấm vào icon SHALL toggle trạng thái đánh dấu CHO ĐÚNG người đang xem (không ảnh hưởng người khác). Bất kỳ ai xem được đề xuất (`canView()`) SHALL đánh dấu/bỏ đánh dấu được, không phân biệt trạng thái đề xuất (nháp/đang chờ/đã duyệt/đã từ chối).

#### Scenario: Đánh dấu 1 đề xuất chưa được đánh dấu
- **WHEN** người dùng xem được đề xuất bấm vào icon ☆ (chưa đánh dấu)
- **THEN** uid của người đó được thêm vào `bookmarkedByUids` của đề xuất; icon đổi thành ★ ngay cho người đó

#### Scenario: Bỏ đánh dấu 1 đề xuất đã đánh dấu
- **WHEN** người dùng xem được đề xuất bấm vào icon ★ (đã đánh dấu bởi chính họ)
- **THEN** uid của người đó bị loại khỏi `bookmarkedByUids`; icon đổi thành ☆ ngay cho người đó

#### Scenario: Đánh dấu không ảnh hưởng người khác
- **WHEN** người dùng A đánh dấu 1 đề xuất
- **THEN** người dùng B (khác A) mở cùng đề xuất đó vẫn thấy icon ☆ (chưa đánh dấu, theo góc nhìn của B)

#### Scenario: Đánh dấu đề xuất đã duyệt/từ chối xong
- **WHEN** người dùng xem 1 đề xuất đã ở trạng thái "approved" hoặc "rejected" và bấm đánh dấu
- **THEN** hệ thống cho phép đánh dấu thành công, không bị chặn bởi trạng thái đề xuất

### Requirement: Lối tắt đánh dấu trong menu "Thêm"
Menu "⋯ Thêm" trên trang chi tiết đề xuất SHALL có 1 dòng "Đánh dấu đề xuất" thực hiện ĐÚNG hành động toggle giống icon sao ở Requirement trên (không phải hành động khác).

#### Scenario: Bấm "Đánh dấu đề xuất" trong menu Thêm
- **WHEN** người dùng mở menu "⋯ Thêm" và bấm dòng "Đánh dấu đề xuất"
- **THEN** trạng thái đánh dấu của đề xuất (theo `bookmarkedByUids` của người đó) được toggle giống hệt bấm icon sao
