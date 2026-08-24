## Why

Khung "Thảo luận" trên trang chi tiết đề xuất (`RequestDetailView`) hiện chỉ gửi text thuần, không @mention được ai, không cập nhật tức thời (phải tự load lại qua `onActed()`), không sửa/xóa/trả lời được. Cần nâng cấp thành khung bình luận đầy đủ: @mention người + nhóm/phòng ban, cập nhật real-time thật (không phải poll), đính kèm file, và quyền sửa/xóa có kiểm soát chặt hơn theo quyết định mới của Sếp (24/08/2026, sau khi xem demo): **bỏ hẳn trả lời lồng cấp** (giữ phẳng), **tác giả chỉ sửa/xóa được trong 10 phút kể từ lúc đăng**, sau đó **chỉ Owner** (không phải Admin) mới xóa được.

## What Changes

- Mở rộng `RequestComment`: thêm `mentionIds` (uid người + id nhóm/phòng ban), `editedAt`, và `attachment?: RequestAttachment | null` (đính kèm file). Giữ field `parentId` trong type cho tương thích dữ liệu cũ (bình luận trả lời đã tồn tại trước đổi này) nhưng **KHÔNG còn đường nào trong UI tạo `parentId` mới** — danh sách bình luận hiển thị phẳng hoàn toàn.
- Ô nhập bình luận dùng lại **`TagUserInput`** đã có (không thêm thư viện mới) — mở rộng nguồn gợi ý để bao gồm cả nhóm thành viên/phòng ban (đọc từ Firestore hpcore qua `getHpcoreDb()`, cùng cách `/api/directory` đang đọc `users`), không chỉ cá nhân.
- **Real-time thật** cho khung bình luận: client lắng nghe trực tiếp document `requests/{id}` qua Firestore Client SDK (`onSnapshot`) — **BREAKING (hạ tầng, không phải API công khai)**: đây là lần đầu base-request-app dùng Firestore Client SDK ở trình duyệt. App hiện chỉ auth qua cookie SSO (không có Firebase Auth phía client) nên cần dựng cầu nối: server cấp **custom token** (ký bằng Admin SDK của chính app này) sau khi xác minh cookie SSO, client dùng token đó đăng nhập Firebase Auth (ẩn, không đổi trải nghiệm đăng nhập hiện tại) rồi mới mở được listener.
- Thêm `firestore.rules` cho project Firebase riêng của base-request-app (**hiện chưa tồn tại file này**) — cho phép đọc `requests/{id}` khi đã đăng nhập (qua custom token ở trên), mọi ghi vẫn qua API route (Admin SDK), không đổi.
- **Bỏ hẳn "Trả lời"** — không còn nút "Trả lời" trên bình luận, không còn khái niệm trả lời lồng cấp. Đây là ĐỔI HƯỚNG so với bản trước của change này (đã từng thêm "trả lời 1 cấp" — nay bỏ theo yêu cầu mới).
- **Sửa/xóa bình luận — đổi hoàn toàn logic quyền** (KHÔNG còn giống bản trước): tác giả chỉ được sửa HOẶC xóa bình luận của chính mình **trong đúng 10 phút** kể từ lúc đăng (`comment.at`); sau 10 phút bị khóa, tác giả không còn thấy nút nào. Sau khi khóa, **chỉ vai trò Owner** (`session.role === "owner"`, KHÔNG bao gồm "admin") mới xóa được — và Owner chỉ có quyền xóa, không có quyền sửa nội dung bình luận của người khác.
- **Thêm đính kèm file trong bình luận**: nút 📎 trong ô soạn, tái dùng đúng `POST /api/uploads` (Cloudflare R2, đã dùng cho đính kèm field/level đề xuất) để tải file lên trước khi gửi bình luận — không dựng cơ chế lưu trữ mới. Bình luận có file hiển thị dòng nhỏ, bấm mở `FilePreviewModal` đã có (không tạo modal riêng). File đính kèm chịu đúng luật 10 phút như trên (xóa/sửa cả bình luận là 1 hành động, không tách riêng phần file).
- Mention → thông báo: tái dùng đúng mô hình `NotificationBell` hiện có (tự tính lại danh sách thông báo lúc tải, KHÔNG có collection `notifications` riêng) — thêm 1 nguồn thứ 3: các đề xuất có mặt uid hiện tại trong `mentionedUids` (trường mới, gộp toàn bộ người/nhóm từng được mention trong các bình luận của đề xuất đó).

## Capabilities

### New Capabilities
- `request-comment-mentions`: Toàn bộ hành vi bình luận trên 1 đề xuất — @mention người/nhóm, cập nhật real-time, sửa/xóa/trả lời, kiểm duyệt, và tích hợp vào chuông thông báo hiện có.

### Modified Capabilities
*(`openspec/specs/` hiện chưa có capability nào được spec hóa cho app này — toàn bộ đưa vào New Capabilities ở trên)*

## Impact

- `lib/types.ts` — mở rộng `RequestComment` (mentionIds, parentId giữ cho tương thích cũ, editedAt, `attachment?: RequestAttachment | null`); thêm `mentionedUids?: string[]` vào `RequestInstance`.
- `app/api/requests/[id]/comments/route.ts` — `POST` nhận thêm `mentionIds`, `attachment` (không nhận `parentId` mới nữa — bỏ trả lời); thêm `PATCH`/`DELETE` cho sửa/xóa 1 bình luận cụ thể, cả 2 đều tự kiểm tra lại mốc 10 phút + vai trò phía server, không tin client.
- `app/api/directory/route.ts` — giữ nguyên (chỉ người, dùng cho usedFor/approver/followers); thêm route mới `app/api/directory/mentionable/route.ts` (người + nhóm/phòng ban, chỉ dùng cho mention trong bình luận).
- `app/api/auth/firebase-token/route.ts` (mới) — mint custom token từ session SSO đã xác minh.
- `lib/firebase/client.ts` (mới) — khởi tạo Firebase Client SDK cho project riêng của base-request-app.
- `lib/firebase/admin.ts` — thêm export `getAdminAuth()` (mint custom token).
- `firestore.rules` (mới, project chưa từng có file này) — rule đọc `requests/{id}`.
- `components/shared/TagUserInput.tsx` — mở rộng để hỗ trợ hiển thị khác nhau giữa "người" và "nhóm/phòng ban" (không đổi hành vi các nơi đang dùng nó cho usedFor/approver/followers).
- `components/request/RequestDetailView.tsx` — khung Thảo luận: mention, real-time listener, sửa/xóa/trả lời.
- `components/request/NotificationBell.tsx` — thêm nguồn "được mention" (query `scope=mentioned` mới).
- `package.json` — thêm dependency `firebase` (client SDK) — chưa từng có trong app này.
- Cần thêm biến môi trường `NEXT_PUBLIC_FIREBASE_*` (config Firebase Client SDK cho project riêng của app) — xin từ Firebase Console.
