## 1. Dữ liệu

- [x] 1.1 Mở rộng `RequestComment` trong `lib/types.ts`: thêm `mentionIds?: string[]`, `parentId?: string | null` (giữ cho tương thích dữ liệu cũ, KHÔNG còn đường tạo mới), `editedAt?: string`
- [x] 1.2 Thêm `mentionedUids?: string[]` vào `RequestInstance`
- [x] 1.3 Thêm `getAdminAuth()` vào `lib/firebase/admin.ts` (dùng để mint custom token)
- [x] 1.4 **MỚI** — Thêm `attachment?: RequestAttachment | null` vào `RequestComment` trong `lib/types.ts` (tái dùng type `RequestAttachment` đã có, không tạo type mới)

## 2. Cầu nối xác thực Firebase Client SDK

- [x] 2.1 Cài dependency `firebase` (client SDK)
- [x] 2.2 Xin/khai báo biến môi trường `NEXT_PUBLIC_FIREBASE_*` cho project riêng của app (từ Firebase Console) — đã lấy từ Sếp, ghi vào `.env.local` (local dev); **CẦN SẾP TỰ LÀM**: thêm 6 giá trị này vào Vercel → Settings → Environment Variables (Production) để chạy được trên production, hiện chỉ có ở local
- [x] 2.3 Tạo `lib/firebase/client.ts` — khởi tạo Firebase Client SDK (lazy init, theo pattern `lib/hpcore.ts`/`lib/firebase/admin.ts` đã có)
- [x] 2.4 Tạo `app/api/auth/firebase-token/route.ts`: `requireSession()` rồi `getAdminAuth().createCustomToken(session.uid)`, trả token cho client
- [x] 2.5 Tạo `firestore.rules` cho project riêng của app (chưa từng tồn tại) — `match /requests/{requestId} { allow read: if isSignedIn(); allow write: if false; }`
- [ ] 2.6 Deploy `firestore.rules` TRƯỚC khi deploy code — **CẦN SẾP TỰ LÀM**: `firebase deploy --only firestore:rules --project hpcons-request` từ máy đã `firebase login`, hoặc dán nội dung `firestore.rules` vào Firebase Console (project Hpcons-Request) → Firestore Database → Rules → Publish. Trước khi publish, real-time sẽ báo lỗi "Missing or insufficient permissions"; API tạo/sửa/xóa bình luận vẫn hoạt động bình thường (qua Admin SDK, không phụ thuộc rule).

## 3. API bình luận

