import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chuông "cấp 2" — phần máy chủ: tính lại cho ĐÚNG người bị ảnh hưởng, chỉ người đã có
 * tài liệu, không ghi khi không đổi, không để bản tính cũ đè bản mới. Firestore giả lập
 * trong bộ nhớ (chỉ đủ các lệnh lib/server/notification-feed.ts dùng).
 */

const { store, readTime, resolveManager, getSettings, expandMentions } = vi.hoisted(() => ({
  store: { requests: new Map<string, Record<string, unknown>>(), feeds: new Map<string, Record<string, unknown>>(), groups: new Map<string, Record<string, unknown>>(), writes: [] as string[] },
  readTime: { ms: 1_000 },
  resolveManager: vi.fn(async (): Promise<string | null> => null),
  getSettings: vi.fn(async () => ({ approver_pending: true, own_decided: true, mentioned: true, following: true, manager_bypassed: true, approver_followup: true })),
  expandMentions: vi.fn(async (): Promise<string[]> => []),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/mentions", () => ({ expandMentionsToUids: expandMentions }));
vi.mock("@/lib/server/notificationSettings", () => ({ getNotificationSettings: getSettings }));
vi.mock("@/lib/server/requests", () => ({
  resolveDirectManagerId: resolveManager,
  toProposalGroup: (id: string, data: Record<string, unknown>) => ({ id, ...data }),
}));
vi.mock("@/lib/firebase/admin", () => {
  const snap = (id: string, data: Record<string, unknown> | undefined) => ({
    id,
    exists: data !== undefined,
    data: () => (data === undefined ? undefined : structuredClone(data)),
  });
  const mapOf = (name: string) =>
    name === "requests" ? store.requests : name === "groups" ? store.groups : name === "notification-feed" ? store.feeds : new Map();
  const docRef = (name: string, id: string) => ({
    __col: name,
    id,
    get: async () => snap(id, mapOf(name).get(id)),
  });
  const collection = (name: string) => ({
    doc: (id: string) => docRef(name, id),
    where: (field: string, op: string, value: unknown) => {
      const run = () =>
        [...mapOf(name).entries()].filter(([, d]) =>
          op === "array-contains" ? ((d[field] as unknown[]) ?? []).includes(value) : (d[field] ?? null) === value,
        );
      const q = {
        select: () => q,
        get: async () => ({
          docs: run().map(([id, d]) => snap(id, d)),
          readTime: { toMillis: () => readTime.ms },
        }),
      };
      return q;
    },
  });
  return {
    adminDb: {
      collection,
      getAll: async (...refs: { __col: string; id: string }[]) => refs.map((r) => snap(r.id, mapOf(r.__col).get(r.id))),
      runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>) =>
        fn({
          get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
          set: (ref: { __col: string; id: string }, data: Record<string, unknown>) => {
            store.writes.push(ref.id);
            mapOf(ref.__col).set(ref.id, structuredClone(data));
          },
        }),
    },
  };
});

import {
  affectedUidsForRequest,
  computeAndStoreFeedForSession,
  refreshFeedAfterView,
  refreshNotificationFeedsForRequest,
} from "./notification-feed";
import { NOTIFICATION_FEED_VERSION } from "@/lib/notification-feed";

const SETTINGS = { approver_pending: true, own_decided: true, mentioned: true, following: true, manager_bypassed: true, approver_followup: true };
const iso = (min: number) => new Date(Date.parse("2026-10-08T03:00:00.000Z") + min * 60_000).toISOString();

function request(id: string, over: Record<string, unknown> = {}) {
  return {
    code: `C${id}`,
    groupId: null,
    groupNameSnapshot: "Phiếu",
    fieldsSnapshot: [],
    values: {},
    submittedBy: { uid: "nguoi-gui", name: "Người Gửi" },
    submittedAt: iso(0),
    updatedAt: iso(0),
    approvalFlow: "sequential",
    approversSnapshot: [{ id: "duyet" }],
    approvers: [{ id: "duyet", decision: "pending" }],
    followers: [{ id: "theo-doi", name: "Theo Dõi" }],
    status: "pending",
    deadlineAt: null,
    history: [{ at: iso(0), actor: "Người Gửi", action: "Đã gửi đề xuất" }],
    comments: [],
    deletedAt: null,
    ...over,
  };
}

function storedFeed(uid: string, name: string, over: Record<string, unknown> = {}) {
  return {
    v: NOTIFICATION_FEED_VERSION,
    uid,
    name,
    settings: SETTINGS,
    entries: [],
    badge: 0,
    mustCount: 0,
    requestIds: [],
    basedOn: 0,
    updatedAt: iso(0),
    ...over,
  };
}

beforeEach(() => {
  store.requests.clear();
  store.feeds.clear();
  store.groups.clear();
  store.writes.length = 0;
  readTime.ms = 1_000;
  resolveManager.mockReset().mockResolvedValue(null);
  getSettings.mockClear();
});

describe("affectedUidsForRequest", () => {
  it("vai trò trên đề xuất ∪ người ĐANG có dòng của đề xuất (để gỡ)", async () => {
    store.requests.set("r1", request("r1"));
    store.feeds.set("cu", storedFeed("cu", "Người Cũ", { requestIds: ["r1"] }));
    store.feeds.set("khac", storedFeed("khac", "Khác", { requestIds: ["r2"] }));
    expect(new Set(await affectedUidsForRequest("r1"))).toEqual(new Set(["nguoi-gui", "duyet", "theo-doi", "cu"]));
  });

  it("đề xuất đã xoá: chỉ những ai đang có dòng của nó", async () => {
    store.requests.set("r1", request("r1", { deletedAt: iso(5) }));
    store.feeds.set("duyet", storedFeed("duyet", "Duyệt", { requestIds: ["r1"] }));
    expect(await affectedUidsForRequest("r1")).toEqual(["duyet"]);
  });

  it("nhóm bật báo quản lý trực tiếp → thêm quản lý của người gửi", async () => {
    store.requests.set("r1", request("r1", { groupId: "g1" }));
    store.groups.set("g1", { notifyManager: true, approverSteps: [{ kind: "submitter_manager" }] });
    resolveManager.mockResolvedValue("quan-ly");
    expect(await affectedUidsForRequest("r1")).toContain("quan-ly");
  });
});

describe("refreshNotificationFeedsForRequest", () => {
  it("chỉ tính lại cho người ĐÃ có tài liệu, dùng tên + cài đặt lưu sẵn (không đọc App Tổng)", async () => {
    store.requests.set("r1", request("r1"));
    store.feeds.set("duyet", storedFeed("duyet", "Người Duyệt"));
    await refreshNotificationFeedsForRequest("r1");
    expect(store.writes).toEqual(["duyet"]);
    expect(getSettings).not.toHaveBeenCalled();
    const doc = store.feeds.get("duyet")!;
    expect(doc.mustCount).toBe(1);
    expect(doc.requestIds).toEqual(["r1"]);
    expect(doc.basedOn).toBe(1_000);
    expect(store.feeds.has("nguoi-gui")).toBe(false);
  });

  it("danh sách không đổi → không ghi (đỡ lượt ghi + lượt đọc ở trình duyệt)", async () => {
    store.requests.set("r1", request("r1"));
    store.feeds.set("duyet", storedFeed("duyet", "Người Duyệt"));
    await refreshNotificationFeedsForRequest("r1");
    expect(store.writes).toEqual(["duyet"]);
    readTime.ms = 2_000;
    await refreshNotificationFeedsForRequest("r1");
    expect(store.writes).toEqual(["duyet"]);
  });

  it("bị bỏ khỏi đề xuất → dòng bị gỡ khỏi chuông", async () => {
    store.requests.set("r1", request("r1"));
    store.feeds.set("theo-doi", storedFeed("theo-doi", "Theo Dõi"));
    await refreshNotificationFeedsForRequest("r1");
    expect(store.feeds.get("theo-doi")!.requestIds).toEqual(["r1"]);
    store.requests.set("r1", request("r1", { followers: [] }));
    readTime.ms = 2_000;
    await refreshNotificationFeedsForRequest("r1");
    expect(store.feeds.get("theo-doi")!.requestIds).toEqual([]);
  });

  it("bản đang lưu tính từ dữ liệu MỚI HƠN → không đè", async () => {
    store.requests.set("r1", request("r1"));
    store.feeds.set("duyet", storedFeed("duyet", "Người Duyệt", { basedOn: 5_000 }));
    await refreshNotificationFeedsForRequest("r1");
    expect(store.writes).toEqual([]);
  });

  it("tài liệu bản cũ (khác phiên bản) → bỏ qua, chờ GET tính lại", async () => {
    store.requests.set("r1", request("r1"));
    store.feeds.set("duyet", storedFeed("duyet", "Người Duyệt", { v: 0 }));
    await refreshNotificationFeedsForRequest("r1");
    expect(store.writes).toEqual([]);
  });

  it("lỗi không ném ra ngoài (không làm hỏng thao tác chính)", async () => {
    resolveManager.mockRejectedValue(new Error("boom"));
    store.requests.set("r1", request("r1", { groupId: "g1" }));
    store.groups.set("g1", { notifyManager: true, approverSteps: [{ kind: "submitter_manager" }] });
    await expect(refreshNotificationFeedsForRequest("r1")).resolves.toBeUndefined();
  });
});

describe("computeAndStoreFeedForSession (GET /api/notifications)", () => {
  it("chưa có tài liệu → tính + ghi kèm tên/cài đặt; luôn ghi để làm mới updatedAt", async () => {
    store.requests.set("r1", request("r1"));
    const feed = await computeAndStoreFeedForSession({ uid: "duyet", name: "Người Duyệt" });
    expect(feed.mustCount).toBe(1);
    expect(store.feeds.get("duyet")).toMatchObject({ uid: "duyet", name: "Người Duyệt", settings: SETTINGS, v: NOTIFICATION_FEED_VERSION });
    await computeAndStoreFeedForSession({ uid: "duyet", name: "Người Duyệt" });
    expect(store.writes).toEqual(["duyet", "duyet"]);
  });
});

describe("refreshFeedAfterView", () => {
  it("chỉ tính lại khi đề xuất vừa xem đang là dòng CHƯA ĐỌC của chính người xem", async () => {
    store.requests.set("r1", request("r1", { comments: [{ id: "c1", authorUid: "x", authorName: "X", text: "hi", at: iso(5) }] }));
    store.feeds.set("theo-doi", storedFeed("theo-doi", "Theo Dõi"));
    await refreshNotificationFeedsForRequest("r1");
    const entry = (store.feeds.get("theo-doi")!.entries as { unread: boolean }[])[0];
    expect(entry.unread).toBe(true);
    store.writes.length = 0;

    await refreshFeedAfterView("theo-doi", "khong-co");
    expect(store.writes).toEqual([]);

    (store.requests.get("r1")!.viewedAt as unknown) = { "theo-doi": iso(10) };
    readTime.ms = 3_000;
    await refreshFeedAfterView("theo-doi", "r1");
    expect(store.writes).toEqual(["theo-doi"]);
    expect((store.feeds.get("theo-doi")!.entries as { unread: boolean }[])[0].unread).toBe(false);
  });
});
