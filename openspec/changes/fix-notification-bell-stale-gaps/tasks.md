## 1. Dữ liệu

- [x] 1.1 Thêm `viewedAt?: Record<string, string>` vào `RequestInstance` (`lib/types.ts`)
- [x] 1.2 Thêm `"approver_followup"` vào `NotificationCategory` (`lib/types.ts`), `ALL_CATEGORIES` (`lib/server/notificationSettings.ts`), nhãn + thứ tự trong `app/request/settings/notifications/page.tsx`

## 2. Logic thuần (có test)

- [x] 2.1 `hasUnseenUpdate(updatedAt, viewedAt, uid)` trong `lib/approval-logic.ts` + 3 test case (`lib/approval-logic.test.ts`)

## 3. API

- [x] 3.1 `POST /api/requests/[id]/view` (mới) — ghi `viewedAt[uid]`, gate bằng `canView()`
- [x] 3.2 `app/api/requests/[id]/decision/route.ts` — cả 3 nhánh (returned/forward/approved-rejected) bump `viewedAt[session.uid]` cùng lúc cập nhật
- [x] 3.3 `app/api/requests/[id]/comments/route.ts` — **phát hiện + vá lỗi có sẵn**: route này TRƯỚC ĐÂY không bump `updatedAt` khi có bình luận mới — đã thêm `updatedAt` + bump `viewedAt[session.uid]` của người bình luận
- [x] 3.4 `app/api/requests/route.ts`: `scope=mentioned` lọc thêm `hasUnseenUpdate`; thêm `scope=approver-followup` (mới); thêm `scope=following-unseen` (mới, TÁCH RIÊNG khỏi `scope=following` để không ảnh hưởng trang danh sách)

## 4. UI

- [x] 4.1 `components/request/NotificationBell.tsx` — đổi fetch `following` → `following-unseen`, thêm fetch `approver-followup`, cập nhật `buildNotifications()` (chữ hiển thị cho 2 loại: theo dõi có cập nhật / đã xử lý xong có cập nhật)
- [x] 4.2 `components/request/RequestDetailView.tsx` — `useEffect` gọi `POST .../view` lúc mount (bắn rồi quên)

## 5. Kiểm thử

- [x] 5.1 `npm run build` sạch
- [x] 5.2 `npx vitest run` — 201/201 pass (198 cũ + 3 test `hasUnseenUpdate` mới)
- [ ] 5.3 Kiểm thủ công trên local: duyệt xong 1 đề xuất → có người khác bình luận thêm → xác nhận thấy thông báo "approver_followup"; theo dõi 1 đề xuất cũ đã xem → có cập nhật mới → xác nhận thấy lại trong chuông; được @tag → mở đề xuất → xác nhận thông báo tự mất ở lần mở chuông kế tiếp — CẦN SẾP TỰ TEST, chưa thể tự làm (cần nhiều tài khoản + browser thật)
