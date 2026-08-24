## 1. Gửi email thật

- [x] 1.1 Thêm `nodemailer` + `@types/nodemailer` vào `package.json`
- [x] 1.2 `lib/server/mailer.ts` — `sendMail()`, `resolveUserEmail()`, `isMailerConfigured()`, `buildRequestEmailHtml()`; Nodemailer + Gmail SMTP, thiếu env var → bỏ qua an toàn
- [x] 1.3 `lib/server/notification-emails.ts` — 4 hàm: `notifyPendingApprovers`, `notifySubmitterResult`, `notifyFollowersSubmitted`, `notifyFollowersFullyApproved`; đọc `canApproverAct` để xác định đúng người đang tới lượt
- [x] 1.4 8 test case (`lib/server/notification-emails.test.ts`, mock `lib/server/mailer.ts`)
- [x] 1.5 Nối vào `app/api/requests/route.ts` (POST, lúc gửi chính thức)
- [x] 1.6 Nối vào `app/api/requests/[id]/decision/route.ts` (cả 3 nhánh: thường, chuyển tiếp — bỏ qua nhánh "trả lại")
- [x] 1.7 Cập nhật mô tả ở `app/request/groups/[groupId]/(settings)/notifications/page.tsx` (không còn ghi "chỉ lưu cấu hình")

## 2. Cờ "Chuyển tiếp và Duyệt" có tác dụng thật

- [x] 2.1 `ForwardModal.tsx` — prop `allowForwardThenApprove`, ẩn tuỳ chọn khi tắt
- [x] 2.2 `RequestDetailView.tsx` — tải `permissionRules` (gộp vào response `print-templates` đã có, không thêm route mới), truyền cờ vào `ForwardModal`
- [x] 2.3 `app/api/groups/[id]/print-templates/route.ts` — trả kèm `permissionRules`
- [x] 2.4 `app/api/requests/[id]/decision/route.ts` — chặn server-side, trả 403 nếu nhóm tắt cờ mà vẫn cố gọi `forward_then_approve`
- [x] 2.5 **Đổi mặc định** `DEFAULT_GROUP_PERMISSION_RULES.approversCanDelegateApproval`: `false` → `true` (tránh hồi quy — hành động này trước đây luôn được phép mọi nhóm)
- [x] 2.6 Cập nhật mô tả ở `app/request/groups/[groupId]/(settings)/permissions/page.tsx` khớp đúng kịch bản Sếp mô tả

## 3. Kiểm thử

- [x] 3.1 `npm run build` sạch
- [x] 3.2 `npx vitest run` — 223/223 pass
- [ ] 3.3 Sếp thêm `GMAIL_USER`/`GMAIL_APP_PASSWORD` vào Vercel (project `request-app`) rồi redeploy — CẦN SẾP TỰ LÀM, em không có quyền/không nên tự thêm secret
- [ ] 3.4 Kiểm thủ công: gửi 1 đề xuất nhóm bật `emailNotify`, xác nhận người duyệt nhận được email thật; thử "Chuyển tiếp và Duyệt" ở nhóm tắt `approversCanDelegateApproval`, xác nhận tuỳ chọn biến mất + gọi API thẳng bị chặn 403 — CẦN SẾP TỰ TEST sau khi có env var
