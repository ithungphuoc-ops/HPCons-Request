import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/server/mailer", () => ({
  requestDetailUrl: (id: string) => `https://request.hpcore.vn/request/requests/${id}`,
}));

// Chuông chung App Tổng (ghi Firestore) — không phải phần đang test, cho ghi giả.
vi.mock("@/lib/hpcore", () => ({
  getHpcoreDb: () => ({
    collection: () => ({ doc: () => ({ id: "x" }) }),
    batch: () => ({ set: () => {}, commit: async () => {} }),
  }),
}));

const {
  DEFAULT_PUSH_DISPATCH_URL,
  DISPATCH_RETRY_DELAY_MS,
  buildDispatchItems,
  buildEventId,
  chunkDispatch,
  dispatchPushItems,
  fitLength,
  getPushDispatchConfig,
  postDispatch,
  resetDispatchWarningsForTest,
} = await import("./push-dispatch");
const { buildPushPayload } = await import("@/lib/web-push-payload");
const { hpcoreCommentOnMine, hpcoreMentioned, hpcorePendingApprovers, hpcoreSubmitterReturned } = await import("./hpcore-notifications");
import type { PushKind } from "@/lib/web-push-payload";
import type { RequestInstance } from "@/lib/types";

const KEY = "k".repeat(32);

const payload = (kind: PushKind) =>
  buildPushPayload({ kind, requestId: "r1", code: "000123", groupName: "1.0. Phiếu đề nghị (HPCons)", actorName: "Nguyễn Văn A", excerpt: "Bổ sung báo giá" });

const fetchMock = vi.fn();
const ok = () => new Response(JSON.stringify({ ok: true, queued: 1 }), { status: 200 });

function sentBodies(): { appId: string; eventId: string; items: { uid: string; category: string; onlyIfDisabled?: string; push: Record<string, string> }[] }[] {
  return fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ok());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NOTIFY_INGEST_KEY", KEY);
  vi.stubEnv("NOTIFY_PUSH_DISPATCH_URL", "");
  resetDispatchWarningsForTest();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const noSleep = { sleep: async () => {} };

describe("tắt khi thiếu khoá", () => {
  it("thiếu khoá hoặc < 24 ký tự → không gọi mạng, cảnh báo đúng 1 lần, không lộ khoá", async () => {
    vi.stubEnv("NOTIFY_INGEST_KEY", "short-key-123");
    await dispatchPushItems([{ uid: "uA", payload: payload("approved") }], { eventKey: "e1" });
    await dispatchPushItems([{ uid: "uA", payload: payload("approved") }], { eventKey: "e2" });
    expect(fetchMock).not.toHaveBeenCalled();
    const warn = console.warn as unknown as ReturnType<typeof vi.fn>;
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain("short-key-123");
    vi.stubEnv("NOTIFY_INGEST_KEY", "");
    expect(getPushDispatchConfig()).toBeNull();
  });

  it("có khoá → URL mặc định của App Tổng, hoặc URL đặt riêng", () => {
    expect(getPushDispatchConfig()).toEqual({ url: DEFAULT_PUSH_DISPATCH_URL, key: KEY });
    expect(DEFAULT_PUSH_DISPATCH_URL).toBe("https://account.hpcore.vn/api/push/dispatch");
    vi.stubEnv("NOTIFY_PUSH_DISPATCH_URL", "https://staging.example/api/push/dispatch");
    expect(getPushDispatchConfig()?.url).toBe("https://staging.example/api/push/dispatch");
  });
});