- [x] 3.1 ~~`POST /api/requests/[id]/comments`: nhận thêm `mentionIds`, `parentId`...`~~ — **ĐỔI HƯỚNG (3.1b)**: `POST` nhận `mentionIds` và `attachment` (KHÔNG nhận `parentId` mới nữa — bỏ hẳn trả lời, xem mục 8)
- [x] 3.2 Sau khi tạo bình luận có mention, cập nhật `mentionedUids` trên `requests/{id}` (hợp nhất, loại trùng, loại trừ chính người vừa bình luận nếu tự mention mình — xem Open Questions trong design.md)
- [x] 3.3 **ĐỔI HƯỚNG** — `PATCH /api/requests/[id]/comments/[commentId]/route.ts`: chỉ tác giả sửa được nội dung, VÀ CHỈ khi `Date.now() - new Date(target.at).getTime() <= 10 * 60 * 1000` (kiểm tra lại ở server, không tin client); set `editedAt` nhưng KHÔNG dùng `editedAt` để tính lại mốc 10 phút (luôn tính từ `at` gốc)
- [x] 3.4 **ĐỔI HƯỚNG** — `DELETE` cùng route: trong 10 phút đầu — CHỈ tác giả xóa được; sau 10 phút — CHỈ `session.role === "owner"` xóa được (thêm điều kiện mới, KHÔNG dùng `canManageGroupsAtAppScope` vì hàm đó gộp cả "admin"); admin (không phải owner) bị từ chối 403 ở mọi thời điểm nếu không phải tác giả

## 4. Nguồn mention nhóm/phòng ban

- [x] 4.1 Thêm hàm đọc `getHpcoreDb().collection("memberGroups")` và `.collection("departments")`, map về dạng tương thích `TaggedUser` kèm cờ phân biệt loại
- [x] 4.2 Tạo `app/api/directory/mentionable/route.ts` (route mới, KHÔNG sửa `/api/directory` hiện có) — trả về cả người lẫn nhóm/phòng ban

## 5. UI

- [x] 5.1 Mở rộng `TagUserInput` (hoặc tạo biến thể) để phân biệt hiển thị "người" vs "nhóm/phòng ban" (icon/nhãn khác nhau) khi dùng cho mention — không đổi hành vi ở 3 nơi đang dùng nó cho usedFor/approverSteps/followers
- [x] 5.2 `RequestDetailView.tsx`: gắn ô mention vào khung Thảo luận, dùng route `app/api/directory/mentionable` (tách thành `components/request/CommentSection.tsx`)
- [x] 5.3 `RequestDetailView.tsx`: bootstrap real-time — gọi `/api/auth/firebase-token` 1 lần, `signInWithCustomToken`, mở `onSnapshot` trên `requests/{id}`, cập nhật state `comments` từ snapshot; unsubscribe khi rời trang
- [x] 5.4 **ĐỔI HƯỚNG** — Nút Sửa/Xóa trên mỗi bình luận: tác giả thấy Sửa+Xóa CHỈ trong 10 phút kể từ `comment.at` (đếm ngược hiển thị tham khảo, ví dụ "Còn 7:42 để sửa/xóa"); sau 10 phút tác giả không còn thấy nút nào; Owner thấy Xóa (không phải Sửa) trên bình luận đã khóa của người khác; người khác (không phải tác giả, không phải Owner) không thấy nút nào bao giờ
- [x] 5.5 ~~Nút "Trả lời"...~~ — **ĐỔI HƯỚNG (5.5b)**: BỎ HẲN nút "Trả lời" khỏi UI — danh sách bình luận hiển thị phẳng, sắp theo `at`; không còn đường nào trong UI gán `parentId` mới (giữ hiển thị đúng nếu dữ liệu cũ có `parentId` — xem spec)
- [x] 5.6 `NotificationBell.tsx`: thêm fetch `/api/requests?scope=mentioned`, hợp nhất với 2 nguồn cũ (inbox/mine) thành danh sách hiển thị
- [x] 5.7 **MỚI** — Nút 📎 "Đính kèm file" trong ô soạn bình luận: chọn 1 file → hiện chip (tên + nút bỏ đính kèm) → gửi bình luận thì tải file qua `/api/uploads` trước, đính kèm kết quả vào payload `POST /comments`
- [x] 5.8 **MỚI** — Bình luận có `attachment`: hiển thị dòng nhỏ (icon + tên + dung lượng), bấm mở `FilePreviewModal` đã có (không tạo modal riêng)

## 6. API scope mention cho NotificationBell

- [x] 6.1 `GET /api/requests`: thêm xử lý `scope=mentioned` — trả về các đề xuất có `mentionedUids` chứa uid hiện tại

## 7. Kiểm thử thủ công

- [ ] 7.1 Mở cùng 1 đề xuất ở 2 trình duyệt/2 tài khoản khác nhau — gửi bình luận ở 1 bên, xác nhận bên kia thấy ngay không cần F5
- [ ] 7.2 Mention 1 người cụ thể — tải lại `NotificationBell` của người đó, xác nhận thấy mục thông báo
- [ ] 7.3 Mention 1 nhóm nhiều người — xác nhận tất cả thành viên đều thấy thông báo khi tải lại
- [ ] 7.4 **ĐỔI HƯỚNG** — Xác nhận KHÔNG còn nút "Trả lời" ở đâu trong UI; danh sách bình luận hiển thị phẳng đúng thứ tự thời gian
- [ ] 7.5 Tự đăng 1 bình luận, thử Sửa/Xóa NGAY (trong 10 phút) → thành công; đợi/giả lập quá 10 phút rồi thử lại → bị từ chối 403, nút cũng ẩn khỏi UI
- [ ] 7.6 Tài khoản role "admin" (không phải "owner") thử xóa bình luận đã khóa của người khác → xác nhận bị từ chối 403 (khác hành vi cũ — trước đây admin xóa được)
- [ ] 7.7 Tài khoản role "owner" xóa bình luận đã khóa của người khác → thành công; thử SỬA bình luận của người khác (dù là owner) → bị từ chối 403
- [ ] 7.8 Đính kèm 1 file khi gửi bình luận → xác nhận file lên R2 thành công, bấm vào bình luận đã gửi mở đúng `FilePreviewModal`
- [ ] 7.9 Thử mở `onSnapshot` với 1 request ID không liên quan (không phải submitter/approver/follower/admin) — xác nhận rủi ro đã ghi nhận ở design.md (đọc được nhưng chấp nhận cho đợt này)
- [ ] 7.10 Kiểm tra 3 nơi cũ dùng `TagUserInput` (usedFor/approverSteps/followers) vẫn hoạt động đúng như trước, không bị ảnh hưởng bởi thay đổi
