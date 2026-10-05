## ADDED Requirements

### Requirement: Nhóm đề xuất tự cấu hình bảng nhánh điều kiện cho Điều chỉnh sau duyệt
Hệ thống SHALL cho phép Owner/Admin cấu hình RIÊNG cho từng nhóm đề xuất 1 danh sách "nhánh" (`AdjustmentApprovalRules.branches`), mỗi nhánh gồm 1 hoặc nhiều phòng ban (khớp OR) và 1 danh sách người duyệt yêu cầu (AND). Nhóm KHÔNG cấu hình (field vắng mặt hoặc `null`) SHALL giữ nguyên hành vi mặc định: chỉ `submittedBy.uid` được bấm "Điều chỉnh đề nghị sau duyệt", lưu thẳng vào `history` ngay, không ai cần duyệt.

#### Scenario: Nhóm không cấu hình giữ nguyên hành vi mặc định
- **WHEN** 1 nhóm đề xuất không có `adjustmentApprovalRules`, submitter của 1 đề xuất đã duyệt thuộc nhóm đó gửi điều chỉnh
- **THEN** hệ thống ghi thẳng vào `history` ngay, không tạo `pendingAdjustment`

#### Scenario: Tắt cấu hình bằng cách đặt null
- **WHEN** Admin bấm "Tắt" cho 1 nhóm đã từng cấu hình `adjustmentApprovalRules`
- **THEN** hệ thống ghi `adjustmentApprovalRules: null` vào nhóm, và từ đó nhóm hoạt động như chưa từng cấu hình

### Requirement: Phạm vi — submitter luôn được, follower chỉ khi bật allowFollowers
Hệ thống SHALL luôn cho phép `submittedBy.uid` bấm "Điều chỉnh" (tuỳ theo nhánh khớp mà cần duyệt hay không). Hệ thống SHALL chỉ cho phép người trong `followers[]` bấm hành động này khi `AdjustmentApprovalRules.allowFollowers === true`.

#### Scenario: Follower bị từ chối khi allowFollowers tắt
- **WHEN** nhóm có cấu hình với `allowFollowers: false`, 1 follower (không phải submitter) gọi API điều chỉnh
- **THEN** hệ thống trả lỗi quyền (403), không ghi gì cả

#### Scenario: Follower được phép khi allowFollowers bật và khớp 1 nhánh
- **WHEN** nhóm có `allowFollowers: true`, 1 follower thuộc phòng ban khớp 1 nhánh có `requiredApprovers` không rỗng gọi API điều chỉnh
- **THEN** hệ thống tạo `pendingAdjustment` với đúng danh sách approver của nhánh đó

### Requirement: Khớp nhánh theo thứ tự, nhánh mặc định chỉ áp dụng cho follower
Hệ thống SHALL xét các nhánh trong `branches` theo ĐÚNG thứ tự trong mảng, dùng nhánh ĐẦU TIÊN có phòng ban khớp với phòng ban của người điều chỉnh. Khi KHÔNG có nhánh nào khớp: nếu người điều chỉnh là `submittedBy.uid`, hệ thống SHALL luôn xử lý như "trực tiếp" (lưu thẳng ngay), KHÔNG đọc `catchAllApprovers`; nếu là follower, hệ thống SHALL dùng `catchAllApprovers` làm danh sách người duyệt yêu cầu (rỗng = không được bấm).

#### Scenario: Submitter không khớp nhánh nào luôn lưu thẳng
- **WHEN** submitter thuộc phòng ban không khớp nhánh nào trong cấu hình của nhóm
- **THEN** hệ thống ghi thẳng vào `history` ngay, không tạo `pendingAdjustment`, bất kể `catchAllApprovers` có gì

#### Scenario: Follower không khớp nhánh nào, catchAllApprovers có người
- **WHEN** follower thuộc phòng ban không khớp nhánh nào, `catchAllApprovers` của nhóm có ≥1 người
- **THEN** hệ thống tạo `pendingAdjustment` với đúng danh sách người trong `catchAllApprovers`

#### Scenario: Follower không khớp nhánh nào, catchAllApprovers rỗng
- **WHEN** follower thuộc phòng ban không khớp nhánh nào, `catchAllApprovers` rỗng
- **THEN** hệ thống trả lỗi quyền (403), không tạo `pendingAdjustment`

### Requirement: Người duyệt yêu cầu là vai trò động, gộp khi trùng người thật
Hệ thống SHALL hỗ trợ ĐÚNG 2 loại người duyệt yêu cầu trong 1 nhánh: `{kind: "chi_huy_truong"}` (tra theo `RequestInstance.originalFirstApprover` của CHÍNH đề xuất) và `{kind: "department_leader", departmentId}` (tra theo `leaderId` HIỆN TẠI của phòng ban đó). Khi resolve 1 danh sách yêu cầu ra người thật mà 2 hoặc nhiều mục trỏ tới CÙNG 1 uid, hệ thống SHALL gộp thành 1 người duy nhất trong `pendingAdjustment.approvers`.

