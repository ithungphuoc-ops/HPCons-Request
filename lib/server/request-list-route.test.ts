import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/requests (danh sách) — 08/10/2026: chỉ đọc đề xuất CÒN HIỆU LỰC ngay ở Firestore
 * (`deletedAt == null`) và `view=summary` chọn field gọn. Firestore giả lập ghi lại câu
 * truy vấn để kiểm, đồng thời tự áp `where`/`select` lên dữ liệu mẫu — kết quả lọc quyền
 * phải y như cách cũ (đọc cả kho rồi bỏ bản đã xoá bằng code).
 */

const { docs, queries } = vi.hoisted(() => ({
  docs: [] as { id: string; data: Record<string, unknown> }[],
  queries: [] as { where: [string, string, unknown][]; select: string[] | null }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: () => {} };
});
vi.mock("@/lib/dong-bo/hang-cho", () => ({ quetViecToiHan: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: async () => ({ uid: "me", name: "Tôi", role: "employee" }) }));
vi.mock("@/lib/hpcore", () => ({ getHpcoreDb: vi.fn() }));
vi.mock("@/lib/server/hpcore-org", () => ({ isUserInGroupScope: vi.fn() }));
vi.mock("@/lib/server/notification-emails", () => ({}));
vi.mock("@/lib/server/hpcore-notifications", () => ({}));
vi.mock("@/lib/server/notification-signal", () => ({ bumpNotificationSignal: vi.fn() }));
vi.mock("@/lib/server/notification-feed", () => ({ refreshNotificationFeedsForRequest: vi.fn() }));
vi.mock("@/lib/qlkctr-sync", () => ({ retryQlkCtrSyncNeuLoi: vi.fn() }));
vi.mock("@/lib/thumua-sync", () => ({ retryThuMuaSyncNeuLoi: vi.fn() }));
vi.mock("@/lib/server/requests", () => ({ canView: () => true }));
vi.mock("@/lib/firebase/admin", () => {
  const query = (where: [string, string, unknown][], select: string[] | null) => ({
    where: (f: string, op: string, v: unknown) => query([...where, [f, op, v]], select),
    select: (...fields: string[]) => query(where, fields),
    get: async () => {
      queries.push({ where, select });
      const hit = docs.filter((d) => where.every(([f, op, v]) => op === "==" && (d.data[f] ?? null) === v));
      return {
        docs: hit.map((d) => ({
          id: d.id,
          data: () => (select ? Object.fromEntries(Object.entries(d.data).filter(([k]) => select.includes(k))) : structuredClone(d.data)),
        })),
      };
    },
  });
  return { adminDb: { collection: () => query([], null) } };
});

const { GET } = await import("@/app/api/requests/route");

function req(id: string, over: Record<string, unknown>) {
  return {
    id,
    data: {
      code: id,
      status: "pending",
      groupId: null,
      groupNameSnapshot: "G",
      fieldsSnapshot: [],
      values: {},
      submittedBy: { uid: "khac", name: "Khác" },
      submittedAt: `2026-10-0${id.length}T00:00:00.000Z`,
      updatedAt: "2026-10-01T00:00:00.000Z",
      approvalFlow: "sequential",
      approversSnapshot: [],
      approvers: [],
      followers: [],
      deadlineAt: null,
      history: [{ at: "x", actor: "A", action: "Đã gửi đề xuất" }],
      comments: [{ id: "c", text: "nặng" }],
      attachments: [{ name: "a.pdf" }],
      viewedAt: { me: "x" },
      deletedAt: null,
      ...over,
    },
  };
}

const call = async (qs: string) => {
  const res = await GET(new Request(`http://x/api/requests?${qs}`));
  return (await res.json()) as { requests: Record<string, unknown>[] };
};

beforeEach(() => {
  docs.length = 0;
  queries.length = 0;
  docs.push(
    req("a", { submittedBy: { uid: "me", name: "Tôi" } }),
    req("bb", { approversSnapshot: [{ id: "me", name: "Tôi" }] }),
    req("ccc", { followers: [{ id: "me", name: "Tôi" }] }),
    req("dddd", { submittedBy: { uid: "me", name: "Tôi" }, deletedAt: "2026-10-05T00:00:00.000Z" }),
    req("eeeee", {}),
    req("ffffff", { followers: [{ id: "me", name: "Tôi" }], status: "draft" }),
  );
});

describe("GET /api/requests — danh sách đọc gọn", () => {
  it("scope=all: lọc bản đã xoá NGAY ở Firestore, kết quả quyền xem y như cũ", async () => {
    const { requests } = await call("scope=all");
    expect(queries).toEqual([{ where: [["deletedAt", "==", null]], select: null }]);
    expect(requests.map((r) => r.id)).toEqual(["ccc", "bb", "a"]);
    // Không có view=summary (trang /request/list) → vẫn đủ field cho khung chi tiết.
    expect(requests[0].history).toBeDefined();
    expect(requests[0].attachments).toBeDefined();
  });

  it("scope=all&view=summary (Trang chủ): cùng danh sách, nhưng chỉ chọn field gọn", async () => {
    const full = (await call("scope=all")).requests;
    queries.length = 0;
    const { requests } = await call("scope=all&view=summary");
    expect(queries[0].where).toEqual([["deletedAt", "==", null]]);
    expect(queries[0].select).toContain("fieldsSnapshot");
    expect(queries[0].select).not.toContain("history");
    expect(requests.map((r) => r.id)).toEqual(full.map((r) => r.id));
    expect(requests[0].history).toEqual([]);
    expect(requests[0].comments).toEqual([]);
    expect("attachments" in requests[0]).toBe(false);
    expect("viewedAt" in requests[0]).toBe(false);
  });

  it("sent-to-me / following: cùng tập như trước, không lẫn bản đã xoá hay nháp", async () => {
    expect((await call("scope=sent-to-me")).requests.map((r) => r.id)).toEqual(["bb"]);
    expect((await call("scope=following")).requests.map((r) => r.id)).toEqual(["ccc"]);
    expect(queries.every((q) => q.where.some(([f]) => f === "deletedAt"))).toBe(true);
  });
});
