## Context

base-request-app hiện KHÔNG có Firebase Client SDK nào (`package.json` chỉ có `firebase-admin`) — đăng nhập hoàn toàn qua cookie SSO `session` (domain `.hpcore.vn`), xác minh phía server bằng `verifyHpcore()` (dùng Admin SDK riêng tên `"hpcore"` trỏ về project Firestore của hpcons-portal). Dữ liệu nghiệp vụ của app này (groups, categories, **requests**) nằm ở 1 project Firebase KHÁC (Admin SDK mặc định, `lib/firebase/admin.ts`).

Sếp đã tự đối mặt đúng bài toán này ở 1 project song song (`pkd_crm-next`, đổi `notify-step-transitions`, 14/07/2026) và chọn **poll 15s, không dùng Firestore Client SDK** — lý do: không có Firebase Auth phía client, chi phí dựng lại xác thực không tương xứng lợi ích cho nghiệp vụ đó. Với đổi này, Sếp xác nhận rõ muốn **real-time thật** cho bình luận (không phải poll) — nên design này ĐI NGƯỢC lại quyết định mặc định đó một cách có chủ đích, chấp nhận chi phí dựng cầu nối xác thực.

Khung "Thảo luận" hiện tại (`RequestDetailView.tsx` + `app/api/requests/[id]/comments/route.ts`) đã hoạt động: text thuần, lưu trong mảng `RequestInstance.comments`, gọi `onActed()` (load lại toàn bộ) sau khi gửi. `TagUserInput` + `/api/directory` đã có sẵn cơ chế "gõ tìm người" (đọc `users` từ Firestore hpcore qua `getHpcoreDb()`), dùng cho `usedFor`/`approverSteps`/`followers`.

## Goals / Non-Goals

**Goals:**
- Bình luận trên 1 đề xuất cập nhật tức thời cho mọi người đang mở trang chi tiết đề xuất đó, qua Firestore Client SDK `onSnapshot` thật (không phải poll).
- @mention người (tái dùng `TagUserInput`/`/api/directory` sẵn có) và nhóm thành viên/phòng ban (nguồn mới, đọc từ Firestore hpcore).
- Tác giả sửa/xóa bình luận của mình, nhưng CHỈ trong 10 phút kể từ lúc đăng; sau đó chỉ Owner (không phải Admin) xóa được.
- Đính kèm 1 file cho mỗi bình luận, tái dùng `/api/uploads` (R2) + `FilePreviewModal` đã có.
- Mention hiển thị trong `NotificationBell` hiện có, không cần collection `notifications` mới.

**Non-Goals:**
- Không làm `NotificationBell` real-time (bell hiện tại tính lại 1 lần lúc tải trang, không poll, không listener) — giữ nguyên hành vi đó, chỉ thêm 1 nguồn dữ liệu mới (mention) vào cùng cách tính hiện tại. Nếu sau này cần bell cũng "sống", đó là 1 change riêng.
- Không thêm rich-text/thư viện mention mới — `TagUserInput` đã đủ, chỉ mở rộng nguồn dữ liệu.
- Không đổi cấu trúc lưu trữ bình luận (vẫn là mảng nhúng trong `requests/{id}.comments`, không tách subcollection riêng) — tránh migration không cần thiết, và document-level `onSnapshot` đã đủ để nghe toàn bộ mảng thay đổi.
- Không cho nhóm/phòng ban làm `usedFor`/`approverSteps`/`followers` — 3 chỗ đó giữ nguyên chỉ nhận cá nhân, không mở rộng phạm vi ngoài yêu cầu.
- **Không làm "trả lời" (reply/thread lồng cấp)** — quyết định ban đầu của change này (mục 6 cũ) đã bị đảo ngược theo yêu cầu mới của Sếp (24/08/2026): danh sách bình luận giữ phẳng hoàn toàn. Field `parentId` vẫn còn trong type cho dữ liệu cũ, nhưng UI không còn đường tạo mới.
- Không sửa hộ nội dung bình luận của người khác — Owner sau khi bình luận bị khóa (quá 10 phút) CHỈ có quyền xóa, không có quyền sửa.

