// @vitest-environment node
/**
 * Test MỨC ROUTE cho "Điều chỉnh sau duyệt — tự chọn 2 người duyệt" (06/10/2026):
 * POST /api/requests/[id]/adjustment và POST .../adjustment/decision.
 * Firestore thay bằng kho giả trong bộ nhớ (runTransaction + arrayUnion) —
 * không đụng Firestore thật. Người dùng "đang hoạt động ở App Tổng" giả lập
 * qua `ACTIVE`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestInstance } from "@/lib/types";

type Doc = Record<string, unknown>;
const store = { doc: null as Doc | null, writes: 0 };
const session = { uid: "owner", name: "Chủ đề xuất", role: "employee" };
const ACTIVE: Record<string, string> = {
  rv1: "Người duyệt 1",
  rv2: "Người duyệt 2",
  rv3: "Người duyệt 3",
  owner: "Chủ đề xuất",
};

function applyPatch(patch: Record<string, unknown>) {
  const doc = store.doc!;
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && "__arrayUnion" in (v as object)) {
      const cur = Array.isArray(doc[k]) ? [...(doc[k] as unknown[])] : [];
      for (const item of (v as { __arrayUnion: unknown[] }).__arrayUnion) if (!cur.includes(item)) cur.push(item);
      doc[k] = cur;
    } else {
      doc[k] = v;
    }
  }
  store.writes++;
}
const snap = () => ({ exists: store.doc !== null, id: "r1", data: () => structuredClone(store.doc) });

vi.mock("server-only", () => ({}));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }) },
}));
vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({ doc: () => ({ get: async () => snap() }) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      let pending: Record<string, unknown> | null = null;
      const result = await fn({
        get: async () => snap(),
        update: (_r: unknown, p: Record<string, unknown>) => {
          pending = p;
        },
      });
      if (pending) applyPatch(pending);
      return result;
    },
  },
}));
vi.mock("@/lib/hpcore", () => ({ getHpcoreDb: vi.fn() }));
vi.mock("@/lib/session", () => {
  class AuthError extends Error {}
  class ForbiddenError extends Error {}
  return { AuthError, ForbiddenError, requireSession: async () => ({ ...session }) };
});
vi.mock("@/lib/http", () => ({
  apiErrorResponse: (e: Error) =>
    new Response(JSON.stringify({ error: e.message }), {
      status: e.constructor.name === "ForbiddenError" ? 403 : 500,
    }),
}));
vi.mock("@/lib/server/requests", () => ({
  loadRequest: async () => (store.doc ? ({ id: "r1", ...structuredClone(store.doc) } as unknown as RequestInstance) : null),
  collectAttachmentPaths: () => new Set<string>(),
}));
vi.mock("@/lib/server/hpcore-org", () => ({ getCachedDepartments: vi.fn(async () => []) }));
vi.mock("@/lib/server/adjustment-reviewers", () => ({
  loadActiveUsers: async (uids: string[]) =>
    new Map(uids.filter((u) => ACTIVE[u]).map((u) => [u, { uid: u, name: ACTIVE[u] }])),
  getAdjustmentGuideForGroup: async () => "HD",
  resolveAdjustmentSuggestions: async () => [],
}));
const notify = vi.fn(async () => {});
vi.mock("@/lib/server/notification-emails", () => ({ notifyAdjustmentApprovers: notify }));
const taoViec = vi.fn(async () => ["v1"]);
vi.mock("@/lib/dong-bo/hang-cho", () => ({ guiCacViec: vi.fn(), taoViecDongBo: taoViec }));
vi.mock("@/lib/server/verify-upload", () => ({
  verifyUploadedAttachment: async () => ({ ok: true, size: 321 }),
}));
vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: (fn: () => unknown) => void fn() };
});

const bump = vi.fn(async () => {});
vi.mock("@/lib/server/notification-feed", () => ({ refreshNotificationFeedsForRequest: bump }));

const { POST: postAdjustment } = await import("@/app/api/requests/[id]/adjustment/route");
const { POST: postDecision } = await import("@/app/api/requests/[id]/adjustment/decision/route");
const { POST: postCancel } = await import("@/app/api/requests/[id]/adjustment/cancel/route");

const params = { params: Promise.resolve({ id: "r1" }) };
const call = (h: typeof postAdjustment, body: unknown) =>
  h(new Request("http://x/api/requests/r1", { method: "POST", body: JSON.stringify(body) }), params);

function approved(extra: Doc = {}): Doc {
  return {
    groupId: null,
    code: "000001",
    status: "approved",
    submittedBy: { uid: "owner", name: "Chủ đề xuất" },
    groupNameSnapshot: "Đề xuất A",
    values: {},
    approversSnapshot: [{ id: "a", name: "A" }],
    approvers: [{ id: "a", decision: "approved" }],
    followers: [{ id: "fol", name: "Theo dõi" }],
    history: [{ at: "t0", actor: "A", action: "Đã chấp thuận" }],
    attachments: [],
    deletedAt: null,
    ...extra,
  };
}
const freshPath = (name: string) => `requests/owner/${Date.now()}-abcd1234-${name}`;

beforeEach(() => {
  store.doc = null;
  store.writes = 0;
  session.uid = "owner";
  session.name = "Chủ đề xuất";
  session.role = "employee";
  notify.mockClear();
  bump.mockClear();
  taoViec.mockClear();
});

describe("POST adjustment — bắt buộc chọn đúng 2 người duyệt", () => {
  it.each([
    ["0 người", []],
    ["1 người", ["rv1"]],
    ["3 người", ["rv1", "rv2", "rv3"]],
    ["trùng người", ["rv1", "rv1"]],
    ["có chính mình", ["rv1", "owner"]],
    ["thiếu hẳn", undefined],
  ])("%s → 400, không ghi gì", async (_label, approverIds) => {
    store.doc = approved();
    const res = await call(postAdjustment, { noiDung: "đổi 120 xuống 90", approverIds });
    expect(res.status).toBe(400);
    expect(store.writes).toBe(0);
    expect(store.doc.pendingAdjustment).toBeUndefined();
  });

  it("người không còn hoạt động ở App Tổng → 400", async () => {
    store.doc = approved();
    const res = await call(postAdjustment, { noiDung: "x", approverIds: ["rv1", "nghi-viec"] });
    expect(res.status).toBe(400);
    expect(store.writes).toBe(0);
  });

  it("rỗng cả ghi chú lẫn tệp → 400", async () => {
    store.doc = approved();
    const res = await call(postAdjustment, { noiDung: "  ", approverIds: ["rv1", "rv2"] });
    expect(res.status).toBe(400);
  });

  it("hợp lệ → tạo pendingAdjustment 2 người (tên lấy từ App Tổng), nhiều tệp, lưu reviewer uids, báo 2 người, CHƯA ghi history/báo Kho", async () => {
    store.doc = approved();
    const files = [
      { name: "a.pdf", path: freshPath("a.pdf"), size: 1 },
      { name: "b.xlsx", path: freshPath("b.xlsx"), size: 1 },
    ];
    const res = await call(postAdjustment, { noiDung: "đổi 120 xuống 90", approverIds: ["rv1", "rv2"], attachments: files });
    expect(res.status).toBe(200);
    const pa = store.doc.pendingAdjustment as NonNullable<RequestInstance["pendingAdjustment"]>;
    expect(pa.approvers).toEqual([
      { uid: "rv1", name: "Người duyệt 1", approvedAt: null },
      { uid: "rv2", name: "Người duyệt 2", approvedAt: null },
    ]);
    expect(pa.attachments?.map((f) => f.size)).toEqual([321, 321]);
    expect(pa.attachment).toBeNull();
    expect(store.doc.adjustmentReviewerUids).toEqual(["rv1", "rv2"]);
    expect((store.doc.history as unknown[]).length).toBe(1);
    expect(notify).toHaveBeenCalledWith(["rv1", "rv2"], expect.anything(), "Chủ đề xuất", expect.anything());
    expect(taoViec).not.toHaveBeenCalled();
  });

  it("đang có điều chỉnh chờ → 409", async () => {
    store.doc = approved({
      pendingAdjustment: { noiDung: "x", attachment: null, requestedByUid: "owner", requestedByName: "C", createdAt: "c0", approvers: [] },
    });
    const res = await call(postAdjustment, { noiDung: "y", approverIds: ["rv1", "rv2"] });
    expect(res.status).toBe(409);
  });

  it("người theo dõi khi nhóm KHÔNG cho phép (đề xuất trực tiếp) → 403", async () => {
    store.doc = approved();
    session.uid = "fol";
    const res = await call(postAdjustment, { noiDung: "y", approverIds: ["rv1", "rv2"] });
    expect(res.status).toBe(403);
  });
});

function pending(extra: object = {}) {
  return {
    noiDung: "đổi",
    attachment: null,
    attachments: [],
    requestedByUid: "owner",
    requestedByName: "Chủ đề xuất",
    createdAt: "c1",
    approvers: [
      { uid: "rv1", name: "Người duyệt 1", approvedAt: null },
      { uid: "rv2", name: "Người duyệt 2", approvedAt: null },
    ],
    ...extra,
  };
}

describe("POST adjustment/decision — chuyển tiếp", () => {
  it("thay ĐÚNG phần của người đang được giao, tên từ App Tổng, thêm reviewer uid, báo người nhận", async () => {
    store.doc = approved({ pendingAdjustment: pending(), adjustmentReviewerUids: ["rv1", "rv2"] });
    session.uid = "rv2";
    const res = await call(postDecision, { decision: "forward", expectedCreatedAt: "c1", target: { id: "rv3", name: "tên giả" } });
    expect(res.status).toBe(200);
    const pa = store.doc.pendingAdjustment as NonNullable<RequestInstance["pendingAdjustment"]>;
    expect(pa.approvers.map((a) => a.uid)).toEqual(["rv1", "rv3"]);
    expect(pa.approvers[1].name).toBe("Người duyệt 3");
    expect(store.doc.adjustmentReviewerUids).toEqual(["rv1", "rv2", "rv3"]);
    expect(notify).toHaveBeenCalledWith(["rv3"], expect.anything(), "Chủ đề xuất", expect.anything());
  });

  it("chặn chuyển cho người đề nghị điều chỉnh / người duyệt còn lại / người nghỉ việc", async () => {
    session.uid = "rv2";
    for (const target of ["owner", "rv1", "nghi-viec"]) {
      store.doc = approved({ pendingAdjustment: pending() });
      store.writes = 0;
      const res = await call(postDecision, { decision: "forward", expectedCreatedAt: "c1", target: { id: target, name: "x" } });
      expect(res.status).toBe(400);
      expect(store.writes).toBe(0);
    }
  });

  it("người được chuyển tới duyệt được (người cũ thì không còn quyền)", async () => {
    store.doc = approved({ pendingAdjustment: pending({ approvers: [
      { uid: "rv1", name: "Người duyệt 1", approvedAt: "x" },
      { uid: "rv3", name: "Người duyệt 3", approvedAt: null },
    ] }) });
    session.uid = "rv2";
    expect((await call(postDecision, { decision: "approved", expectedCreatedAt: "c1" })).status).toBe(403);
    session.uid = "rv3";
    expect((await call(postDecision, { decision: "approved", expectedCreatedAt: "c1" })).status).toBe(200);
    expect(store.doc.pendingAdjustment).toBeNull();
  });
});

describe("POST adjustment/decision — đủ 2 người mới có hiệu lực", () => {
  it("người 1 duyệt: chưa ghi; người 2 duyệt: ghi history + tệp (source adjustment) + báo Kho/Thu mua", async () => {
    const files = [
      { name: "a.pdf", path: "requests/owner/1-a.pdf", size: 5 },
      { name: "b.pdf", path: "requests/owner/2-b.pdf", size: 6 },
    ];
    store.doc = approved({ pendingAdjustment: pending({ attachments: files }) });
    session.uid = "rv1";
    expect((await call(postDecision, { decision: "approved", expectedCreatedAt: "c1" })).status).toBe(200);
    expect((store.doc.history as unknown[]).length).toBe(1);
    expect(taoViec).not.toHaveBeenCalled();
    session.uid = "rv2";
    expect((await call(postDecision, { decision: "approved", expectedCreatedAt: "c1" })).status).toBe(200);
    expect(store.doc.pendingAdjustment).toBeNull();
    const last = (store.doc.history as { action: string; attachmentNames?: string[] }[]).at(-1)!;
    expect(last.action).toBe("Điều chỉnh sau duyệt (lần 1)");
    expect(last.attachmentNames).toEqual(["a.pdf", "b.pdf"]);
    const atts = store.doc.attachments as { source?: string; addedByUid?: string }[];
    expect(atts).toHaveLength(2);
    expect(atts.every((a) => a.source === "adjustment" && a.addedByUid === "owner")).toBe(true);
    expect(taoViec).toHaveBeenCalledWith(
      expect.objectContaining({ loai: "dieu_chinh", taiLieu: [
        { name: "a.pdf", path: "requests/owner/1-a.pdf" },
        { name: "b.pdf", path: "requests/owner/2-b.pdf" },
      ] }),
    );
  });

  it("1 người từ chối → huỷ điều chỉnh, không ghi history", async () => {
    store.doc = approved({ pendingAdjustment: pending() });
    session.uid = "rv1";
    expect((await call(postDecision, { decision: "rejected", expectedCreatedAt: "c1" })).status).toBe(200);
    expect(store.doc.pendingAdjustment).toBeNull();
    expect((store.doc.history as unknown[]).length).toBe(1);
  });

  it("điều chỉnh CŨ (tạo theo nhánh phòng ban, 1 tệp `attachment`, 1 người duyệt) vẫn duyệt xong bình thường", async () => {
    store.doc = approved({
      pendingAdjustment: {
        noiDung: "cũ",
        attachment: { name: "cu.pdf", path: "requests/owner/9-cu.pdf", size: 9 },
        requestedByUid: "owner",
        requestedByName: "Chủ đề xuất",
        createdAt: "c-old",
        approvers: [{ uid: "leader", name: "Trưởng phòng", approvedAt: null }],
      },
    });
    session.uid = "leader";
    const res = await call(postDecision, { decision: "approved", expectedCreatedAt: "c-old" });
    expect(res.status).toBe(200);
    expect(store.doc.pendingAdjustment).toBeNull();
    const last = (store.doc.history as { note?: string; attachmentName?: string }[]).at(-1)!;
    expect(last.note).toBe("cũ");
    expect(last.attachmentName).toBe("cu.pdf");
    expect((store.doc.attachments as { path: string }[]).map((a) => a.path)).toEqual(["requests/owner/9-cu.pdf"]);
  });
});

describe("POST adjustment/cancel — huỷ điều chỉnh đang chờ", () => {
  it("người gửi điều chỉnh huỷ được: pending null + 1 dòng history (lý do + tóm tắt), không gộp tệp, không báo Kho, bump chuông, không email", async () => {
    const files = [{ name: "a.pdf", path: "requests/owner/1-a.pdf", size: 5 }];
    store.doc = approved({ pendingAdjustment: pending({ attachments: files }) });
    const res = await call(postCancel, { expectedCreatedAt: "c1", reason: "người duyệt nghỉ phép" });
    expect(res.status).toBe(200);
    expect(store.doc.pendingAdjustment).toBeNull();
    const history = store.doc.history as { action: string; actor: string; note?: string }[];
    expect(history).toHaveLength(2);
    const last = history.at(-1)!;
    expect(last.action).toBe("Đã huỷ điều chỉnh chờ duyệt");
    expect(last.actor).toBe("Chủ đề xuất");
    expect(last.note).toContain("Lý do: người duyệt nghỉ phép");
    expect(last.note).toContain("đổi");
    expect(last.note).toContain("a.pdf");
    expect(store.doc.attachments).toEqual([]);
    expect(taoViec).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(bump).toHaveBeenCalledWith("r1");
  });

  it("không có lý do vẫn huỷ được (note chỉ có tóm tắt)", async () => {
    store.doc = approved({ pendingAdjustment: pending() });
    expect((await call(postCancel, { expectedCreatedAt: "c1" })).status).toBe(200);
    const last = (store.doc.history as { note?: string }[]).at(-1)!;
    expect(last.note).not.toContain("Lý do");
  });

  it.each(["owner", "admin"])("vai trò %s (không phải người gửi) huỷ được", async (role) => {
    store.doc = approved({ pendingAdjustment: pending() });
    session.uid = "quan-tri";
    session.role = role;
    expect((await call(postCancel, { expectedCreatedAt: "c1" })).status).toBe(200);
    expect(store.doc.pendingAdjustment).toBeNull();
  });

  it.each([
    ["người duyệt điều chỉnh (không phải admin)", "rv1", "manager"],
    ["người khác", "nguoi-la", "employee"],
    ["người theo dõi", "fol", "employee"],
  ])("%s → 403, không ghi", async (_label, uid, role) => {
    store.doc = approved({ pendingAdjustment: pending() });
    session.uid = uid;
    session.role = role;
    expect((await call(postCancel, { expectedCreatedAt: "c1" })).status).toBe(403);
    expect(store.writes).toBe(0);
    expect(store.doc.pendingAdjustment).not.toBeNull();
  });

  it("điều chỉnh đã đổi (createdAt khác) → 409, không ghi", async () => {
    store.doc = approved({ pendingAdjustment: pending({ createdAt: "c2" }) });
    expect((await call(postCancel, { expectedCreatedAt: "c1" })).status).toBe(409);
    expect(store.writes).toBe(0);
  });

  it("không còn điều chỉnh chờ → 409", async () => {
    store.doc = approved();
    expect((await call(postCancel, { expectedCreatedAt: "c1" })).status).toBe(409);
  });

  it("đề xuất đã xoá → 409", async () => {
    store.doc = approved({ pendingAdjustment: pending(), deletedAt: "2026-10-06T00:00:00.000Z" });
    expect((await call(postCancel, { expectedCreatedAt: "c1" })).status).toBe(409);
    expect(store.writes).toBe(0);
  });

  it("thiếu expectedCreatedAt → 400; lý do quá dài → 400", async () => {
    store.doc = approved({ pendingAdjustment: pending() });
    expect((await call(postCancel, {})).status).toBe(400);
    expect((await call(postCancel, { expectedCreatedAt: "c1", reason: "x".repeat(501) })).status).toBe(400);
    expect(store.writes).toBe(0);
  });

  it("sau khi huỷ, người gửi gửi được điều chỉnh mới", async () => {
    store.doc = approved({ pendingAdjustment: pending() });
    expect((await call(postCancel, { expectedCreatedAt: "c1" })).status).toBe(200);
    const res = await call(postAdjustment, { noiDung: "điều chỉnh mới", approverIds: ["rv1", "rv3"] });
    expect(res.status).toBe(200);
    const pa = store.doc.pendingAdjustment as NonNullable<RequestInstance["pendingAdjustment"]>;
    expect(pa.noiDung).toBe("điều chỉnh mới");
  });
});
