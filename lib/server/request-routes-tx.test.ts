// @vitest-environment node
/**
 * Test MỨC ROUTE (06/10/2026, làm tiếp sau PR #82) cho 3 route ghi vào đề
 * xuất: PATCH /api/requests/[id] (sửa/gửi lại), POST attachments, POST
 * table-supplement. Firestore được thay bằng 1 kho giả trong bộ nhớ: có
 * runTransaction (tx.get/tx.update) + FieldValue.arrayUnion (nối, bỏ phần tử
 * trùng y hệt) — không đụng Firestore thật.
 *
 * `store.beforeTx` cho chen 1 lượt ghi khác vào đúng giữa "đọc lúc đầu
 * request" và "transaction" — mô phỏng người duyệt bấm duyệt / hàng chờ ghi
 * dòng đồng bộ / xoá đề xuất xen giữa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestInstance } from "@/lib/types";

type Doc = Record<string, unknown>;
interface Union {
  __arrayUnion: unknown[];
}

const store = {
  doc: null as Doc | null,
  beforeTx: null as null | (() => void),
  writes: 0,
};

function applyPatch(patch: Record<string, unknown>) {
  const doc = store.doc!;
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === "object" && "__arrayUnion" in (v as object)) {
      const cur = Array.isArray(doc[k]) ? [...(doc[k] as unknown[])] : [];
      for (const item of (v as Union).__arrayUnion) {
        if (!cur.some((c) => JSON.stringify(c) === JSON.stringify(item))) cur.push(item);
      }
      doc[k] = cur;
    } else {
      doc[k] = v;
    }
  }
  store.writes++;
}

function snap() {
  return {
    exists: store.doc !== null,
    id: "r1",
    data: () => structuredClone(store.doc),
  };
}

vi.mock("server-only", () => ({}));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { arrayUnion: (...items: unknown[]) => ({ __arrayUnion: items }) },
}));
vi.mock("@/lib/firebase/admin", () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        get: async () => snap(),
        update: async (p: Record<string, unknown>) => applyPatch(p),
      }),
    }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      if (store.beforeTx) {
        const hook = store.beforeTx;
        store.beforeTx = null;
        hook();
      }
      let pending: Record<string, unknown> | null = null;
      const tx = {
        get: async () => snap(),
        update: (_ref: unknown, p: Record<string, unknown>) => {
          pending = p;
        },
      };
      const result = await fn(tx);
      if (pending) applyPatch(pending);
      return result;
    },
  },
}));
vi.mock("@/lib/hpcore", () => ({ getHpcoreDb: vi.fn() }));
vi.mock("@/lib/session", async () => {
  class AuthError extends Error {}
  class ForbiddenError extends Error {}
  return {
    AuthError,
    ForbiddenError,
    requireSession: async () => ({ uid: "owner", name: "Chủ đề xuất", role: "employee" }),
  };
});
vi.mock("@/lib/server/requests", () => ({
  loadRequest: async () => (store.doc ? ({ id: "r1", ...structuredClone(store.doc) } as unknown as RequestInstance) : null),
  canView: () => true,
  collectAttachmentPaths: () => new Set<string>(),
  buildInitialApprovers: (users: { id: string }[]) => users.map((u) => ({ id: u.id, decision: "pending" })),
  generateRequestCode: async () => "000001",
  generateGroupRequestCode: async () => "000001",
  computeDeadline: () => null,
  findBlockedDateLeadTimeFields: () => [],
  findInvalidExternalCodeFields: async () => [],
  findInvalidTableRows: () => [],
  findMissingRequiredFields: () => [],
  resolveApproverStepsWithMeta: vi.fn(),
  resolveInitialSlaHours: () => null,
  toProposalGroup: vi.fn(),
}));
vi.mock("@/lib/server/hpcore-org", () => ({ isUserInGroupScope: vi.fn(), OUT_OF_SCOPE_MESSAGE: "" }));
vi.mock("@/lib/server/adjustment-approval-rules", () => ({
  loadAdjustmentApprovalRules: vi.fn(),
  resolveAdjustmentPlanForActor: vi.fn(),
}));
vi.mock("@/lib/dong-bo/hang-cho", () => ({
  guiCacViec: vi.fn(),
  quetViecToiHan: vi.fn(),
  taoViecDongBo: vi.fn(async () => []),
}));
vi.mock("@/lib/qlkctr-sync", () => ({ retryQlkCtrSyncNeuLoi: vi.fn() }));
vi.mock("@/lib/thumua-sync", () => ({ retryThuMuaSyncNeuLoi: vi.fn() }));
vi.mock("@/lib/r2", () => ({ createSignedReadUrl: vi.fn() }));
vi.mock("@/lib/server/verify-upload", () => ({
  verifyUploadedAttachment: async () => ({ ok: true, size: 123 }),
}));
vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: vi.fn() };
});

const { PATCH } = await import("@/app/api/requests/[id]/route");
const { POST: addAttachment } = await import("@/app/api/requests/[id]/attachments/route");
const { POST: tableSupplement } = await import("@/app/api/requests/[id]/table-supplement/route");
const { requestVersionKey } = await import("@/lib/request-version");

const SENT = { at: "2026-10-05T01:00:00.000Z", actor: "Chủ đề xuất", action: "Đã gửi đề xuất" };
const params = { params: Promise.resolve({ id: "r1" }) };

function call(handler: (r: Request, p: typeof params) => Promise<Response>, body: unknown, method = "POST") {
  return handler(
    new Request("http://localhost/api/requests/r1", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params,
  );
}

/** Đề xuất trực tiếp (groupId null) đang chờ duyệt, 2 người duyệt. */
function pendingDirect(extra: Doc = {}): Doc {
  return {
    groupId: null,
    code: "000001",
    status: "pending",
    submittedBy: { uid: "owner", name: "Chủ đề xuất" },
    groupNameSnapshot: "Đề xuất A",
    values: { description: "cũ" },
    approversSnapshot: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    approvers: [
      { id: "a", decision: "pending" },
      { id: "b", decision: "pending" },
    ],
    approvalFlow: "concurrent",
    followers: [],
    history: [SENT],
    attachments: [],
    updatedAt: "2026-10-05T01:00:00.000Z",
    deletedAt: null,
    ...extra,
  };
}