## Decisions

1. **Real-time bằng cầu nối custom token, không đổi luồng đăng nhập chính.** Thêm `POST /api/auth/firebase-token`: xác minh cookie SSO như mọi route khác (`requireSession()`), rồi dùng Admin SDK **của chính base-request-app** (không phải `hpcore`) để `getAuth().createCustomToken(session.uid)`. Client gọi endpoint này 1 lần lúc vào trang chi tiết đề xuất, `signInWithCustomToken()` (ẩn, người dùng không thấy màn hình đăng nhập nào khác) rồi mới mở `onSnapshot`. Lý do dùng Admin SDK riêng của app (không phải `hpcore`): dữ liệu cần nghe (`requests`) nằm ở project riêng của app này, `request.auth` trong Firestore Rules chỉ có tác dụng trong ĐÚNG project đang được nghe.

2. **Nghe toàn bộ document `requests/{id}`, không tách `comments` thành subcollection riêng.** Khi mảng `comments` thay đổi, cả document thay đổi, listener nhận lại toàn bộ `RequestInstance` mới — component chỉ cần lấy `snapshot.data().comments`. **Thay thế đã xét**: subcollection `requests/{id}/comments/{commentId}` (mỗi bình luận 1 doc) — cho phép rule/query tinh vi hơn nhưng đòi hỏi viết lại toàn bộ luồng đọc/ghi bình luận hiện có (đang là mảng nhúng) — không tương xứng lợi ích ở quy mô 1 đề xuất thường vài chục bình luận.

3. **`firestore.rules` cho project riêng của app — chỉ yêu cầu đã đăng nhập (`allow read: if isSignedIn()`), không tái tạo đầy đủ logic `canView()` trong rules.** Lý do: `canView()` kiểm tra `submittedBy`/`approversSnapshot`/`followers` (mảng object, không phải mảng id đơn giản) — biểu diễn chính xác trong Firestore Rules tốn công không tương xứng. Vì client đã đi qua `GET` (có `canView()` đầy đủ phía server) để tải dữ liệu ban đầu trước khi mở listener, rủi ro còn lại chỉ là 1 nhân viên biết trước ID đề xuất không liên quan tự mở listener trực tiếp — chấp nhận được cho 1 công cụ nội bộ, ghi rõ ở Risks.

4. **Mention lưu id có cấu trúc** (`mentionIds: string[]`) — không phân tách 2 mảng người/nhóm, giống hpcons-portal đã quyết (đỡ phải tự phân loại phía client, `TagUserInput` trả về danh sách chọn thống nhất).

5. **Nguồn "nhóm/phòng ban" cho mention**: thêm hàm đọc `getHpcoreDb().collection("memberGroups")` và `.collection("departments")`, tương tự cách `/api/directory` đang đọc `users`. Tạo endpoint MỚI `app/api/directory/mentionable` (không sửa `/api/directory` hiện có) để không ảnh hưởng 3 nơi đang dùng nó (`usedFor`, `approverSteps`, `followers` — vẫn chỉ nhận cá nhân).

6. **~~Trả lời 1 cấp~~ — ĐÃ HUỶ, thay bằng "phẳng hoàn toàn".** Quyết định gốc (`parentId` luôn quy về bình luận gốc) đã bị đảo ngược 24/08/2026: bỏ hẳn nút "Trả lời" khỏi UI, `POST /comments` không nhận `parentId` mới nữa. Giữ field `parentId?: string | null` trong `RequestComment` (không xóa khỏi type) để không phá dữ liệu cũ nếu đã có bình luận trả lời thật trên production — nhưng logic hiển thị/tạo mới coi mọi bình luận là ngang hàng (không lồng), sắp xếp thẳng theo `at`.

