## Why

Chuông thông báo hiện gộp chung 4 nguồn (cần duyệt / đề xuất của tôi đã có kết quả / được nhắc tên / đang theo dõi) vào 1 danh sách, không ai tắt bớt được loại mình không quan tâm. Ngoài ra, field `notifyManager` trên `ProposalGroup` (đã có UI "Báo quản lý trực tiếp" từ lâu) **chưa từng được đọc ở bất kỳ đâu trong logic thật** — khi nhân viên đề xuất chọn 1 người khác duyệt thay vì quản lý trực tiếp của mình (đã có thể làm qua `managerOverrides`), quản lý trực tiếp không hề được báo dù admin đã bật tuỳ chọn này. Sếp muốn: (1) mỗi người tự cài đặt được muốn nhận loại thông báo nào, và (2) quản lý trực tiếp thực sự được báo khi bị "qua mặt" trong việc chọn người duyệt.

## What Changes

- **Không đổi kiến trúc hiện có**: giữ nguyên cách chuông tính lại thông báo từ dữ liệu `requests` mỗi lần tải (4 scope `inbox/mine/mentioned/following` của `/api/requests`) — không tạo collection `notifications` riêng, để không đụng vào phần @mention vừa hoàn thành ở change `add-comment-mentions-realtime`.
- Thêm màn "Cài đặt thông báo" (trong `/request/settings` hoặc trang hồ sơ cá nhân) cho phép mỗi user tự bật/tắt riêng 5 loại: (1) cần tôi duyệt, (2) đề xuất của tôi có kết quả, (3) được nhắc tên (@mention), (4) đang theo dõi, (5) tôi là quản lý trực tiếp và bị chọn người khác duyệt thay. Mặc định cả 5 đều bật (không đổi hành vi hiện có).
- **Nối lại dây cho `notifyManager`**: khi 1 đề xuất thuộc nhóm có `notifyManager: true` VÀ approver cuối cùng khác với quản lý trực tiếp (`department.leaderId`) của người gửi (do dùng `managerOverrides` chọn người khác), thêm quản lý trực tiếp đó vào 1 nguồn thứ 5 của chuông (`scope=manager-bypassed` hoặc tương đương), có tôn trọng cài đặt (5) ở trên.
- `NotificationBell.tsx` gọi thêm 1 fetch cho nguồn thứ 5, và lọc bớt item theo cài đặt đã tắt (đọc `notificationSettings` của user hiện tại, gọi 1 lần cùng lúc).

## Capabilities

### New Capabilities
- `notification-preferences`: user tự bật/tắt 5 loại thông báo kể trên; chuông chỉ hiển thị loại đã bật.
- `manager-bypass-notification`: quản lý trực tiếp được báo khi bị "qua mặt" (nhóm bật `notifyManager` + submitter chọn người khác duyệt qua `managerOverrides`), tái dùng field `notifyManager` đã có sẵn nhưng chưa hoạt động.

### Modified Capabilities
(không có — repo này chưa có spec nào trước đó)

## Impact

- Mới: field `notificationSettings` trên document `users/{uid}` (hoặc collection riêng `notificationSettings/{uid}`) — object 5 khoá boolean.
- Mới: trang/khu vực Cài đặt thông báo (UI) + API đọc/ghi cài đặt (`/api/notification-settings` hoặc gộp vào route profile hiện có nếu có).
- Sửa: `GET /api/requests` (`app/api/requests/route.ts`) — thêm `scope=manager-bypassed`, so `departmentId → leaderId` của submitter với approver cuối cùng, chỉ áp dụng khi `group.notifyManager === true`.
- Sửa: `components/request/NotificationBell.tsx` — gọi thêm scope thứ 5, đọc `notificationSettings`, lọc item trước khi hiển thị.
- Không phá vỡ dữ liệu cũ: user chưa có `notificationSettings` coi như bật hết 5 loại, không mất thông báo nào đang có; nhóm cũ có `notifyManager: false` (nếu có) thì không phát sinh thông báo mới.
