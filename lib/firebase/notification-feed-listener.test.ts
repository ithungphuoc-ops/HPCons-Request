import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockAuth, mockSignIn, mockOnSnapshot, mockDoc, mockGetAuth, mockGetFirestore } = vi.hoisted(() => {
  const mockAuth = { currentUser: null as { uid: string } | null };
  return {
    mockAuth,
    mockSignIn: vi.fn(),
    mockOnSnapshot: vi.fn(),
    mockDoc: vi.fn(() => ({ __kind: "feed-doc" })),
    mockGetAuth: vi.fn(() => mockAuth),
    mockGetFirestore: vi.fn(() => ({ __kind: "db" })),
  };
});

vi.mock("firebase/auth", () => ({ signInWithCustomToken: mockSignIn }));
vi.mock("firebase/firestore", () => ({ doc: mockDoc, onSnapshot: mockOnSnapshot }));
vi.mock("@/lib/firebase/client", () => ({ getFirebaseAuth: mockGetAuth, getFirebaseFirestore: mockGetFirestore }));

import { listenMyNotificationFeed } from "./notification-feed-listener";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("listenMyNotificationFeed", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockAuth.currentUser = null;
    mockSignIn.mockReset().mockImplementation(async () => {
      mockAuth.currentUser = { uid: "u1" };
    });
    mockOnSnapshot.mockReset().mockReturnValue(vi.fn());
    mockDoc.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ token: "tok" }) })),
    );
  });

  it("CHỈ nghe đúng tài liệu notification-feed/{uid} của chính mình", async () => {
    listenMyNotificationFeed("u1", () => {});
    await flush();
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "notification-feed", "u1");
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
  });

  it("Firebase đã đăng nhập ĐÚNG người thì không xin token mới", async () => {
    mockAuth.currentUser = { uid: "u1" };
    listenMyNotificationFeed("u1", () => {});
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("Firebase còn nhớ NGƯỜI KHÁC (máy dùng chung) → xin token, đăng nhập lại đúng người", async () => {
    mockAuth.currentUser = { uid: "nguoi-truoc" };
    listenMyNotificationFeed("u1", () => {});
    await flush();
    expect(fetch).toHaveBeenCalledWith("/api/auth/firebase-token", { method: "POST" });
    expect(mockSignIn).toHaveBeenCalledWith(mockAuth, "tok");
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "notification-feed", "u1");
  });

  it("đăng nhập xong vẫn lệch uid → onError, không nghe", async () => {
    mockSignIn.mockImplementation(async () => {
      mockAuth.currentUser = { uid: "khac" };
    });
    const onError = vi.fn();
    listenMyNotificationFeed("u1", () => {}, onError);
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(mockOnSnapshot).not.toHaveBeenCalled();
  });

  it("chưa có tài liệu → onData(null); có → onData(dữ liệu)", async () => {
    const onData = vi.fn();
    listenMyNotificationFeed("u1", onData);
    await flush();
    const [, next] = mockOnSnapshot.mock.calls[0];
    next({ exists: () => false, data: () => undefined });
    expect(onData).toHaveBeenLastCalledWith(null);
    next({ exists: () => true, data: () => ({ badge: 2 }) });
    expect(onData).toHaveBeenLastCalledWith({ badge: 2 });
  });

  it("lỗi xin token → onError, không ném lỗi", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const onError = vi.fn();
    expect(() => listenMyNotificationFeed("u1", () => {}, onError)).not.toThrow();
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(mockOnSnapshot).not.toHaveBeenCalled();
  });

  it("lỗi listener (vd rules chưa deploy) → onError", async () => {
    const onError = vi.fn();
    mockOnSnapshot.mockImplementation((_ref, _next, errCb: (e: unknown) => void) => {
      errCb(new Error("permission-denied"));
      return vi.fn();
    });
    listenMyNotificationFeed("u1", () => {}, onError);
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("dừng TRƯỚC khi đăng nhập xong thì không đăng ký nghe; dừng sau thì huỷ listener", async () => {
    let resolveSignIn!: () => void;
    mockSignIn.mockReturnValue(
      new Promise<void>((r) => (resolveSignIn = () => {
        mockAuth.currentUser = { uid: "u1" };
        r();
      })),
    );
    const stop = listenMyNotificationFeed("u1", () => {});
    stop();
    resolveSignIn();
    await flush();
    expect(mockOnSnapshot).not.toHaveBeenCalled();

    const unsub = vi.fn();
    mockOnSnapshot.mockReturnValue(unsub);
    mockAuth.currentUser = { uid: "u1" };
    const stop2 = listenMyNotificationFeed("u1", () => {});
    await flush();
    stop2();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