beforeEach(() => {
  store.doc = null;
  store.beforeTx = null;
  store.writes = 0;
});

describe("PATCH /api/requests/[id] — sửa & gửi lại", () => {
  it("người duyệt vừa duyệt GIỮA lúc đọc và ghi → 409, giữ nguyên lượt duyệt, không ghi gì", async () => {
    store.doc = pendingDirect();
    store.beforeTx = () => {
      (store.doc!.approvers as { id: string; decision: string }[])[0].decision = "approved";
      (store.doc!.history as unknown[]).push({ at: "2026-10-06T01:00:00.000Z", actor: "A", action: "Đã chấp thuận" });
    };
    const res = await call(PATCH, { description: "mới", isDraft: false }, "PATCH");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Đề xuất vừa có thay đổi, vui lòng tải lại trang rồi thử lại.");
    expect(store.writes).toBe(0);
    expect((store.doc!.approvers as { decision: string }[])[0].decision).toBe("approved");
    expect(store.doc!.history).toHaveLength(2);
    expect((store.doc!.values as Doc).description).toBe("cũ");
  });

  it("mở form TỪ TRƯỚC khi người duyệt duyệt (expectedVersion cũ) → 409 ngay, không ghi", async () => {
    const openedVersion = requestVersionKey(pendingDirect() as unknown as RequestInstance);
    store.doc = pendingDirect({
      approvers: [
        { id: "a", decision: "approved" },
        { id: "b", decision: "pending" },
      ],
    });
    const res = await call(PATCH, { description: "mới", isDraft: false, expectedVersion: openedVersion }, "PATCH");
    expect(res.status).toBe(409);
    expect(store.writes).toBe(0);
    expect((store.doc!.approvers as { decision: string }[])[0].decision).toBe("approved");
  });

  it("đã bị trả lại sau khi mở form (expectedVersion lúc pending) → 409 thay vì 403/ghi đè", async () => {
    const openedVersion = requestVersionKey(pendingDirect() as unknown as RequestInstance);
    store.doc = pendingDirect({ status: "returned" });
    const res = await call(PATCH, { description: "mới", isDraft: false, expectedVersion: openedVersion }, "PATCH");
    expect(res.status).toBe(409);
    expect(store.writes).toBe(0);
  });

  it("bị xoá mềm xen giữa → 409 'Đề xuất đã bị xoá.'", async () => {
    store.doc = pendingDirect();
    store.beforeTx = () => {
      store.doc!.deletedAt = "2026-10-06T01:00:00.000Z";
    };
    const res = await call(PATCH, { description: "mới", isDraft: false }, "PATCH");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Đề xuất đã bị xoá.");
    expect(store.writes).toBe(0);
  });

  it("không ai đổi gì (chỉ có dòng 'Đã đồng bộ' + bình luận xen giữa) → gửi lại OK, NỐI lịch sử, không mất dòng xen giữa", async () => {
    store.doc = pendingDirect();
    const opened = requestVersionKey(pendingDirect() as unknown as RequestInstance);
    const syncLine = { at: "2026-10-06T01:00:00.000Z", actor: "Hệ thống", action: "Đã đồng bộ" };
    store.beforeTx = () => {
      (store.doc!.history as unknown[]).push(syncLine);
      store.doc!.updatedAt = "2026-10-06T01:00:01.000Z"; // bình luận cũng đổi updatedAt
    };
    const res = await call(PATCH, { description: "mới", isDraft: false, expectedVersion: opened }, "PATCH");
    expect(res.status).toBe(200);
    const history = store.doc!.history as { action: string }[];
    expect(history.map((h) => h.action)).toEqual(["Đã gửi đề xuất", "Đã đồng bộ", "Đã gửi đề xuất"]);
    expect((store.doc!.values as Doc).description).toBe("mới");
    const json = (await res.json()) as { request: RequestInstance };
    expect(json.request.history).toHaveLength(3);
    expect(json.request.status).toBe("pending");
  });
});

