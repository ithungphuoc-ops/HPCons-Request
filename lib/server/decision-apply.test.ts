import { describe, expect, it, vi } from "vitest";

// lib/server/requests.ts (recomputeDeadlineForNextStep) khai `import "server-only"`
// và kéo theo Firebase Admin — test chỉ gọi hàm thuần, mock rỗng.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({ adminDb: {} }));
vi.mock("@/lib/hpcore", () => ({ getHpcoreDb: vi.fn() }));

const { applyDecisionToRequest } = await import("./decision-apply");
import type { DecisionApplyInput, DecisionApplyResult } from "./decision-apply";
import type { ApprovalFlowType, RequestAttachment, RequestInstance } from "@/lib/types";

const NOW = "2026-10-06T03:00:00.000Z";
const Z = { id: "z", name: "Z", username: "z", avatarInitial: "Z" };

function makeRequest(flow: ApprovalFlowType, ids: string[], extra: Partial<RequestInstance> = {}): RequestInstance {
  return {
    id: "r1",
    groupId: "g1",
    status: "pending",
    approvalFlow: flow,
    approvers: ids.map((id) => ({ id, decision: "pending" as const })),
    approversSnapshot: ids.map((id) => ({ id, name: id.toUpperCase() })),
    history: [{ at: "2026-10-01T00:00:00.000Z", actor: "Người gửi", action: "Đã gửi đề xuất" }],
    attachments: [],
    deadlineAt: null,
    ...extra,
  } as unknown as RequestInstance;
}

function input(uid: string, decision: DecisionApplyInput["decision"], extra: Partial<DecisionApplyInput> = {}): DecisionApplyInput {
  return {
    decision,
    note: undefined,
    approvalTimeValue: undefined,
    actor: { uid, name: uid.toUpperCase() },
    group: { approvalTimeFields: [], approverSlaEnabled: undefined, slaByWorkCalendar: undefined, groupSlaHours: null },
    decisionAttachments: [],
    nowIso: NOW,
    ...extra,
  };
}

/**
 * Giả lập transaction lạc quan của Firestore: callback đọc bản hiện tại kèm
 * "phiên bản"; lúc commit nếu document đã bị ghi xen (phiên bản đổi) thì CHẠY
 * LẠI callback với bản mới — đúng cách adminDb.runTransaction xử lý tranh chấp.
 * `beforeCommit` cho phép chen 1 lượt ghi khác vào đúng giữa đọc và ghi.
 */
class FakeStore {
  version = 0;
  attempts = 0;
  constructor(public doc: RequestInstance) {}

  async runTransaction(
    fn: (snapshot: RequestInstance) => DecisionApplyResult,
    beforeCommit?: () => Promise<void>,
  ): Promise<DecisionApplyResult> {
    for (let i = 0; i < 5; i++) {
      this.attempts++;
      const readVersion = this.version;
      const snapshot = structuredClone(this.doc);
      const plan = fn(snapshot);
      if (!plan.ok) return plan; // huỷ, không ghi
      if (beforeCommit && i === 0) await beforeCommit();
      if (this.version !== readVersion) continue; // bị ghi xen → chạy lại
      this.doc = { ...this.doc, ...plan.patch };
      this.version++;
      return plan;
    }
    throw new Error("Hết số lần thử");
  }
}

