import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn() },
}));
vi.mock("@/lib/hpcore", () => ({
  getHpcoreDb: () => ({
    collection: () => ({ doc: () => ({ get: async () => ({ data: () => undefined }) }) }),
  }),
}));

const { escapeHtml, isMailerConfigured, sendMail } = await import("./mailer");

describe("escapeHtml — chặn HTML/link lạ chèn vào email thông báo", () => {
  it("escape đủ 5 ký tự đặc biệt", () => {
    expect(escapeHtml(`<a href="x">&'test'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;test&#39;&lt;/a&gt;",
    );
  });

  it("chuỗi thường (tên đề xuất bình thường) không đổi gì", () => {
    expect(escapeHtml("Đề nghị thanh toán NTP đợt 2")).toBe("Đề nghị thanh toán NTP đợt 2");
  });

  it("chặn được đúng kịch bản CodeRabbit nêu: tên đề xuất tự đặt chứa link giả", () => {
    const malicious = 'Xem gấp <a href="https://phishing.example.com">tại đây</a>';
    const escaped = escapeHtml(malicious);
    expect(escaped).not.toContain("<a ");
    expect(escaped).toContain("&lt;a href=&quot;https://phishing.example.com&quot;&gt;");
  });
});

describe("Thiếu biến môi trường → không gửi, không throw", () => {
  // Góp ý CodeRabbit (review PR #4, lần 2, 24/08/2026): máy chạy test có
  // thể SẴN CÓ GMAIL_USER/GMAIL_APP_PASSWORD (vd .env.local đã pull từ
  // Vercel sau khi Sếp thêm 2 biến này) — phải xoá tạm 2 biến trước 2 test
  // dưới đây rồi trả lại nguyên trạng, không phụ thuộc máy nào đang chạy.
  beforeEach(() => {
    vi.stubEnv("GMAIL_USER", "");
    vi.stubEnv("GMAIL_APP_PASSWORD", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("isMailerConfigured() false khi chưa có GMAIL_USER/GMAIL_APP_PASSWORD", () => {
    expect(isMailerConfigured()).toBe(false);
  });

  it("sendMail() trả false, không throw", async () => {
    await expect(sendMail({ to: "a@b.com", subject: "x", html: "<p>x</p>" })).resolves.toBe(false);
  });
});
