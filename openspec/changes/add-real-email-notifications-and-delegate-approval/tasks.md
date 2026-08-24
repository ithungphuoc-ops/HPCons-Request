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

## 3. Vá góp ý CodeRabbit (review PR #4, 24/08/2026 — 4 phát hiện)

- [x] 3a.1 🔴 Major (Security) — `groupNameSnapshot`/`code` chèn thẳng vào HTML email không escape (đề xuất trực tiếp cho người dùng tự đặt tên → có thể chèn link giả) — thêm `escapeHtml()` (`lib/server/mailer.ts`, có test riêng `mailer.test.ts`), dùng ở cả 4 hàm gửi mail
- [x] 3a.2 🟠 Major (Stability) — SMTP có thể treo lâu làm chậm response route duyệt/gửi đề xuất — thêm `connectionTimeout`/`greetingTimeout`/`socketTimeout` cho transporter. **KHÔNG làm** phần "hàng đợi + retry idempotent" CodeRabbit gợi ý thêm (tự đánh giá "Heavy lift") — quy mô app hiện tại chưa cần, nhất quán với cách `guiSangQlkCtr`/`guiSangThuMua` đã làm trong cùng route
- [x] 3a.3 🟡 Minor — mô tả "Thông báo email" ở trang cài đặt thiếu nhắc người theo dõi cũng được báo — đã bổ sung
- [x] 3a.4 🟡 Minor — `ForwardModal` không reset `mode` khi `allowForwardThenApprove` đổi true→false lúc modal đang mở — thêm `useEffect` reset

## 4. Kiểm thử

- [x] 4.1 `npm run build` sạch
- [x] 4.2 `npx vitest run` — 228/228 pass (8 test cũ + 5 test `mailer.test.ts` mới)
- [ ] 4.3 Sếp thêm `GMAIL_USER`/`GMAIL_APP_PASSWORD` vào Vercel (project `request-app`) rồi redeploy — CẦN SẾP TỰ LÀM, em không có quyền/không nên tự thêm secret. Sếp đã chốt 24/08/2026: dùng chung tài khoản Gmail đang gửi cho ITAsset/HP Corp
- [ ] 4.4 Kiểm thủ công: gửi 1 đề xuất nhóm bật `emailNotify`, xác nhận người duyệt nhận được email thật; thử "Chuyển tiếp và Duyệt" ở nhóm tắt `approversCanDelegateApproval`, xác nhận tuỳ chọn biến mất + gọi API thẳng bị chặn 403 — CẦN SẾP TỰ TEST sau khi có env var