describe("POST attachments — bổ sung tài liệu", () => {
  it("đề xuất đã duyệt: nối tệp + dòng lịch sử bằng arrayUnion, không mất dòng ghi xen giữa, đếm 'lần N' trên bản mới nhất", async () => {
    store.doc = pendingDirect({
      status: "approved",
      history: [SENT, { at: "2026-10-05T02:00:00.000Z", actor: "Chủ đề xuất", action: "Đính kèm tài liệu sau duyệt (lần 1): x.pdf" }],
    });
    store.beforeTx = () => {
      (store.doc!.history as unknown[]).push({
        at: "2026-10-06T01:00:00.000Z",
        actor: "Chủ đề xuất",
        action: "Đính kèm tài liệu sau duyệt (lần 2): y.pdf",
      });
    };
    const res = await call(addAttachment, { attachment: { name: "z.pdf", path: "uploads/owner/1-z.pdf", size: 1 } });
    expect(res.status).toBe(200);
    const history = store.doc!.history as { action: string }[];
    expect(history).toHaveLength(4);
    expect(history[3].action).toMatch(/\(lần 3\): z\.pdf$/);
    expect(store.doc!.attachments).toEqual([{ name: "z.pdf", path: "uploads/owner/1-z.pdf", size: 123 }]);
    const json = (await res.json()) as { history: unknown[]; attachments: unknown[] };
    expect(json.history).toHaveLength(4);
    expect(json.attachments).toHaveLength(1);
  });

  it("đề xuất đã xoá → 409, không ghi", async () => {
    store.doc = pendingDirect({ status: "approved", deletedAt: "2026-10-06T00:00:00.000Z" });
    const res = await call(addAttachment, { attachment: { name: "z.pdf", path: "uploads/owner/1-z.pdf", size: 1 } });
    expect(res.status).toBe(409);
    expect(store.writes).toBe(0);
  });

  it("bị xoá xen giữa (sau khi đo R2, trước transaction) → 409, không ghi", async () => {
    store.doc = pendingDirect({ status: "approved" });
    store.beforeTx = () => {
      store.doc!.deletedAt = "2026-10-06T01:00:00.000Z";
    };
    const res = await call(addAttachment, { attachment: { name: "z.pdf", path: "uploads/owner/1-z.pdf", size: 1 } });
    expect(res.status).toBe(409);
    expect(store.writes).toBe(0);
  });
});

describe("POST table-supplement — nối dòng bảng sau duyệt", () => {
  function approvedWithTable(extra: Doc = {}): Doc {
    return pendingDirect({
      status: "approved",
      fieldsSnapshot: [{ id: "f1", name: "Vật tư", dataType: "table", tableColumns: ["Tên", "SL"] }],
      values: { f1: [{ c: ["Thép", "1"] }] },
      ...extra,
    });
  }

  it("nối dòng + NỐI lịch sử, không mất dòng hàng chờ ghi xen giữa", async () => {
    store.doc = approvedWithTable();
    store.beforeTx = () => {
      (store.doc!.history as unknown[]).push({ at: "2026-10-06T01:00:00.000Z", actor: "Hệ thống", action: "Đã đồng bộ" });
    };
    const res = await call(tableSupplement, { fieldId: "f1", newRows: [["Xi măng", "2"]] });
    expect(res.status).toBe(200);
    const history = store.doc!.history as { action: string }[];
    expect(history.map((h) => h.action.slice(0, 11))).toEqual(["Đã gửi đề x", "Đã đồng bộ", "Bổ sung dữ "]);
    const json = (await res.json()) as { request: RequestInstance };
    expect(json.request.history).toHaveLength(3);
  });

  it("đã xoá → 409", async () => {
    store.doc = approvedWithTable({ deletedAt: "2026-10-06T00:00:00.000Z" });
    const res = await call(tableSupplement, { fieldId: "f1", newRows: [["Xi măng", "2"]] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Đề xuất đã bị xoá.");
    expect(store.writes).toBe(0);
  });
});
