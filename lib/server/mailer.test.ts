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

describe("nói rõ lý do khi BỎ QUA gửi email", () => {
  // Vì sao có nhóm test này: 15/09/2026 gửi thử một đề xuất thật trên
  // production rồi đọc nhật ký máy chủ vẫn KHÔNG biết email có đi hay không —
  // đường "thiếu cấu hình" trả false mà không để lại một dòng nào. Phải mở hộp
  // thư người nhận mới biết. Khoá hành vi mới lại bằng test để không ai lỡ tay
  // đưa sự im lặng đó quay về.
  //
  // PHẢI nạp lại module trong từng ca: `cachedTransporter` sống suốt vòng đời
  // module, nên nếu dùng bản đã import ở đầu tệp thì cảnh báo đã bắn từ ca test
  // trước, spy gắn sau không bắt được gì.
  async function napLai() {
    vi.resetModules();
    return await import("./mailer");
  }

  it("thiếu CẢ HAI biến -> cảnh báo nêu đủ tên 2 biến", async () => {
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await napLai();

    const duoc = await m.sendMail({ to: "a@b.com", subject: "x", html: "y" });

    expect(duoc).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const noiDung = String(warn.mock.calls[0][0]);
    expect(noiDung).toContain("GMAIL_USER");
    expect(noiDung).toContain("GMAIL_APP_PASSWORD");
    warn.mockRestore();
  });

  it("thiếu ĐÚNG MỘT biến -> chỉ nêu đúng biến đang thiếu", async () => {
    process.env.GMAIL_USER = "app@hpcons.com.vn";
    delete process.env.GMAIL_APP_PASSWORD;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await napLai();

    await m.sendMail({ to: "a@b.com", subject: "x", html: "y" });

    const noiDung = String(warn.mock.calls[0][0]);
    expect(noiDung).toContain("GMAIL_APP_PASSWORD");
    expect(noiDung).not.toContain("GMAIL_USER");
    warn.mockRestore();
    delete process.env.GMAIL_USER;
  });

  it("chỉ cảnh báo MỘT lần dù gửi nhiều email", async () => {
    // Một đề xuất báo cho nhiều người: log mỗi lần gửi sẽ đẻ ra hàng loạt dòng
    // giống hệt nhau, lấp mất log thật.
    delete process.env.GMAIL_USER;
    delete process.env.GMAIL_APP_PASSWORD;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await napLai();

    await m.sendMail({ to: "a@b.com", subject: "x", html: "y" });
    await m.sendMail({ to: "c@d.com", subject: "x", html: "y" });
    await m.sendMail({ to: "e@f.com", subject: "x", html: "y" });

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