#### Scenario: Chỉ huy trưởng và Trưởng phòng trùng 1 người
- **WHEN** 1 nhánh yêu cầu cả `chi_huy_truong` và `department_leader` của phòng X, và `originalFirstApprover.id` của đề xuất trùng với `leaderId` hiện tại của phòng X
- **THEN** `pendingAdjustment.approvers` chỉ có 1 phần tử cho người đó, chỉ cần duyệt 1 lần

#### Scenario: Thiếu dữ liệu để resolve người duyệt — rơi về hành vi cũ
- **WHEN** 1 nhánh khớp yêu cầu `chi_huy_truong` nhưng đề xuất chưa có `originalFirstApprover`, HOẶC yêu cầu `department_leader` của 1 phòng chưa có `leaderId`
- **THEN** hệ thống xử lý như KHÔNG khớp nhánh nào (submitter → lưu thẳng; follower → theo `catchAllApprovers`), KHÔNG báo lỗi chặn người dùng

### Requirement: Duyệt đủ (AND) mới ghi lịch sử, từ chối 1 người huỷ hẳn, chuyển tiếp đổi đúng 1 slot
Hệ thống SHALL chỉ ghi nội dung điều chỉnh vào `history` và báo đồng bộ Kho/Thu mua khi TẤT CẢ phần tử trong `pendingAdjustment.approvers` đã có `approvedAt`. Hệ thống SHALL cho phép ĐÚNG 1 người trong số đang chờ (`approvedAt === null`) từ chối để HUỶ HẲN toàn bộ `pendingAdjustment`, không ghi gì vào `history`/`attachments`. Hệ thống SHALL cho phép người đang chờ xử lý CHUYỂN TIẾP đúng slot của mình cho người khác, không ảnh hưởng các slot còn lại.

#### Scenario: Duyệt xong hết thì mới có hiệu lực
- **WHEN** 1 `pendingAdjustment` có 2 người cần duyệt, người thứ nhất đã duyệt, người thứ hai vừa bấm Duyệt
- **THEN** hệ thống ghi 1 dòng `history` mới, thêm tệp (nếu có) vào `attachments`, xoá `pendingAdjustment`, và gọi đồng bộ báo Kho/Thu mua

#### Scenario: Duyệt một phần chưa đủ thì chưa có hiệu lực
- **WHEN** 1 `pendingAdjustment` có 2 người cần duyệt, mới chỉ 1 người bấm Duyệt
- **THEN** hệ thống cập nhật `approvedAt` của đúng người đó, KHÔNG ghi `history`, KHÔNG gọi đồng bộ, `pendingAdjustment` vẫn còn

#### Scenario: 1 người từ chối huỷ hẳn toàn bộ
- **WHEN** 1 trong số những người đang chờ (dù người kia đã duyệt hay chưa) bấm Từ chối
- **THEN** hệ thống xoá `pendingAdjustment`, KHÔNG ghi gì vào `history`/`attachments`

#### Scenario: Chuyển tiếp chỉ đổi đúng slot của mình
- **WHEN** 1 người đang chờ (trong `pendingAdjustment.approvers`, `approvedAt === null`) bấm Chuyển tiếp chọn người khác
- **THEN** hệ thống đổi `uid`/`name` của ĐÚNG slot đó, giữ nguyên `approvedAt: null` và không đổi các slot khác

#### Scenario: Người không có slot đang chờ bị từ chối thao tác
- **WHEN** 1 người KHÔNG có mặt trong `pendingAdjustment.approvers`, hoặc có mặt nhưng đã duyệt rồi, gọi API Duyệt/Từ chối/Chuyển tiếp
- **THEN** hệ thống trả lỗi quyền (403), không thay đổi `pendingAdjustment`

### Requirement: Ghi nhận "người duyệt bước 1 gốc" của đề xuất (Chỉ huy trưởng)
Hệ thống SHALL ghi `originalFirstApprover` bằng chính xác `approversSnapshot[0]` tại thời điểm `approversSnapshot` được dựng lần đầu tiên cho đề xuất (lúc gửi chính thức từ nháp, hoặc lúc tạo không phải nháp) — ghi đúng 1 lần, KHÔNG được tính lại hay ghi đè bởi bất kỳ thao tác "Chuyển tiếp và Duyệt" nào xảy ra sau đó trên luồng duyệt chính của đề xuất.

#### Scenario: Gửi chính thức lần đầu ghi nhận đúng người duyệt bước 1
- **WHEN** 1 đề xuất được gửi chính thức (không phải nháp) lần đầu, với `approversSnapshot` có ít nhất 1 người
- **THEN** hệ thống ghi `originalFirstApprover` = người đầu tiên trong `approversSnapshot` đó

#### Scenario: Chuyển tiếp và Duyệt sau đó KHÔNG làm đổi người duyệt bước 1 gốc
- **WHEN** đề xuất đã có `originalFirstApprover`, sau đó người duyệt dùng "Chuyển tiếp và Duyệt" chèn 1 người khác vào đầu `approvers[]`
- **THEN** `originalFirstApprover` trên đề xuất giữ nguyên giá trị đã ghi lúc gửi ban đầu
