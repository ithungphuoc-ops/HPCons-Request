## Why

Sếp chốt 24/08/2026 cần làm ngay 2 việc trong "Sổ nợ tính năng": (1) gửi email thông báo thật (trước đây cờ `emailNotify` chỉ lưu cấu hình), (2) làm thật "Cho phép người duyệt chuyển quyền duyệt cho người khác" — Sếp mô tả rõ kịch bản: A chưa hiểu đề xuất, chuyển cho B (hiểu rõ hơn) duyệt TRƯỚC, trách nhiệm đầu tiên là B, B xong quay lại A duyệt, rồi mới tới người kế tiếp của đề xuất.

## What Changes

- **Gửi email thật**: `lib/server/mailer.ts` (Nodemailer + Gmail SMTP — ĐÚNG cách 2 app khác trong hệ sinh thái, `ITAsset`/`HPCorp`, đã dùng và chạy thật, không thêm dịch vụ email thứ 3). Gửi ở 4 tình huống: người duyệt đang tới lượt, người tạo khi đề xuất xong (duyệt/từ chối), người theo dõi lúc gửi + lúc chấp thuận hoàn toàn. Tất cả gated bởi `group.notificationRules.emailNotify` (mặc định TẮT — không tự nhiên gửi email cho nhóm chưa cấu hình).
- 2 cờ đã có sẵn `sequentialTurnBasedNotify`/`perStepBlockNotify` được DÙNG THẬT lần đầu — quyết định ai trong số người duyệt được báo (mặc định cả 2 BẬT, khớp đúng cách tính "ai đang tới lượt" `canApproverAct` đã tin dùng ở mọi nơi khác).
- **Phát hiện quan trọng**: kịch bản Sếp mô tả (B duyệt trước, quay lại A, rồi mới tới người sau) **ĐÃ CÓ SẴN VÀ CHẠY ĐÚNG** trong app — chính là hành động "Chuyển tiếp và Duyệt" (`forward_then_approve`, `ForwardModal.tsx`) — KHÔNG cần xây mới. Cái thật sự thiếu là cờ bật/tắt `permissionRules.approversCanDelegateApproval` trước đây không có tác dụng gì (luôn cho phép, không kiểm tra cờ) — giờ nối cờ này vào đúng chỗ, ở cả UI (ẩn tuỳ chọn khỏi `ForwardModal`) và server (chặn hẳn nếu nhóm tắt cờ, không chỉ ẩn UI).
- **BREAKING nhỏ, có chủ đích**: đổi `DEFAULT_GROUP_PERMISSION_RULES.approversCanDelegateApproval` từ `false` → `true` — vì hành động này trước đây LUÔN được phép cho MỌI nhóm (không có cờ nào), đổi default thành `false` sẽ làm mất tính năng đang chạy cho toàn bộ nhóm hiện có. `true` mới đúng nghĩa "giữ hành vi hiện tại", admin có thể tắt riêng nếu muốn hạn chế.

## Capabilities

### New Capabilities
- `real-email-notifications`: hạ tầng gửi email thật cho 4 sự kiện đề xuất.

### Modified Capabilities
(none có spec archive để viết delta — coi `approversCanDelegateApproval` là hoàn thiện thêm hành vi cho field đã có trong `add-base-vn-approver-and-approval-form-parity`)

## Impact

- **Data**: không đổi shape — `notificationRules`/`permissionRules` đã có sẵn từ trước, chỉ đổi GIÁ TRỊ mặc định của 1 field.
- **Dependency mới**: `nodemailer` + `@types/nodemailer`.
- **API/logic mới**: `lib/server/mailer.ts`, `lib/server/notification-emails.ts` (có test), gọi từ `app/api/requests/route.ts` (POST) và `app/api/requests/[id]/decision/route.ts`.
- **UI**: `components/request/ForwardModal.tsx` (ẩn tuỳ chọn theo cờ), `components/request/RequestDetailView.tsx` (tải `permissionRules` qua route `print-templates` đã có sẵn — gộp response, không thêm round-trip), 2 trang cài đặt nhóm (đổi mô tả cho khớp thực tế mới).
- **Cần Sếp làm**: thêm 2 biến môi trường `GMAIL_USER`/`GMAIL_APP_PASSWORD` vào Vercel (project `request-app`) — thiếu thì email tự động bị bỏ qua (không lỗi, không chặn luồng), chỉ khi có đủ 2 biến này email mới thật sự được gửi.
