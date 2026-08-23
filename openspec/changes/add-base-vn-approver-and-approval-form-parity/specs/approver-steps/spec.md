## ADDED Requirements

### Requirement: Nhãn hiển thị riêng cho bước duyệt
Mỗi phần tử `ApproverStepDef` (mọi kind) SHALL có thêm `name?: string` — nhãn hiển thị dễ hiểu (vd "QL BP", "KTTCH"), KHÁC với `code` (mã máy đọc, không đổi khi sửa tên). Bước duyệt thiếu `name` SHALL hiển thị theo số thứ tự như hành vi hiện tại ("Bước 1", "Bước 2"...).

#### Scenario: Đặt tên cho bước duyệt
- **WHEN** người quản lý nhóm đặt tên "KTTCH" cho 1 bước duyệt cố định
- **THEN** trang cài đặt nhóm hiển thị "KTTCH" thay cho "Bước {số thứ tự}", `code` của bước đó không đổi

#### Scenario: Bước duyệt cũ chưa có tên hiển thị như trước
- **WHEN** đọc 1 bước duyệt được tạo trước khi có tính năng này (`name` không tồn tại)
- **THEN** hệ thống hiển thị "Bước {số thứ tự}" như hành vi hiện tại, không lỗi, không tự sinh tên

### Requirement: Thời hạn xử lý riêng từng bước duyệt
Mỗi phần tử `ApproverStepDef` (mọi kind) SHALL có thêm `slaHours?: number` — thời hạn xử lý riêng của bước đó (đơn vị giờ), độc lập với `ProposalGroup.slaHours` (thời hạn chung của nhóm). Khi nhóm bật `approverSlaEnabled` VÀ BƯỚC ĐẦU TIÊN (theo thứ tự cấu hình) có `slaHours`, hệ thống SHALL dùng `slaHours` của bước đó thay cho `ProposalGroup.slaHours` khi tính thời hạn xử lý LÚC GỬI đề xuất; các trường hợp khác dùng `ProposalGroup.slaHours` như hành vi hiện tại. Nhãn hiển thị cho người dùng luôn là "Thời hạn xử lý"/"Hạn xử lý" — KHÔNG dùng chữ viết tắt "SLA" ở bất kỳ đâu hiển thị cho người dùng cuối (chỉ giữ `slaHours` làm tên field/biến trong code, không phải nhãn hiển thị).

**Phạm vi hiện tại — CHỈ tính 1 lần lúc gửi/gửi lại, KHÔNG tính lại theo từng bước khi đề xuất chuyển bước** (ví dụ luồng "Lần lượt" nhiều bước, mỗi bước có thời hạn riêng khác nhau) — việc "làm mới đồng hồ đếm ngược mỗi khi sang bước mới" cần Sếp xác nhận thêm trước khi triển khai (ảnh hưởng trực tiếp badge "Quá hạn" đang chạy thật), xem Open Questions trong design.md.

#### Scenario: Đề xuất dùng thời hạn riêng của bước đầu tiên khi nhóm bật thời hạn theo bước
- **WHEN** nhóm có `approverSlaEnabled: true`, bước đầu tiên "KTTCH" có `slaHours: 8`
- **THEN** thời hạn xử lý của đề xuất (tính lúc gửi) là 8 giờ kể từ lúc gửi, không dùng `ProposalGroup.slaHours` chung

#### Scenario: Nhóm chưa bật thời hạn theo bước giữ hành vi cũ
- **WHEN** nhóm có `approverSlaEnabled: false` hoặc chưa đặt
- **THEN** thời hạn xử lý của đề xuất tính theo `ProposalGroup.slaHours` chung như hành vi hiện tại, dù bước nào có `slaHours` riêng hay không
