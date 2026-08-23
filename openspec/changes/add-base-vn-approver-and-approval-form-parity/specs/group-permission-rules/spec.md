## ADDED Requirements

### Requirement: Cờ phân quyền thật ở cấp nhóm
`ProposalGroup` SHALL có `permissionRules: GroupPermissionRules` gồm 7 cờ chỉnh được (quyền sửa người theo dõi, người tạo có bớt được người theo dõi mặc định không, tự thêm người nhận việc con làm người theo dõi, chặn sửa bình luận sau khi đã có người xử lý, người theo dõi/người duyệt mặc định có xuất được dữ liệu, người duyệt có chuyển được quyền duyệt). Trang "Tuỳ chỉnh về phân quyền" SHALL hiển thị form đọc/ghi các cờ này, THAY cho nội dung tĩnh hiện có.

#### Scenario: Sửa cờ phân quyền có hiệu lực ngay
- **WHEN** người quản lý nhóm đổi "Chặn chỉnh sửa thảo luận và bình luận khi đề xuất đã được xử lý bởi ít nhất một người" từ Không sang Có và lưu
- **THEN** `permissionRules.lockCommentsAfterFirstDecision` được ghi `true`, tải lại trang hiển thị đúng giá trị đã lưu

#### Scenario: Nhóm cũ chưa có permissionRules dùng giá trị mặc định an toàn
- **WHEN** đọc 1 nhóm được tạo trước khi có tính năng này (`permissionRules` không tồn tại)
- **THEN** hệ thống áp dụng mặc định giữ đúng hành vi hiện tại (không khoá thêm quyền gì mới so với trước khi có tính năng)

### Requirement: Kiểm soát hiện nút xuất dữ liệu theo vai trò
Nút "Xuất Excel" ở trang Danh sách đề xuất SHALL chỉ hiển thị cho người CHỈ có vai trò follower/approver (không phải chủ đề xuất/Admin/Owner) trên các đề xuất thuộc 1 nhóm khi cờ tương ứng (`defaultFollowersCanExportData`/`defaultApproversCanExportData`) của nhóm đó bật.

#### Scenario: Follower không thấy nút xuất khi cờ tắt
- **WHEN** 1 người chỉ là follower (không phải chủ/Admin/Owner) của các đề xuất thuộc nhóm có `defaultFollowersCanExportData: false`
- **THEN** nút "Xuất Excel" không hiển thị cho họ ở phạm vi các đề xuất đó
