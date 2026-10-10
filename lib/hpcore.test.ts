import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// "server-only" chỉ chặn import nhầm ở bundle client — dưới vitest throw
// ngay, cùng lý do đã mock ở các test khác (vd lib/congno.test.ts).
vi.mock("server-only", () => ({}));

vi.mock("firebase-admin/app", () => ({
  cert: vi.fn((c: unknown) => c),
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({})),
}));

const verifySessionCookieMock = vi.fn();
vi.mock("firebase-admin/auth", () => ({
  getAuth: vi.fn(() => ({ verifySessionCookie: verifySessionCookieMock })),
}));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(() => ({})),
}));

process.env.HPCORE_FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: "test" });

/** Nạp lại module mỗi ca test: `verifyCache`/`inFlight` sống suốt vòng đời
 * module (như `cachedTransporter` ở lib/server/mailer.test.ts) — không nạp
 * lại thì kết quả cache của ca trước lọt sang ca sau. */
async function napLai() {
  vi.resetModules();
  verifySessionCookieMock.mockReset();
  return await import("./hpcore");
}

const COOKIE = "fake-session-cookie";

function decoded(overrides: Partial<{ uid: string; email: string; exp: number }> = {}) {
  return {
    uid: "u1",
    email: "NGUOI.DUNG@HPCONS.COM.VN",
    exp: Math.floor(Date.now() / 1000) + 3600, // hết hạn sau 1 giờ mặc định
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("verifyHpcore — mặc định fresh:true, KHÔNG đổi hành vi cũ", () => {
  it("không truyền options -> vẫn gọi verifySessionCookie(cookie, true) như trước", async () => {
    const { verifyHpcore } = await napLai();
    verifySessionCookieMock.mockResolvedValue(decoded());
    await verifyHpcore(COOKIE);
    expect(verifySessionCookieMock).toHaveBeenCalledWith(COOKIE, true);
  });

  it("gọi 3 lần liên tiếp KHÔNG dùng cache, mỗi lần đều xác minh mới", async () => {
    const { verifyHpcore } = await napLai();
    verifySessionCookieMock.mockResolvedValue(decoded());
    await verifyHpcore(COOKIE, { fresh: true });
    await verifyHpcore(COOKIE, { fresh: true });
    await verifyHpcore(COOKIE, { fresh: true });
    expect(verifySessionCookieMock).toHaveBeenCalledTimes(3);
  });

  it("cookie rỗng/undefined -> null ngay, không gọi Firebase", async () => {
    const { verifyHpcore } = await napLai();
    expect(await verifyHpcore(undefined)).toBeNull();
    expect(verifySessionCookieMock).not.toHaveBeenCalled();
  });
});

describe("verifyHpcore({ fresh: false }) — cache 60 giây cho route đọc thường", () => {
  it("2 lượt gọi liên tiếp trong 60s -> chỉ xác minh mạng 1 lần", async () => {
    const { verifyHpcore } = await napLai();
    verifySessionCookieMock.mockResolvedValue(decoded());
    const first = await verifyHpcore(COOKIE, { fresh: false });
    vi.advanceTimersByTime(10_000);
    const second = await verifyHpcore(COOKIE, { fresh: false });
    expect(verifySessionCookieMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second).toEqual({ uid: "u1", email: "nguoi.dung@hpcons.com.vn" });
  });

  it("sau đúng 60 giây -> cache hết hạn, xác minh mạng lại", async () => {
    const { verifyHpcore } = await napLai();
    verifySessionCookieMock.mockResolvedValue(decoded());
    await verifyHpcore(COOKIE, { fresh: false });
    vi.advanceTimersByTime(60_001);
    await verifyHpcore(COOKIE, { fresh: false });
    expect(verifySessionCookieMock).toHaveBeenCalledTimes(2);
  });

  it("2 cookie khác nhau -> cache riêng biệt, không lẫn người", async () => {
    const { verifyHpcore } = await napLai();
    verifySessionCookieMock.mockImplementation(async (cookie: string) =>
      cookie === "cookie-a" ? decoded({ uid: "a" }) : decoded({ uid: "b" }),
    );
    const a = await verifyHpcore("cookie-a", { fresh: false });
    const b = await verifyHpcore("cookie-b", { fresh: false });
    expect(a?.uid).toBe("a");
    expect(b?.uid).toBe("b");
    expect(verifySessionCookieMock).toHaveBeenCalledTimes(2);
  });
});

describe("Cache KHÔNG được kéo dài hạn cookie thật (yêu cầu bắt buộc của Sếp)", () => {
  it("token hết hạn SỚM HƠN cửa sổ 60s -> hết hạn đúng lúc token hết hạn, không ăn theo cache", async () => {
    const { verifyHpcore } = await napLai();
    const expInSeconds = Math.floor(Date.now() / 1000) + 10; // chỉ còn 10s hiệu lực thật
    verifySessionCookieMock.mockResolvedValue(decoded({ exp: expInSeconds }));

    await verifyHpcore(COOKIE, { fresh: false }); // lần 1: xác minh thật, cache tới 60s NHƯNG token chỉ còn 10s

    vi.advanceTimersByTime(15_000); // mới 15s trôi qua (< 60s cửa sổ cache), NHƯNG token đã hết hạn thật
    verifySessionCookieMock.mockResolvedValueOnce(null as never); // giả lập verifySessionCookie thật cũng sẽ throw/null lúc này
    verifySessionCookieMock.mockRejectedValueOnce(new Error("session-cookie-expired"));

    const result = await verifyHpcore(COOKIE, { fresh: false });

    // Phải xác minh mạng lại (không phục vụ từ cache dù còn trong cửa sổ 60s)
    expect(verifySessionCookieMock).toHaveBeenCalledTimes(2);
    expect(result).toBeNull();
  });
});

describe("Tài khoản bị khoá/thu hồi (checkRevoked)", () => {
  it("verifySessionCookie ném lỗi (đã thu hồi) -> trả null, không cache bản lỗi", async () => {
    const { verifyHpcore } = await napLai();
    verifySessionCookieMock.mockRejectedValue(new Error("Firebase ID token has been revoked"));
    const result = await verifyHpcore(COOKIE, { fresh: false });
    expect(result).toBeNull();
  });

  it("cache ĐÃ có (đăng nhập hợp lệ trước đó), sau đó tài khoản bị khoá -> route fresh:true vẫn bắt được NGAY, không bị cache cản", async () => {
    const { verifyHpcore } = await napLai();
    verifySessionCookieMock.mockResolvedValue(decoded());
    await verifyHpcore(COOKIE, { fresh: false }); // tạo cache hợp lệ

    verifySessionCookieMock.mockRejectedValue(new Error("account disabled"));
    // Route "nhạy cảm" luôn dùng fresh:true -> phải thấy bị khoá ngay, dù cache fresh:false vẫn còn hiệu lực
    const sensitiveResult = await verifyHpcore(COOKIE, { fresh: true });
    expect(sensitiveResult).toBeNull();
  });

  it("thiếu email trong token đã giải mã -> coi như không hợp lệ, trả null", async () => {
    const { verifyHpcore } = await napLai();
    verifySessionCookieMock.mockResolvedValue(decoded({ email: "" }));
    expect(await verifyHpcore(COOKIE, { fresh: false })).toBeNull();
  });
});

describe("Chống gọi trùng đồng thời (request coalescing) — chỉ áp dụng fresh:false", () => {
  it("5 lượt gọi CÙNG LÚC (fresh:false, cùng cookie) -> chỉ 1 lượt xác minh mạng thật", async () => {
    const { verifyHpcore } = await napLai();
    let resolveVerify!: (v: unknown) => void;
    verifySessionCookieMock.mockReturnValue(
      new Promise((resolve) => {
        resolveVerify = resolve;
      }),
    );

    const calls = [
      verifyHpcore(COOKIE, { fresh: false }),
      verifyHpcore(COOKIE, { fresh: false }),
      verifyHpcore(COOKIE, { fresh: false }),
      verifyHpcore(COOKIE, { fresh: false }),
      verifyHpcore(COOKIE, { fresh: false }),
    ];
    expect(verifySessionCookieMock).toHaveBeenCalledTimes(1);

    resolveVerify(decoded());
    const results = await Promise.all(calls);
    results.forEach((r) => expect(r).toEqual({ uid: "u1", email: "nguoi.dung@hpcons.com.vn" }));
    expect(verifySessionCookieMock).toHaveBeenCalledTimes(1);
  });

  it("5 lượt gọi CÙNG LÚC với fresh:true -> KHÔNG gộp, mỗi lượt tự xác minh (đúng ý route nhạy cảm)", async () => {
    const { verifyHpcore } = await napLai();
    verifySessionCookieMock.mockResolvedValue(decoded());
    await Promise.all([
      verifyHpcore(COOKIE, { fresh: true }),
      verifyHpcore(COOKIE, { fresh: true }),
      verifyHpcore(COOKIE, { fresh: true }),
    ]);
    expect(verifySessionCookieMock).toHaveBeenCalledTimes(3);
  });
});