describe("dựng gói gửi App Tổng", () => {
  it("mỗi loại → đúng nhóm; nội dung GIỮ NGUYÊN câu chữ, url đầy đủ tới request.hpcore.vn", () => {
    const kinds: [PushKind, string][] = [
      ["pending_approval", "approval"],
      ["adjustment_pending", "approval"],
      ["mentioned", "mention"],
      ["comment_on_mine", "comment"],
      ["approved", "result"],
      ["rejected", "result"],
      ["returned", "result"],
      ["adjustment_approved", "result"],
      ["adjustment_rejected", "result"],
    ];
    for (const [kind, category] of kinds) {
      const p = payload(kind);
      const [item] = buildDispatchItems([{ uid: "uA", payload: p }]);
      expect(item).toEqual({
        uid: "uA",
        category,
        push: { title: p.title, body: p.body, actionTitle: p.actionTitle, url: `https://request.hpcore.vn${p.url}`, tag: p.tag },
      });
    }
  });

  it("bỏ người vừa thao tác; 1 người 2 lần → giữ thư đầu; thư 'test' không đi", () => {
    const items = buildDispatchItems(
      [
        { uid: "actor", payload: payload("approved") },
        { uid: "uA", payload: payload("mentioned") },
        { uid: "uA", payload: payload("comment_on_mine") },
        { uid: "uB", payload: { ...payload("approved"), kind: "test" } },
        { uid: "", payload: payload("approved") },
      ],
      "actor",
    );
    expect(items.map((i) => `${i.uid}:${i.category}`)).toEqual(["uA:mention"]);
  });

  it("onlyIfDisabled được chuyển nguyên sang App Tổng", () => {
    const [item] = buildDispatchItems([{ uid: "uA", payload: payload("comment_on_mine"), onlyIfDisabled: "mention" }]);
    expect(item).toMatchObject({ category: "comment", onlyIfDisabled: "mention" });
  });

  it("cắt vừa giới hạn (title 120 / body 240 / nút 30 / tag 80), giữ xuống dòng, không vỡ emoji", () => {
    expect(fitLength("ngắn", 10)).toBe("ngắn");
    const long = `${"😀".repeat(100)}\n${"a".repeat(300)}`;
    const cut = fitLength(long, 240);
    expect(cut.length).toBeLessThanOrEqual(240);
    expect(cut).not.toContain("�");
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).toContain("\n");
    const [item] = buildDispatchItems([
      { uid: "u", payload: { ...payload("approved"), title: "x".repeat(500), actionTitle: "y".repeat(50), tag: "t".repeat(200) } },
    ]);
    expect(item.push.title.length).toBeLessThanOrEqual(120);
    expect(item.push.actionTitle!.length).toBeLessThanOrEqual(30);
    expect(item.push.tag!.length).toBeLessThanOrEqual(80);
  });

  it("eventId cố định cho cùng sự kiện, khác khi khác sự kiện; ≤ 200, không có '/'", () => {
    const items = buildDispatchItems([{ uid: "uA", payload: payload("approved") }]);
    const a = buildEventId("approved:r1:2026-10-08T01:02:03.000Z", items);
    expect(buildEventId("approved:r1:2026-10-08T01:02:03.000Z", items)).toBe(a);
    expect(buildEventId("approved:r1:2026-10-08T09:09:09.000Z", items)).not.toBe(a);
    expect(a.startsWith("approved:r1:2026-10-08T01:02:03.000Z:")).toBe(true);
    const weird = buildEventId(`x/${"y".repeat(400)}`, items);
    expect(weird.length).toBeLessThanOrEqual(192);
    expect(weird).not.toContain("/");
  });

  it("chia lô ≤ 200 người, mã sự kiện thêm :c0, :c1", () => {
    const items = buildDispatchItems(Array.from({ length: 450 }, (_, i) => ({ uid: `u${i}`, payload: payload("approved") })));
    const one = chunkDispatch("ev", items.slice(0, 200));
    expect(one).toHaveLength(1);
    expect(one[0].eventId).toBe("ev");
    const many = chunkDispatch("ev", items);
    expect(many.map((b) => [b.eventId, b.items.length])).toEqual([
      ["ev:c0", 200],
      ["ev:c1", 200],
      ["ev:c2", 50],
    ]);
    expect(many.every((b) => b.appId === "de_xuat")).toBe(true);
  });
});

