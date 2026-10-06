import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockAuth, mockSignIn, mockOnSnapshot, mockDoc, mockGetAuth, mockGetFirestore } = vi.hoisted(() => {
  const mockAuth = { currentUser: null as { uid: string } | null };
  return {
    mockAuth,
    mockSignIn: vi.fn(),
    mockOnSnapshot: vi.fn(),
    mockDoc: vi.fn(() => ({ __kind: "signal-doc" })),
    mockGetAuth: vi.fn(() => mockAuth),
    mockGetFirestore: vi.fn(() => ({ __kind: "db" })),
  };
});

vi.mock("firebase/auth", () => ({ signInWithCustomToken: mockSignIn }));
vi.mock("firebase/firestore", () => ({ doc: mockDoc, onSnapshot: mockOnSnapshot }));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseAuth: mockGetAuth, getFirebaseFirestore: mockGetFirestore }));

import { listenRequestChanges } from "./request-change-signal";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("listenRequestChanges", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuth.currentUser = null;
    mockSignIn.mockReset().mockResolvedValue(undefined);
    mockOnSnapshot.mockReset().mockReturnValue(vi.fn());
    mockDoc.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ token: "tok" }) })),
    );
  });

  it("CHỈ nghe đúng tài liệu tín hiệu rỗng, không nghe collection `requests`", async () => {
    listenRequestChanges(() => {});
    await flush();
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "system", "notification-signal");
  });

  it("đã đăng nhập Firebase thì không xin token mới", async () => {
    mockAuth.currentUser = { uid: "u1" };
    listenRequestChanges(() => {});
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("chưa đăng nhập thì xin token rồi mới đăng nhập, sau đó mới nghe", async () => {
    listenRequestChanges(() => {});
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/auth/firebase-token", { method: "POST" });
    expect(mockSignIn).toHaveBeenCalledWith(mockAuth, "tok");
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
  });

  it("bỏ qua snapshot đầu tiên (trạng thái hiện tại), chỉ báo từ lần thứ 2", async () => {
    const onChange = vi.fn();
    listenRequestChanges(onChange);
    await flush();
    const [, next] = mockOnSnapshot.mock.calls[0];
    next({ metadata: { hasPendingWrites: false } });
    expect(onChange).not.toHaveBeenCalled();
    next({ metadata: { hasPendingWrites: false } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("bỏ qua bản ghi đang chờ ghi của chính máy này (hasPendingWrites)", async () => {
    const onChange = vi.fn();
    listenRequestChanges(onChange);
    await flush();
    const [, next] = mockOnSnapshot.mock.calls[0];
    next({ metadata: { hasPendingWrites: false } }); // bỏ qua (lần đầu)
    next({ metadata: { hasPendingWrites: true } }); // bỏ qua (đang chờ ghi)
    expect(onChange).not.toHaveBeenCalled();
    next({ metadata: { hasPendingWrites: false } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("lỗi xin token → gọi onError, không ném lỗi ra ngoài, không đăng ký nghe", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const onError = vi.fn();
    expect(() => listenRequestChanges(() => {}, onError)).not.toThrow();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(mockOnSnapshot).not.toHaveBeenCalled();
  });

  it("lỗi đăng nhập → gọi onError, không ném lỗi", async () => {
    mockSignIn.mockRejectedValue(new Error("boom"));
    const onError = vi.fn();
    listenRequestChanges(() => {}, onError);
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("lỗi listener (vd rules chặn) → gọi onError qua callback lỗi của onSnapshot", async () => {
    const onError = vi.fn();
    mockOnSnapshot.mockImplementation((_ref, _next, errCb: (e: unknown) => void) => {
      errCb(new Error("permission-denied"));
      return vi.fn();
    });
    listenRequestChanges(() => {}, onError);
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("gọi hàm dừng TRƯỚC khi đăng nhập xong thì không đăng ký nghe", async () => {
    let resolveSignIn!: () => void;
    mockSignIn.mockReturnValue(new Promise<void>((r) => (resolveSignIn = r)));
    const stop = listenRequestChanges(() => {});
    stop();
    resolveSignIn();
    await flush();
    expect(mockOnSnapshot).not.toHaveBeenCalled();
  });

  it("hàm dừng trả về hủy đăng ký listener đang chạy", async () => {
    const unsub = vi.fn();
    mockOnSnapshot.mockReturnValue(unsub);
    const stop = listenRequestChanges(() => {});
    await flush();
    stop();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
