## 1. Data model

- [x] 1.1 Thêm type `NotificationCategory = "approver_pending" | "own_decided" | "mentioned" | "following" | "manager_bypassed"` và `NotificationSettings = Record<NotificationCategory, boolean>` vào `lib/types.ts`
- [x] 1.2 Không có type "user" riêng trong repo này (đọc thẳng users/{uid} không typed qua getHpcoreDb) — `notificationSettings` được đọc/ghi qua `lib/server/notificationSettings.ts` dùng chính `NotificationSettings` ở trên, không cần field trong 1 interface user nào

## 2. API cài đặt thông báo

- [x] 2.1 Thêm route đọc/ghi `notificationSettings` của user hiện tại (GET trả về, mặc định `true` cho khoá thiếu; PATCH ghi từng phần) — `app/api/notification-settings/route.ts`
- [x] 2.2 Áp dụng đúng rule "thiếu field/khoá = coi như bật" ở tầng đọc (không cần backfill) — `getNotificationSettings()` trong `lib/server/notificationSettings.ts`

## 3. Trang Cài đặt thông báo

- [x] 3.1 Tạo `app/request/settings/notifications/page.tsx` — 5 toggle tương ứng 5 category, gọi API ở mục 2
- [x] 3.2 Thêm link/icon "Cài đặt thông báo" cạnh `NotificationBell` trong `components/request/AppBar.tsx`

## 4. Quản lý trực tiếp bị qua mặt (manager-bypass)

- [x] 4.1 Trong `app/api/requests/route.ts`, thêm `scope=manager-bypassed`: với mỗi request có `groupId` trỏ nhóm `notifyManager === true` VÀ có bước `submitter_manager`, resolve `submittedBy.uid → departmentId → leaderId` (helper mới `resolveDirectManagerId`, `lib/server/requests.ts`), trả về các request mà `leaderId` tồn tại, khác `submittedBy.uid`, `leaderId === session.uid`, và không có mặt trong `approversSnapshot`
- [ ] 4.2 Viết test/kiểm chứng thủ công cho 4 scenario trong `specs/manager-bypass-notification/spec.md` (override thật, giữ nguyên quản lý, group tắt notifyManager, submitter không có leader) — **cần Sếp test với tài khoản/nhóm thật**

## 5. Nối vào chuông thông báo

- [x] 5.1 `NotificationBell.tsx`: thêm fetch `scope=manager-bypassed` (nguồn thứ 5), thêm nhánh hiển thị "Đề xuất '...' đã chọn người khác duyệt thay bạn"
- [x] 5.2 `NotificationBell.tsx`: fetch `notificationSettings` của user hiện tại (cùng lúc với 5 nguồn), lọc bỏ nguồn nào bị tắt trước khi gọi `buildNotifications` và trước khi tính `pendingCount`
- [ ] 5.3 Kiểm tra: user disable "cần mình duyệt" → badge số không tính pending approvals, nhưng trang `/request/requests?scope=inbox` vẫn hiện đầy đủ — **cần test trên trình duyệt thật**

## 6. Kiểm thử tổng hợp

- [ ] 6.1 User chưa từng cấu hình → thấy đủ cả 5 loại như hành vi cũ (default-on) — **cần test trên trình duyệt thật**
- [ ] 6.2 Tắt từng loại một, xác nhận bell không còn hiện loại đó, các loại khác không ảnh hưởng — **cần test trên trình duyệt thật**
- [x] 6.3 Xác nhận không có thay đổi hành vi ở @mention/real-time đã hoàn thành ở change `add-comment-mentions-realtime` — không sửa `RequestDetailView.tsx`, `firestore.rules`, hay logic `mentionedUids` (chỉ đọc `mentionedUids` có sẵn qua scope `mentioned` không đổi)
