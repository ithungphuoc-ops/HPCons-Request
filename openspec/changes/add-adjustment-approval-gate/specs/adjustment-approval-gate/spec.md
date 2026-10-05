## ADDED Requirements

### Requirement: Phạm vi được bấm "Điều chỉnh đề nghị sau duyệt"
Hệ thống SHALL cho phép `submittedBy.uid` của đề xuất LUÔN bấm "Điều chỉnh đề nghị sau duyệt" khi `request.status === "approved"`. Hệ thống SHALL cho phép thêm người trong `followers[]` bấm hành động này CHỈ KHI người đó thuộc phòng ban "Thi công" hoặc "Thu mua cung ứng" (tra qua `getScopeMembership`). Người không phải submitter và không thuộc 2 phòng ban trên SHALL bị từ chối (403), kể cả khi đang là follower của đề xuất.

#### Scenario: Submitter không thuộc 2 phòng ban đặc biệt vẫn bấm được (hành vi cũ)
- **WHEN** `submittedBy.uid` của đề xuất đã duyệt, không thuộc phòng Thi công lẫn Thu mua cung ứng, gọi API điều chỉnh
- **THEN** hệ thống cho phép, giữ nguyên hành vi hiện tại

#### Scenario: Follower thuộc phòng Thi công được bấm
- **WHEN** 1 người có mặt trong `followers[]` của đề xuất, thuộc phòng ban "Thi công", gọi API điều chỉnh
- **THEN** hệ thống cho phép (đi vào nhánh chờ duyệt, xem yêu cầu "Nhánh chờ duyệt theo phòng ban")

#### Scenario: Follower KHÔNG thuộc Thi công/Thu mua cung ứng bị từ chối
- **WHEN** 1 người có mặt trong `followers[]` nhưng không thuộc phòng Thi công lẫn Thu mua cung ứng, gọi API điều chỉnh
- **THEN** hệ thống trả lỗi quyền (403), không ghi gì cả

#### Scenario: Người ngoài submitter/followers bị từ chối
- **WHEN** 1 người không phải submitter và không có trong `followers[]` gọi API điều chỉnh
- **THEN** hệ thống trả lỗi quyền (403)

### Requirement: Nhánh chờ duyệt theo phòng ban người gửi điều chỉnh
Khi người gửi điều chỉnh (submitter hoặc follower) thuộc phòng "Thi công", hệ thống SHALL tạo trạng thái "đang chờ duyệt" với người duyệt là Trưởng phòng "Thu mua cung ứng" (`leaderId` của phòng ban đó). Khi người gửi thuộc phòng "Thu mua cung ứng", hệ thống SHALL tạo trạng thái chờ duyệt với người duyệt là `originalFirstApprover` của chính đề xuất đó ("Chỉ huy trưởng"). Hệ thống SHALL KHÔNG ghi nội dung điều chỉnh vào `history` và KHÔNG báo Kho/Thu mua ngay lúc này.

#### Scenario: Người thuộc Thi công gửi điều chỉnh
- **WHEN** người gửi thuộc phòng Thi công bấm gửi điều chỉnh với nội dung hợp lệ
- **THEN** hệ thống lưu `pendingAdjustment` với `approverUid` = leaderId phòng "Thu mua cung ứng", KHÔNG ghi `history`, KHÔNG gọi đồng bộ Kho/Thu mua

#### Scenario: Người thuộc Thu mua cung ứng gửi điều chỉnh
- **WHEN** người gửi thuộc phòng Thu mua cung ứng bấm gửi điều chỉnh với nội dung hợp lệ
- **THEN** hệ thống lưu `pendingAdjustment` với `approverUid` = `request.originalFirstApprover.id`, KHÔNG ghi `history`

#### Scenario: Đã có 1 điều chỉnh khác đang chờ duyệt
- **WHEN** đề xuất đã có `pendingAdjustment` khác null và có người (hợp lệ theo phạm vi) gửi thêm 1 điều chỉnh mới
- **THEN** hệ thống từ chối (409), không ghi đè điều chỉnh đang chờ

