## Context

`GroupNotificationRules.emailNotify` và 2 cờ `sequentialTurnBasedNotify`/`perStepBlockNotify` đã tồn tại từ change `add-base-vn-approver-and-approval-form-parity` nhưng chưa gọi tới bất kỳ hành động thật nào. `GroupPermissionRules.approversCanDelegateApproval` cũng ở tình trạng tương tự — Open Question #3 của change đó để ngỏ vì chưa rõ có trùng "Chuyển tiếp" đã có hay không. Sếp đã trả lời rõ: đúng là trùng — mô tả kịch bản khớp 100% với `forward_then_approve`.

## Goals / Non-Goals

**Goals:**
- Email thật gửi được ngay khi Sếp thêm 2 biến môi trường, không cần sửa code thêm.
- Không đổi hành vi "Chuyển tiếp và Duyệt" cho nhóm cũ (mặc định vẫn cho phép).
- Chặn ở CẢ client (ẩn UI) và server (từ chối request) khi nhóm tắt cờ delegate — không chỉ ẩn nút.

**Non-Goals:**
- Không xây dựng lại `forward_then_approve` — đã đúng, chỉ thêm lớp cho phép/không cho phép.
- Không làm giao diện quản lý mẫu email (subject/nội dung cố định trong code, đơn giản, không cần trang cấu hình riêng cho lần đầu này).
- Không xử lý "trả lại" (`returned`) trong luồng email — không thuộc yêu cầu Sếp đưa ra, để lại nếu cần sau.
- Không tự tạo Gmail account nào — dùng đúng biến môi trường Sếp cung cấp.

## Decisions

1. **Nodemailer + Gmail SMTP**, không dùng Resend/SendGrid/SES — đã rà toàn workspace, 2 app khác (`ITAsset`, `HPCorp`) dùng đúng cách này và chạy thật, giữ nhất quán, không tạo thêm 1 tài khoản dịch vụ trả phí mới.
2. **Không throw lỗi khi thiếu cấu hình** — `sendMail()` trả `false` thầm lặng nếu thiếu `GMAIL_USER`/`GMAIL_APP_PASSWORD`, không chặn luồng duyệt/gửi đề xuất chính (giống triết lý QLK CTR/Thu Mua sync đã có).
3. **`currentlyActionableUids()` dùng lại `canApproverAct`** — không viết lại logic "ai đang tới lượt", tận dụng đúng hàm đã có test kỹ ở `lib/approval-logic.test.ts`.
4. **2 cờ turn-based/block áp dụng CHỈ cho người duyệt**, không áp dụng cho người tạo/người theo dõi — khớp đúng câu chữ mô tả trong UI ("người tạo đề xuất LUÔN nhận được thông báo... người theo dõi chỉ nhận khi tạo/chấp thuận hoàn toàn" — 2 vế sau không gắn với cờ nào).
5. **Đổi `DEFAULT_GROUP_PERMISSION_RULES.approversCanDelegateApproval` → `true`** — quyết định KHÔNG hỏi lại Sếp vì đây là vấn đề đúng/sai kỹ thuật (tránh hồi quy), không phải quyết định nghiệp vụ: hành động này đang chạy cho MỌI nhóm, đổi default thành tắt sẽ vô tình khoá tính năng đang dùng được của toàn bộ nhóm hiện tại.

## Risks / Trade-offs

- [Rủi ro] Gmail SMTP có giới hạn gửi (khoảng 500 email/ngày/tài khoản cá nhân, cao hơn với Google Workspace) — quy mô công ty hiện tại chấp nhận được, cần đổi sang dịch vụ email chuyên dụng (SES/SendGrid...) nếu số lượng đề xuất/ngày tăng nhiều.
- [Rủi ro] Nhóm bật `emailNotify` nhưng thiếu env var → im lặng không gửi được, Admin không biết. Mitigation: `isMailerConfigured()` đã viết sẵn, có thể hiện cảnh báo ở trang cài đặt nhóm sau nếu cần (chưa làm trong lần này, không thuộc yêu cầu).
- [Rủi ro] Đổi default `approversCanDelegateApproval` ảnh hưởng MỌI nhóm cùng lúc lúc deploy — nhưng đây là ĐÚNG Ý ĐỊNH (giữ nguyên hành vi cũ), không phải rủi ro thật.

## Migration Plan

- Deploy code trước — chưa có `GMAIL_USER`/`GMAIL_APP_PASSWORD` thì mọi thứ hoạt động y như cũ (email tự bỏ qua, không lỗi).
- Sếp thêm 2 biến môi trường vào Vercel (Settings → Environment Variables, project `request-app`) khi sẵn sàng — không cần deploy lại (Vercel tự inject env var cho lần build/serverless invocation kế tiếp, nhưng CẦN redeploy 1 lần để áp dụng — theo cơ chế Vercel).