7. **Quyền sửa/xóa — có hạn 10 phút, Owner-only sau khi khóa.** Thay hoàn toàn quyết định cũ ("tác giả sửa/xóa bất kỳ lúc nào; Admin/Owner xóa bất kỳ bình luận nào bất kỳ lúc nào"):
   - **Trong 10 phút kể từ `comment.at`**: CHỈ tác giả (`authorUid === session.uid`) được sửa HOẶC xóa bình luận của chính mình. Không ai khác (kể cả Owner) có quyền gì trên bình luận này trong khung giờ này.
   - **Sau 10 phút (đã khóa)**: tác giả KHÔNG còn quyền gì nữa (hết Sửa, hết Xóa). CHỈ `session.role === "owner"` (KHÔNG dùng `canManageGroupsAtAppScope` vì hàm đó gộp cả "admin" — cần helper/điều kiện MỚI chỉ nhận đúng "owner") mới xóa được — và chỉ xóa, không có API/nút sửa cho Owner trên bình luận của người khác.
   - Mốc 10 phút PHẢI kiểm tra lại ở server (`PATCH`/`DELETE` tự tính `Date.now() - new Date(target.at).getTime() > 10 * 60 * 1000`), không tin cờ ẩn/hiện nút phía client — client chỉ dùng để ẩn/hiện nút cho gọn UI.
   - Lý do đổi: Sếp muốn giới hạn "sửa nhanh lỗi chính tả" trong 1 khung giờ ngắn, tránh bình luận (vốn là hồ sơ trao đổi/quyết định) bị chỉnh sửa tùy ý lâu dài sau đó; quyền dọn dẹp lâu dài chỉ giao cho Owner (thu hẹp hơn "Admin/Owner" cũ) để tránh admin thường (không phải chủ sở hữu app/tổ chức) xóa nhầm bằng chứng trao đổi.

8. **Đính kèm file trong bình luận — tái dùng `/api/uploads` (R2) + `FilePreviewModal`, không dựng cơ chế mới.** Client chọn 1 file → gọi `POST /api/uploads` (đã có, giới hạn 10MB/file, lưu Cloudflare R2 qua `lib/r2.ts`) → nhận lại `{name, path, size}` (đúng shape `RequestAttachment`) → gửi kèm trong `POST /api/requests/[id]/comments` dưới field `attachment`. Hiển thị: dòng nhỏ icon + tên + dung lượng dưới nội dung bình luận, bấm mở `FilePreviewModal` (component đã dùng cho field "Tệp tin" và tài liệu đính kèm cấp đề xuất) — không tạo modal riêng. Giới hạn: **1 file/bình luận** (không phải nhiều file như `/api/uploads` cho phép tối đa 6 — bình luận chỉ cần 1, đơn giản hóa UI ô soạn). File đính kèm không có API xóa/thay riêng — xóa/sửa cả bình luận là 1 hành động duy nhất, chịu đúng luật 10 phút ở mục 7.

8. **Thông báo mention tái dùng mô hình "tính lại lúc tải" của `NotificationBell`** — thêm field `mentionedUids?: string[]` trên `RequestInstance` (hợp nhất mọi uid từng được mention qua các bình luận + trả lời của đề xuất đó, cập nhật mỗi lần có bình luận mới), và 1 scope mới `?scope=mentioned` cho `GET /api/requests` (trả về các đề xuất có `mentionedUids` chứa uid hiện tại). `NotificationBell` gọi thêm scope này, hợp nhất với 2 nguồn cũ (inbox/mine). Không có khái niệm "đã đọc" riêng cho mục này — giống hệt cách 2 nguồn cũ đang hoạt động (không lưu trạng thái đọc).

## Risks / Trade-offs