#### Scenario: Không xác định được phòng ban hoặc thiếu người duyệt tương ứng → rơi về hành vi cũ
- **WHEN** việc tra phòng ban lỗi, HOẶC phòng "Thu mua cung ứng" không có `leaderId`, HOẶC nhánh Thu mua cung ứng nhưng đề xuất không có `originalFirstApprover`
- **THEN** hệ thống xử lý như người gửi KHÔNG thuộc 2 phòng ban đặc biệt — chỉ cho phép nếu là submitter, ghi thẳng vào `history` ngay (không tạo `pendingAdjustment`), không chặn/báo lỗi tính năng

### Requirement: Người duyệt xử lý Duyệt / Từ chối / Chuyển tiếp
Hệ thống SHALL chỉ cho phép đúng `pendingAdjustment.approverUid` thực hiện 1 trong 3 hành động trên `pendingAdjustment` đang chờ. Duyệt SHALL ghi nội dung vào `history` (đúng định dạng/đếm thứ tự đang dùng cho điều chỉnh), thêm tệp đính kèm (nếu có) vào `attachments`, xoá `pendingAdjustment`, rồi mới gọi đồng bộ báo Kho/Thu mua. Từ chối SHALL xoá `pendingAdjustment` mà KHÔNG ghi gì vào `history`/`attachments`. Chuyển tiếp SHALL đổi `approverUid`/`approverName` của `pendingAdjustment` sang người được chỉ định, giữ nguyên nội dung/tệp đang chờ.

#### Scenario: Duyệt thành công
- **WHEN** đúng người đang được gán `pendingAdjustment.approverUid` gửi quyết định "approved"
- **THEN** hệ thống ghi 1 dòng `history` mới, thêm tệp (nếu có) vào `attachments`, xoá `pendingAdjustment`, và gọi đồng bộ báo Kho/Thu mua

#### Scenario: Từ chối — huỷ hẳn
- **WHEN** đúng người đang được gán gửi quyết định "rejected"
- **THEN** hệ thống xoá `pendingAdjustment`, KHÔNG thêm gì vào `history` hay `attachments`, không có cách khôi phục lại nội dung đã nhập

#### Scenario: Chuyển tiếp cho người khác xử lý
- **WHEN** đúng người đang được gán gửi quyết định "forward" kèm 1 người khác hợp lệ
- **THEN** hệ thống cập nhật `pendingAdjustment.approverUid`/`approverName` sang người mới, giữ nguyên `noiDung`/`attachment`/`routedVia`, không ghi `history`

#### Scenario: Người không phải approver hiện tại bị từ chối xử lý
- **WHEN** 1 người KHÔNG trùng `pendingAdjustment.approverUid` gọi API quyết định cho `pendingAdjustment` đang chờ
- **THEN** hệ thống trả lỗi quyền (403), không thay đổi `pendingAdjustment`

### Requirement: Ghi nhận "người duyệt bước 1 gốc" của đề xuất (Chỉ huy trưởng)
Hệ thống SHALL ghi `originalFirstApprover` bằng chính xác `approversSnapshot[0]` tại thời điểm `approversSnapshot` được dựng lần đầu tiên cho đề xuất (lúc gửi chính thức từ nháp, hoặc lúc tạo không phải nháp) — ghi đúng 1 lần, KHÔNG được tính lại hay ghi đè bởi bất kỳ thao tác "Chuyển tiếp và Duyệt" nào xảy ra sau đó trên luồng duyệt chính của đề xuất.

#### Scenario: Gửi chính thức lần đầu ghi nhận đúng người duyệt bước 1
- **WHEN** 1 đề xuất được gửi chính thức (không phải nháp) lần đầu, với `approversSnapshot` có ít nhất 1 người
- **THEN** hệ thống ghi `originalFirstApprover` = người đầu tiên trong `approversSnapshot` đó

#### Scenario: Chuyển tiếp và Duyệt sau đó KHÔNG làm đổi "người duyệt bước 1 gốc"
- **WHEN** đề xuất đã có `originalFirstApprover`, sau đó người duyệt dùng "Chuyển tiếp và Duyệt" chèn 1 người khác vào đầu `approvers[]`
- **THEN** `originalFirstApprover` trên đề xuất giữ nguyên giá trị đã ghi lúc gửi ban đầu, không đổi theo `approvers[0]` mới
