## Why

Sếp xem bản demo tĩnh "Xem Trước Chuông Thông Báo" (mô phỏng ĐÚNG hành vi thật của `NotificationBell.tsx` + `lib/approval-logic.ts`, không phải đề xuất tính năng mới) và xác nhận muốn sửa cả 3 lỗ hổng demo chỉ ra ngay: (1) người duyệt đã xử lý xong phần mình bị im lặng hoàn toàn dù có bình luận mới hoặc bước sau từ chối, (2) người theo dõi chỉ được báo đúng 1 lần lúc đề xuất vừa gửi rồi im lặng mãi dù có biến động, (3) người được @tag không có khái niệm "đã đọc" nên thông báo không tự mất.

## What Changes

- Thêm `viewedAt?: Record<uid, ISO>` vào `RequestInstance` — ghi lại lần cuối 1 người MỞ trang chi tiết đề xuất, hoặc TỰ thao tác lên nó (duyệt/từ chối/chuyển tiếp/bình luận đều tính là "đã xem").
- API mới `POST /api/requests/[id]/view` — client gọi khi mở trang chi tiết (bắn rồi quên).
- Các route ghi hành động (`decision`, `comments`) ghi luôn `viewedAt[uid]` của người thao tác, tránh tự báo lại hành động của chính mình.
- **BREAKING nội bộ nhỏ**: route `POST /api/requests/[id]/comments` trước đây KHÔNG bump `updatedAt` — đã sửa để bump (lỗi có sẵn từ trước, phát hiện trong lúc làm change này, xem design.md).
- Scope API mới: `GET /api/requests?scope=approver-followup` (đã xử lý xong, có biến động mới) và `scope=following-unseen` (đang theo dõi, có biến động chưa xem — TÁCH RIÊNG khỏi `scope=following` hiện có vì scope đó còn phục vụ trang danh sách "Đang theo dõi", không được lọc bớt).
- `scope=mentioned` lọc thêm theo `viewedAt` (không cần scope riêng vì chỉ NotificationBell dùng).
- `NotificationCategory` thêm `"approver_followup"` — có mục cấu hình riêng ở `/request/settings/notifications`.

## Capabilities

### New Capabilities
- `notification-bell-freshness`: cơ chế `viewedAt` dùng chung để tính "còn thông báo mới hay không" cho 3 loại vốn không có khái niệm đã đọc.

### Modified Capabilities
(none — không có spec cũ được archive cho NotificationBell để viết delta; coi toàn bộ là capability mới)

## Impact

- **Data**: `lib/types.ts` (`viewedAt`, `NotificationCategory` thêm 1 giá trị).
- **API**: `app/api/requests/[id]/view/route.ts` (mới), `app/api/requests/[id]/decision/route.ts`, `app/api/requests/[id]/comments/route.ts`, `app/api/requests/route.ts` (scope mentioned/approver-followup/following-unseen), `lib/server/notificationSettings.ts`.
- **UI**: `components/request/NotificationBell.tsx`, `components/request/RequestDetailView.tsx` (gọi `/view` lúc mount), `app/request/settings/notifications/page.tsx`.
- **Logic thuần** (có test): `hasUnseenUpdate()` thêm vào `lib/approval-logic.ts`.
- **Không đổi**: `scope=following`/`scope=mentioned` KHÔNG đổi hành vi cho nơi khác đang dùng (trang danh sách `/request/list`) — chỉ thêm scope mới riêng cho chuông.