- **[Risk]** `allow read: if isSignedIn()` trên `requests/{id}` không lọc theo `canView()` đầy đủ — 1 nhân viên biết ID đề xuất không liên quan có thể tự mở listener đọc được nội dung (không phải chỉ bình luận, mà toàn bộ document) → **Mitigation**: chấp nhận cho đợt này (nội bộ, ID không đoán được ngẫu nhiên, không liệt kê danh sách được vì luôn cần biết đúng ID trước); ghi rõ để xem lại nếu dữ liệu đề xuất trở nên nhạy cảm hơn.
- **[Risk]** Đây là lần đầu app dùng Firebase Client SDK + custom token — thêm 1 lớp lỗi mới có thể gặp (token hết hạn giữa phiên, cần refresh; listener không unsubscribe đúng lúc rời trang) → **Mitigation**: `onAuthStateChanged`/refresh token theo cơ chế mặc định của Firebase SDK (tự refresh ID token nền, không cần code thêm); unsubscribe `onSnapshot` khi component unmount.
- **[Risk]** Cần thêm biến môi trường `NEXT_PUBLIC_FIREBASE_*` cho project riêng của app — hiện chưa có, phải xin từ Firebase Console trước khi chạy được tính năng này ở local/production.
- **[Trade-off]** Không làm `NotificationBell` real-time trong đợt này — người dùng vẫn phải tải lại trang để thấy thông báo mention mới, dù bản thân bình luận (khi đang mở đúng đề xuất) đã real-time. Chấp nhận vì đây đúng ranh giới Sếp đã xác nhận (real-time cho bình luận, bell giữ nguyên cơ chế cũ).

## Migration Plan

- Không có dữ liệu cũ cần chuyển đổi (`comments` giữ nguyên cấu trúc mảng, chỉ thêm field mới; field thiếu ở bình luận cũ coi như không có mention/không phải trả lời).
- Thứ tự triển khai: (1) tạo `firestore.rules` + deploy rules cho project riêng của app, (2) xin/khai báo `NEXT_PUBLIC_FIREBASE_*`, (3) deploy code — tránh code gọi `onSnapshot` chạy trước khi có rule cho phép đọc.
- Rollback: revert deploy code; rule đọc thêm để lại không ảnh hưởng gì nếu không có client nào gọi tới.

## Open Questions

- `mentionedUids` có cần loại trừ chính người vừa viết bình luận (nếu họ tự mention lại chính mình) không? Đề xuất: loại trừ `session.uid` khỏi tập hợp nhận thông báo/mentionedUids khi họ tự mention mình — tránh tự báo cho chính mình, giống quyết định tương tự Sếp đã áp dụng cho `pkd_crm-next`.
- Token custom token nên refresh theo chu kỳ nào nếu người dùng mở trang chi tiết đề xuất rất lâu (nhiều giờ)? Firebase Client SDK tự refresh ID token, nhưng custom token gốc (JWT do server ký) có thời hạn ngắn (~1 giờ) — cần xác nhận `signInWithCustomToken` chỉ cần gọi 1 lần, các lần refresh sau do SDK tự lo, không cần gọi lại `/api/auth/firebase-token`.
- **Sửa bình luận có làm mới lại mốc 10 phút không?** Quyết định (chưa hỏi lại Sếp, dùng mặc định hợp lý): KHÔNG — mốc 10 phút luôn tính từ `comment.at` (lúc TẠO), không tính từ `editedAt`. Nếu tác giả sửa ở phút thứ 9, họ vẫn chỉ còn ~1 phút trước khi bị khóa hoàn toàn (không được "làm mới" thời hạn bằng cách sửa liên tục). Nếu Sếp muốn ngược lại (mỗi lần sửa được +10 phút mới), cần xác nhận lại — hiện triển khai theo hướng KHÔNG làm mới.
- Đồng hồ dùng để so 10 phút là đồng hồ SERVER (`Date.now()` trong API route, so với `comment.at` cũng do server ghi lúc tạo) — không dùng đồng hồ máy khách, tránh người dùng chỉnh giờ máy để né hạn. Client chỉ hiển thị đếm ngược tham khảo (có thể lệch vài giây do làm tròn), server luôn là nguồn quyết định cuối.