describe("gọi App Tổng + thử lại", () => {
  const body = { appId: "de_xuat" as const, eventId: "ev", items: [] };
  const config = { url: "https://account.hpcore.vn/api/push/dispatch", key: KEY };

  it("gửi POST kèm Bearer khoá, JSON, có hạn giờ", async () => {
    expect(await postDispatch(body, config, noSleep)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(config.url);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("duplicate cũng tính là xong, không thử lại", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 }));
    expect(await postDispatch(body, config, noSleep)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["5xx", () => new Response(null, { status: 503 })],
    ["429", () => new Response(null, { status: 429 })],
  ])("%s → đợi ~1,5 giây thử lại đúng 1 lần, cùng eventId", async (_label, bad) => {
    fetchMock.mockResolvedValueOnce(bad());
    const sleep = vi.fn(async () => {});
    expect(await postDispatch(body, config, { sleep })).toBe(true);
    expect(sleep).toHaveBeenCalledWith(DISPATCH_RETRY_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBodies().map((b) => b.eventId)).toEqual(["ev", "ev"]);
  });

  it("lỗi mạng 2 lần → bỏ qua sau 2 lượt, không ném lỗi, log không chứa khoá", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await postDispatch(body, config, noSleep)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const err = console.error as unknown as ReturnType<typeof vi.fn>;
    expect(JSON.stringify(err.mock.calls)).not.toContain(KEY);
  });

  it("4xx khác (401/400) → KHÔNG thử lại", async () => {
    for (const status of [400, 401, 403, 404]) {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(new Response(null, { status }));
      const sleep = vi.fn(async () => {});
      expect(await postDispatch(body, config, { sleep })).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it("nhiều lô gửi lần lượt, mỗi lô 1 lượt", async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ uid: `u${i}`, payload: payload("approved") }));
    await dispatchPushItems(items, { eventKey: "approved:r1:t" }, noSleep);
    const bodies = sentBodies();
    expect(bodies.map((b) => b.items.length)).toEqual([200, 1]);
    expect(bodies[0].eventId.endsWith(":c0")).toBe(true);
    expect(bodies[1].eventId.endsWith(":c1")).toBe(true);
  });

  it("không còn ai nhận (chỉ người thao tác) → không gọi mạng", async () => {
    await dispatchPushItems([{ uid: "actor", payload: payload("approved") }], { actorUid: "actor", eventKey: "e" }, noSleep);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("từ sự kiện nghiệp vụ tới gói gửi App Tổng (hpcore-notifications thật)", () => {
  function request(overrides: Partial<RequestInstance> = {}): RequestInstance {
    return {
      id: "r1",
      code: "000000001",
      groupId: "g1",
      groupNameSnapshot: "Nhóm test",
      fieldsSnapshot: [],
      values: {},
      submittedBy: { uid: "submitter", email: "s@hpcons.com.vn", name: "Người gửi" },
      submittedAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z",
      approvalFlow: "sequential",
      approversSnapshot: [],
      approvers: [{ id: "uA", decision: "pending" }],
      followers: [],
      history: [{ at: "2026-10-08T01:00:00.000Z", actor: "Người gửi", action: "Gửi đề xuất" }],
      comments: [],
      status: "pending",
      deletedAt: null,
      ...overrides,
    } as unknown as RequestInstance;
  }

  it("nhắc tên thắng: người gửi cũng bị nhắc → thư bình luận mang onlyIfDisabled 'mention'", async () => {
    const mentioned = ["submitter", "uC"];
    await Promise.all([
      hpcoreCommentOnMine(request(), "uA", "Người A", "@submitter xem", { actorUid: "uA", mentionedUids: mentioned, eventKey: "cmt1" }),
      hpcoreMentioned(request(), mentioned, "Người A", "@submitter xem", { actorUid: "uA", eventKey: "cmt1" }),
    ]);
    const items = sentBodies().flatMap((b) => b.items.map((i) => ({ ...i, eventId: b.eventId })));
    const submitter = items.filter((i) => i.uid === "submitter").map((i) => `${i.category}:${i.onlyIfDisabled ?? "-"}`).sort();
    expect(submitter).toEqual(["comment:mention", "mention:-"]);
    expect(items.find((i) => i.category === "mention")?.push.title).toBe("💬 Người A nhắc bạn trong bình luận");
    // Mã sự kiện dựa trên id bình luận, khác nhau giữa 2 loại.
    expect(new Set(items.map((i) => i.eventId.split(":").slice(0, 3).join(":")))).toEqual(
      new Set(["comment_on_mine:r1:cmt1", "mentioned:r1:cmt1"]),
    );
  });

  it("không gửi cho người vừa thao tác; nội dung y PR #96; mốc là dòng nhật ký cuối", async () => {
    await hpcorePendingApprovers(request({ approvers: [{ id: "uA", decision: "pending" }] } as Partial<RequestInstance>), { actorUid: "uA" });
    expect(fetchMock).not.toHaveBeenCalled();
    await hpcorePendingApprovers(request(), { actorUid: "submitter" });
    const [b] = sentBodies();
    expect(b.appId).toBe("de_xuat");
    expect(b.eventId.startsWith("pending_approval:r1:2026-10-08T01:00:00.000Z:")).toBe(true);
    expect(b.items).toEqual([
      {
        uid: "uA",
        category: "approval",
        push: {
          title: "⏳ Chờ bạn duyệt — Người gửi gửi",
          body: "#000001 · Nhóm test",
          actionTitle: "Mở để duyệt",
          url: "https://request.hpcore.vn/request/requests/r1",
          tag: "req-r1",
        },
      },
    ]);
  });

  it("trả lại: nút 'Sửa và gửi lại' trỏ thẳng màn sửa trên request.hpcore.vn", async () => {
    await hpcoreSubmitterReturned(request(), "Bổ sung hình ảnh", { actorUid: "uA", actorName: "Người A" });
    const [item] = sentBodies()[0].items;
    expect(item).toMatchObject({
      uid: "submitter",
      category: "result",
      push: {
        title: "↩️ Đề xuất bị trả lại để bổ sung",
        body: "Người A: “Bổ sung hình ảnh”\nNhóm test · #000001",
        actionTitle: "Sửa và gửi lại",
        url: "https://request.hpcore.vn/request/groups/g1/submit?draftId=r1",
      },
    });
  });
});
