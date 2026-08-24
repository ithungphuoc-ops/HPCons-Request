import "server-only";
import nodemailer from "nodemailer";
import { getHpcoreDb } from "@/lib/hpcore";
import { CURRENT_APP_HOST } from "@/lib/constants";

/**
 * Gửi email thông báo thật — Sếp chốt 24/08/2026 cần làm. Dùng Nodemailer +
 * Gmail SMTP (`GMAIL_USER`/`GMAIL_APP_PASSWORD`) — ĐÚNG cách 2 app khác
 * trong hệ sinh thái (`ITAsset`, `HPCorp`) đã dùng và chạy thật, không tạo
 * thêm 1 dịch vụ email thứ 3 (Resend/SendGrid/SES...) không cần thiết.
 *
 * Thiếu biến môi trường → coi như CHƯA cấu hình, tự bỏ qua (không throw,
 * không chặn luồng nghiệp vụ chính) — Sếp cần thêm `GMAIL_USER` +
 * `GMAIL_APP_PASSWORD` vào Vercel (Settings → Environment Variables) của
 * project `request-app` để email thật sự được gửi.
 */
let cachedTransporter: ReturnType<typeof nodemailer.createTransport> | null | undefined;

function getTransporter() {
  if (cachedTransporter !== undefined) return cachedTransporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    cachedTransporter = null;
    return null;
  }
  cachedTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
    // Góp ý CodeRabbit (review PR #4, 24/08/2026): không đặt timeout thì 1
    // lần SMTP treo có thể giữ request duyệt/gửi đề xuất TREO theo cả phút —
    // đặt timeout ngắn để lỗi nhanh, không "treo lâu" như CodeRabbit lo
    // ngại. Chưa làm hàng đợi/retry idempotent riêng (CodeRabbit gợi ý mức
    // "Heavy lift") — quy mô app hiện tại 1 route await trực tiếp là đủ,
    // giống đúng cách guiSangQlkCtr/guiSangThuMua đã làm trong cùng route
    // quyết định, không phải hồi quy mới.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
  return cachedTransporter;
}

/** Escape 5 ký tự HTML đặc biệt — dùng cho MỌI giá trị KHÔNG do chính code
 * này viết ra (tên đề xuất, mã đề xuất...) trước khi chèn vào email HTML.
 * Vá lỗ hổng CodeRabbit phát hiện (review PR #4, 24/08/2026, mức Major):
 * đề xuất trực tiếp cho phép người dùng tự đặt `groupNameSnapshot` (chính
 * là `title` họ gõ) — không escape thì 1 người có thể chèn `<a href=...>`
 * biến email thông báo thật thành link lừa đảo (phishing) gửi tới người
 * khác trong công ty. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** true nếu đã có đủ biến môi trường để gửi email thật — dùng để log rõ lý
 * do bỏ qua thay vì im lặng khó hiểu. */
export function isMailerConfigured(): boolean {
  return getTransporter() !== null;
}

/**
 * Gửi 1 email — bắn rồi quên, KHÔNG BAO GIỜ throw ra ngoài (lỗi gửi email
 * không được phép làm hỏng luồng duyệt/gửi đề xuất chính). Trả `true` nếu
 * gửi thành công, `false` nếu bỏ qua (thiếu cấu hình) hoặc lỗi.
 */
export async function sendMail(params: { to: string; subject: string; html: string }): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) return false;
  try {
    await transporter.sendMail({
      from: `"HP Cons — App Đề xuất" <${process.env.GMAIL_USER}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    return true;
  } catch (error) {
    console.error("Gửi email thông báo thất bại (không ảnh hưởng thao tác chính):", error);
    return false;
  }
}

/** Tra email thật của 1 uid từ users/{uid} của app tổng (hpcore) — cùng
 * collection/field `email` đã dùng ở `/api/directory`, `/api/directory/managers`. */
export async function resolveUserEmail(uid: string): Promise<string | null> {
  try {
    const snap = await getHpcoreDb().collection("users").doc(uid).get();
    const email = (snap.data()?.email as string | undefined)?.trim();
    return email || null;
  } catch {
    return null;
  }
}

export function requestDetailUrl(requestId: string): string {
  return `https://${CURRENT_APP_HOST}/request/requests/${requestId}`;
}

/** Khung email chung, tối giản — không cần template phức tạp cho email nội bộ. */
export function buildRequestEmailHtml(params: { greeting: string; body: string; requestId: string; ctaLabel: string }): string {
  const url = requestDetailUrl(params.requestId);
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#132630;line-height:1.6;">
      <p>${params.greeting}</p>
      <p>${params.body}</p>
      <p style="margin:20px 0;">
        <a href="${url}" style="background:#096aa7;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:700;">
          ${params.ctaLabel}
        </a>
      </p>
      <p style="color:#8b9aa3;font-size:12px;">Email tự động từ App Đề xuất HP Cons — không cần trả lời email này.</p>
    </div>
  `;
}
