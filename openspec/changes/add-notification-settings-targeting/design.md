## Context

Chuông thông báo (`components/request/NotificationBell.tsx`) hiện tính lại danh sách thông báo mỗi lần tải trang, gọi 4 fetch song song `/api/requests?scope=inbox|mine|mentioned|following`, gộp thành tối đa 8 item hiển thị (`buildNotifications`). Đây là quyết định kiến trúc đã chốt ở change `add-comment-mentions-realtime` (không tạo collection `notifications` riêng) — change này giữ nguyên quyết định đó, chỉ thêm lớp lọc theo cài đặt lên trên.

`ProposalGroup` có field `notifyManager: boolean` (mặc định `true` khi tạo nhóm mới, `lib/types.ts:138`) với nhãn UI "Báo quản lý trực tiếp" (`lib/server/groups.ts:28`), nhưng field này chưa từng được đọc trong `lib/server/requests.ts` hay bất kỳ logic duyệt/thông báo nào — admin bật tuỳ chọn nhưng không có gì xảy ra. Quan hệ "quản lý trực tiếp" chỉ tồn tại gián tiếp: `users/{uid}.departmentId` → `departments/{id}.leaderId`, và chỉ được resolve ở luồng đề xuất theo nhóm (bước `submitter_manager` trong `resolveApproverStepsDetailed()`, `lib/server/requests.ts:~207-269`), có thể bị ghi đè qua `managerOverrides` (submitter tự chọn 1 người khác thay vì quản lý trực tiếp, giới hạn trong những người đang là `leaderId` của ≥1 phòng ban — xác thực server-side ở `resolveManagerOverride`).

Luồng đề xuất trực tiếp (`groupId: null`) không có khái niệm quản lý trực tiếp nào cả (chọn approver hoàn toàn tự do) — ngoài phạm vi thay đổi này.

## Goals / Non-Goals

**Goals:**
- Mỗi user tự bật/tắt được 5 loại thông báo, mặc định bật hết (không đổi hành vi hiện có nếu chưa cấu hình).
- Quản lý trực tiếp thực sự nhận được thông báo khi nhóm bật `notifyManager` và submitter dùng `managerOverrides` để chọn người khác duyệt thay mình.
- Không phá vỡ/không cần sửa lại phần @mention + real-time vừa hoàn thành ở `add-comment-mentions-realtime`.

**Non-Goals:**
- Không tạo collection `notifications` riêng (xem quyết định đã chốt ở Context).
- Không thêm khái niệm "quản lý trực tiếp" cho luồng đề xuất trực tiếp (`groupId: null`) — luồng này vẫn cho chọn approver tự do như hiện tại.
- Không thêm kênh thông báo mới (email/telegram) — chỉ trong phạm vi chuông trong app.

## Decisions

**1. Lưu cài đặt ở đâu?** Thêm field `notificationSettings?: Record<NotificationCategory, boolean>` ngay trên document `users/{uid}` hiện có (không tạo collection riêng) — 1 read duy nhất, không cần join thêm, tương tự cách `users.settings.delegation` đã làm ở HPcons-booking. `NotificationCategory` = `"approver_pending" | "own_decided" | "mentioned" | "following" | "manager_bypassed"`.

**2. Giá trị mặc định khi chưa cấu hình?** Thiếu field hoặc thiếu khoá cụ thể = coi như `true` (bật) — đọc ở tầng API (`?? true`), không cần migrate dữ liệu cũ, không ai bị "mất" thông báo đang nhận khi feature này lên production.

**3. Cách phát hiện "quản lý bị qua mặt"?** So sánh tại thời điểm GET (không lưu sẵn lúc tạo, để không phải sửa `POST /api/requests` — giảm rủi ro đụng luồng tạo đề xuất đang chạy): với mỗi request có `groupId` trỏ tới nhóm có `notifyManager === true`, resolve lại `submittedBy.uid → departmentId → leaderId` (tái dùng chính helper đang dùng ở `resolveApproverStepsDetailed`), nếu `leaderId` tồn tại, khác `submittedBy.uid`, và KHÔNG có mặt trong `approversSnapshot` cuối cùng của request → tạo 1 thông báo "manager_bypassed" nhắm vào `leaderId`.

**4. Vị trí thêm scope mới:** `GET /api/requests` thêm `scope=manager-bypassed`, cạnh 4 scope hiện có trong `app/api/requests/route.ts` — nhất quán với cách 4 scope kia đang được implement (tính ở code, không lưu sẵn).

**5. Lọc theo cài đặt ở đâu?** Ngay trong `NotificationBell.tsx`, sau khi có đủ 5 nguồn: thêm 1 fetch lấy `notificationSettings` của user hiện tại (route mới hoặc field trả về sẵn trong 1 trong các API đã gọi), rồi loại bỏ nguồn nào bị tắt trước khi đưa vào `buildNotifications`. Không lọc ở tầng API `/api/requests` (để trang danh sách đề xuất — khác chuông — không bị ảnh hưởng bởi cài đặt thông báo).

**Alternatives considered:** Tạo collection `notifications` ghi log thật (bị loại — xung đột với quyết định đã chốt + phần đã code xong ở `add-comment-mentions-realtime`, sẽ phải viết lại; cân nhắc lại nếu sau này scale lớn hoặc cần "đã đọc" persistent thật).

## Risks / Trade-offs

- [Tính lại "manager bypassed" mỗi lần tải chuông (không cache)] → Chấp nhận được: cùng độ phức tạp như 4 nguồn hiện có, dữ liệu công ty (~124 user, không phải hàng chục nghìn request/ngày).
- [Field `notificationSettings` không tồn tại ở user cũ] → Mặc định `true` ở tầng đọc, không cần script backfill (khác với username, việc này không cần hiển thị công khai nên không có nhu cầu backfill ngay).
- [Chỉ áp dụng cho luồng nhóm, không áp dụng luồng đề xuất trực tiếp] → Đúng như phạm vi Sếp mô tả (ví dụ Sếp đưa ra là "quản lý trực tiếp" — khái niệm chỉ tồn tại ở luồng nhóm); nếu sau này cần cho luồng trực tiếp, cần thêm field quản lý trực tiếp trên user trước.

## Migration Plan

- Không cần migrate dữ liệu. Deploy code mới, mặc định mọi user vẫn nhận đủ thông báo như cũ; ai vào Cài đặt tự tắt bớt thì mới đổi hành vi.
- Rollback: revert code, `notificationSettings` field (nếu đã có ai ghi) không gây lỗi ở bản cũ (bị bỏ qua vì bản cũ không đọc field này).

## Open Questions

- Nếu sau này cần thêm luồng trực tiếp cũng có "quản lý trực tiếp", sẽ cần thêm field trên user — ngoài phạm vi change này.

**Đã xác nhận lúc viết design:** repo này chưa có trang hồ sơ cá nhân/settings cá nhân nào (`app/` chỉ có settings CẤP NHÓM tại `app/request/groups/[groupId]/(settings)/`). Vì vậy tạo route mới `app/request/settings/notifications/page.tsx`, thêm link/icon cài đặt ngay cạnh `NotificationBell` trong `components/request/AppBar.tsx`.