describe("applyDecisionToRequest — từng nhánh", () => {
  it("approved ở luồng đồng thời: 1 người duyệt → vẫn pending, thêm 1 dòng lịch sử", () => {
    const r = applyDecisionToRequest(makeRequest("concurrent", ["a", "b"]), input("a", "approved"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effect).toBe("decision");
    expect(r.status).toBe("pending");
    expect(r.patch.approvers).toEqual([
      { id: "a", decision: "approved" },
      { id: "b", decision: "pending" },
    ]);
    expect(r.patch.history).toHaveLength(2);
    expect(r.patch.history?.[1]).toMatchObject({ actor: "A", action: "Đã chấp thuận", at: NOW });
    expect(r.patch.viewedAt).toEqual({ a: NOW });
  });

  it("sequential chưa tới lượt → 409, cùng thông báo cũ", () => {
    const r = applyDecisionToRequest(makeRequest("sequential", ["a", "b"]), input("b", "approved"));
    expect(r).toEqual({ ok: false, status: 409, error: "Người duyệt b chưa tới lượt hoặc đã xử lý đề xuất này." });
  });

  it("returned chưa tới lượt → 409 với thông báo riêng", () => {
    const r = applyDecisionToRequest(makeRequest("sequential", ["a", "b"]), input("b", "returned", { note: "x" }));
    expect(r).toEqual({ ok: false, status: 409, error: "Bạn chưa tới lượt hoặc đã xử lý đề xuất này." });
  });

  it("returned: reset mọi người duyệt về pending, status returned, không tác dụng phụ", () => {
    const req = makeRequest("sequential", ["a", "b"]);
    req.approvers[0].decision = "approved";
    const r = applyDecisionToRequest(req, input("b", "returned", { note: "thiếu chứng từ" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effect).toBe("none");
    expect(r.patch.status).toBe("returned");
    expect(r.patch.approvers?.every((a) => a.decision === "pending")).toBe(true);
    expect(r.patch.history?.at(-1)).toMatchObject({ action: "Đã trả lại", note: "thiếu chứng từ" });
  });

  it("approve_and_forward: chèn người nhận sau mình ở approvers + snapshot + stepMeta", () => {
    const req = makeRequest("sequential", ["a", "b"], { approverStepMeta: [{ code: "s1" }, { code: "s2" }] } as Partial<RequestInstance>);
    const r = applyDecisionToRequest(req, input("a", "approve_and_forward", { target: Z }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effect).toBe("forward");
    expect(r.patch.approvers?.map((a) => `${a.id}:${a.decision}`)).toEqual(["a:approved", "z:pending", "b:pending"]);
    expect(r.patch.approversSnapshot?.map((a) => a.id)).toEqual(["a", "z", "b"]);
    expect(r.patch.approverStepMeta).toEqual([{ code: "s1" }, {}, { code: "s2" }]);
    expect(r.patch.history?.at(-1)).toMatchObject({ action: "Đã chấp thuận và chuyển tiếp", target: "Z" });
  });

  it("forward_then_approve: chèn người nhận trước mình; thiếu target → 400; người nhận đã có → 409", () => {
    const req = makeRequest("sequential", ["a", "b"]);
    const r = applyDecisionToRequest(req, input("a", "forward_then_approve", { target: Z }));
    expect(r.ok && r.patch.approvers?.map((a) => a.id)).toEqual(["z", "a", "b"]);
    expect(applyDecisionToRequest(req, input("a", "forward_then_approve"))).toEqual({
      ok: false,
      status: 400,
      error: "Thiếu người nhận chuyển tiếp.",
    });
    const dup = applyDecisionToRequest(req, input("a", "forward_then_approve", { target: { ...Z, id: "b", name: "B" } }));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.status).toBe(409);
  });

  it("quyết định lạ → 400", () => {
    const r = applyDecisionToRequest(makeRequest("concurrent", ["a"]), input("a", "foo" as never));
    expect(r).toEqual({ ok: false, status: 400, error: "Quyết định không hợp lệ." });
  });

  it("field 'Mẫu form phê duyệt' bắt buộc theo bước → 400 khi thiếu, lưu vào approvalTimeValues khi có", () => {
    const req = makeRequest("sequential", ["a"], { approverStepMeta: [{ code: "s1" }] } as Partial<RequestInstance>);
    const group = {
      approvalTimeFields: [
        { id: "f1", approverStepCode: "s1", decisionAction: "approve", field: { name: "Số tiền", required: true } },
      ],
      approverSlaEnabled: undefined,
      slaByWorkCalendar: undefined,
      groupSlaHours: null,
    } as unknown as DecisionApplyInput["group"];
    expect(applyDecisionToRequest(req, input("a", "approved", { group }))).toEqual({
      ok: false,
      status: 400,
      error: 'Cần điền "Số tiền" trước khi tiếp tục.',
    });
    const r = applyDecisionToRequest(req, input("a", "approved", { group, approvalTimeValue: 5 }));
    expect(r.ok && r.patch.approvalTimeValues).toEqual({ f1: 5 });
    expect(r.ok && r.status).toBe("approved");
  });

  it("tệp đính kèm: ghi tên vào lịch sử + updated.attachments; trùng path với bản mới nhất → 400", () => {
    const att: RequestAttachment = { name: "bb.pdf", path: "requests/a/1-bb.pdf", size: 10, source: "decision" } as RequestAttachment;
    const req = makeRequest("concurrent", ["a"]);
    const r = applyDecisionToRequest(req, input("a", "approved", { decisionAttachments: [att] }));
    expect(r.ok && r.patch.history?.at(-1)?.attachmentNames).toEqual(["bb.pdf"]);
    expect(r.ok && r.updated.attachments).toEqual([att]);
    // patch KHÔNG chứa attachments — route nối bằng arrayUnion.
    expect(r.ok && "attachments" in r.patch).toBe(false);
    const dup = applyDecisionToRequest({ ...req, attachments: [att] }, input("a", "approved", { decisionAttachments: [att] }));
    expect(dup).toEqual({ ok: false, status: 400, error: 'Tệp "bb.pdf" đã có trong đề xuất.' });
  });

  it("không làm biến đổi ảnh chụp đầu vào (chạy lại an toàn)", () => {
    const req = makeRequest("concurrent", ["a", "b"]);
    const before = structuredClone(req);
    applyDecisionToRequest(req, input("a", "approved"));
    applyDecisionToRequest(req, input("a", "approve_and_forward", { target: Z }));
    expect(req).toEqual(before);
  });
});

describe("tranh chấp — transaction chạy lại", () => {
  it("2 người cùng duyệt song song (luồng đồng thời): giữ CẢ 2 lượt + 2 dòng lịch sử", async () => {
    const store = new FakeStore(makeRequest("concurrent", ["a", "b"]));
    // Lượt của A đọc xong thì B chen vào ghi trước → A phải chạy lại trên bản mới.
    const resultA = await store.runTransaction(
      (snap) => applyDecisionToRequest(snap, input("a", "approved")),
      async () => {
        const resultB = await store.runTransaction((snap) => applyDecisionToRequest(snap, input("b", "approved")));
        expect(resultB.ok && resultB.status).toBe("pending");
      },
    );
    expect(resultA.ok).toBe(true);
    expect(store.doc.approvers).toEqual([
      { id: "a", decision: "approved" },
      { id: "b", decision: "approved" },
    ]);
    expect(store.doc.status).toBe("approved");
    expect(store.doc.history.map((h) => h.actor)).toEqual(["Người gửi", "B", "A"]);
    // Lượt chạy lại thấy đủ 2 người duyệt → trạng thái cuối "approved" → route
    // gửi email + tạo việc đồng bộ đúng 1 lần theo kết quả này.
    expect(resultA.ok && resultA.status).toBe("approved");
  });

  it("đối chứng: đọc-rồi-ghi KHÔNG transaction thì mất 1 lượt (lỗi cũ)", () => {
    let doc = makeRequest("concurrent", ["a", "b"]);
    const snapA = structuredClone(doc);
    const snapB = structuredClone(doc);
    const a = applyDecisionToRequest(snapA, input("a", "approved"));
    const b = applyDecisionToRequest(snapB, input("b", "approved"));
    if (b.ok) doc = { ...doc, ...b.patch };
    if (a.ok) doc = { ...doc, ...a.patch };
    expect(doc.approvers.filter((x) => x.decision === "approved")).toHaveLength(1);
    expect(doc.history).toHaveLength(2);
  });

  it("thay tệp (ghi lịch sử) xen giữa lúc duyệt: dòng lịch sử thay tệp vẫn còn", async () => {
    const store = new FakeStore(makeRequest("sequential", ["a", "b"]));
    await store.runTransaction(
      (snap) => applyDecisionToRequest(snap, input("a", "approved")),
      async () => {
        store.doc = {
          ...store.doc,
          history: [...store.doc.history, { at: NOW, actor: "A", action: "Đã thay tệp đính kèm khi duyệt" }],
        };
        store.version++;
      },
    );
    expect(store.doc.history.map((h) => h.action)).toEqual([
      "Đã gửi đề xuất",
      "Đã thay tệp đính kèm khi duyệt",
      "Đã chấp thuận",
    ]);
    expect(store.attempts).toBe(2);
  });

  it("cùng 1 người bấm duyệt 2 lần song song: lượt sau chạy lại → 409, không ghi trùng", async () => {
    const store = new FakeStore(makeRequest("sequential", ["a", "b"]));
    let second: DecisionApplyResult | undefined;
    const first = await store.runTransaction(
      (snap) => applyDecisionToRequest(snap, input("a", "approved")),
      async () => {
        second = await store.runTransaction((snap) => applyDecisionToRequest(snap, input("a", "approved")));
      },
    );
    // Lượt "chen" ghi trước và thành công; lượt đầu chạy lại thấy a đã duyệt → 409.
    expect(second?.ok).toBe(true);
    expect(first).toEqual({ ok: false, status: 409, error: "Người duyệt a chưa tới lượt hoặc đã xử lý đề xuất này." });
    expect(store.doc.history.filter((h) => h.action === "Đã chấp thuận")).toHaveLength(1);
  });
});

describe("applyDecisionToRequest — đề xuất đã xoá mềm (06/10/2026)", () => {
  it("không duyệt / trả lại / chuyển tiếp được đề xuất đã xoá → 409", () => {
    const deleted = makeRequest("sequential", ["a", "b"], { deletedAt: "2026-10-06T02:00:00.000Z" });
    for (const d of ["approved", "rejected", "returned", "approve_and_forward"] as const) {
      expect(applyDecisionToRequest(deleted, input("a", d, { target: Z }))).toEqual({
        ok: false,
        status: 409,
        error: "Đề xuất đã bị xoá.",
      });
    }
  });

  it("bị xoá GIỮA lượt chạy thử và transaction → lượt trong transaction 409, không ghi", async () => {
    const store = new FakeStore(makeRequest("sequential", ["a", "b"]));
    const result = await store.runTransaction(
      (snap) => applyDecisionToRequest(snap, input("a", "approved")),
      async () => {
        store.doc = { ...store.doc, deletedAt: "2026-10-06T02:00:00.000Z" } as RequestInstance;
        store.version++;
      },
    );
    expect(result).toEqual({ ok: false, status: 409, error: "Đề xuất đã bị xoá." });
    expect(store.doc.approvers[0].decision).toBe("pending");
  });
});
