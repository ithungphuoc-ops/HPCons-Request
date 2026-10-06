import { describe, expect, it } from "vitest";
import { buildApproverProgress, HISTORY_ACTION } from "@/lib/approver-progress";
import { extractApproverOpinions } from "@/lib/approver-opinions";
import { canEditDecisionAttachment, uploaderUidOf } from "@/lib/decision-attachment-edit";
import {
  DECISION_ATTACHMENT_REMOVED_ACTION,
  DECISION_ATTACHMENT_REPLACED_ACTION,
} from "@/lib/request-history-labels";
import { parseDecisionAttachmentEditBody, planDecisionAttachmentEdit } from "./decision-attachment-edit";
import type { RequestAttachment, RequestInstance, TaggedUser } from "@/lib/types";

const NOW_MS = Date.UTC(2026, 9, 6, 7, 0, 0);
const NOW = new Date(NOW_MS).toISOString();
const AT = "2026-10-06T06:54:00.000Z";
const PHUONG: TaggedUser = { id: "phuong", name: "Hồ Hữu Phương", username: "phuong", avatarInitial: "H" };
const THI: TaggedUser = { id: "thi", name: "Hồ Văn Thi", username: "thi", avatarInitial: "H" };

const dec = (name: string, path: string): RequestAttachment => ({
  name,
  path,
  size: 10,
  source: "decision",
  addedBy: PHUONG.name,
  addedAt: AT,
});
const SAI = dec("Bang KL SAI.xlsx", "requests/phuong/1759700000000-Bang_KL_SAI.xlsx");
const ANH = dec("Anh.jpg", "requests/phuong/1759700000001-Anh.jpg");
const GUI: RequestAttachment = { name: "Phieu.pdf", path: "requests/gui/1759600000000-Phieu.pdf", size: 5 };
const freshPath = (uid: string, name = "Bang_KL_DUNG.xlsx") => `requests/${uid}/${NOW_MS - 60_000}-${name}`;

type Req = Parameters<typeof planDecisionAttachmentEdit>[0]["request"];
function makeReq(over: Partial<Req> = {}, names = [SAI.name, ANH.name]): Req {
  return {
    status: "pending",
    attachments: [GUI, SAI, ANH],
    history: [
      { at: "2026-10-06T01:00:00.000Z", actor: "Người gửi", action: HISTORY_ACTION.submitted },
      { at: AT, actor: PHUONG.name, action: HISTORY_ACTION.approved, note: "Gửi kèm bảng", attachmentNames: names },
    ],
    approversSnapshot: [PHUONG, THI],
    approvers: [
      { id: "phuong", decision: "approved" },
      { id: "thi", decision: "pending" },
    ],
    ...over,
  };
}

const ON_OPTIONAL = { decisionAttachmentEnabled: { approve: true } };
const ON_REQUIRED = { decisionAttachmentEnabled: { approve: true }, requireDecisionAttachment: { approve: true } };
const actor = (uid: string, isAdmin = false) => ({ uid, name: uid === "phuong" ? PHUONG.name : "Người khác", isAdmin });

function plan(over: Partial<Parameters<typeof planDecisionAttachmentEdit>[0]> = {}) {
  return planDecisionAttachmentEdit({
    request: makeReq(),
    input: { action: "remove", path: SAI.path },
    actor: actor("phuong"),
    group: ON_OPTIONAL,
    nowIso: NOW,
    ...over,
  });
}

describe("quyền thay/gỡ tệp đính kèm khi duyệt", () => {
  it("người đính kèm (suy uid từ path cho tệp cũ) và Owner/Admin được; người khác không", () => {
    expect(uploaderUidOf(SAI)).toBe("phuong");
    expect(uploaderUidOf({ ...SAI, addedByUid: "x" })).toBe("x");
    expect(plan().ok).toBe(true);
    expect(plan({ actor: actor("admin1", true) }).ok).toBe(true);
    const other = plan({ actor: actor("thi") });
    expect(other).toMatchObject({ ok: false, status: 403 });
    expect(canEditDecisionAttachment({ status: "pending", att: SAI, uid: "thi", isAdmin: false })).toBe(false);
  });

  it("chỉ khi đề xuất đang chờ duyệt hoặc bị trả lại; đã duyệt / từ chối / nháp → khoá", () => {
    expect(plan({ request: makeReq({ status: "returned" }) }).ok).toBe(true);
    for (const status of ["approved", "rejected", "draft"] as const) {
      expect(plan({ request: makeReq({ status }) })).toMatchObject({ ok: false, status: 409 });
      expect(plan({ request: makeReq({ status }), actor: actor("admin1", true) })).toMatchObject({ ok: false });
    }
  });

  it("không sửa tệp không phải tệp quyết định, tệp không có, tệp đã gỡ", () => {
    expect(plan({ input: { action: "remove", path: GUI.path }, actor: actor("admin1", true) })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(plan({ input: { action: "remove", path: "requests/phuong/khong-co.pdf" } })).toMatchObject({ status: 404 });
    const removed = { ...SAI, removedAt: NOW };
    expect(plan({ request: makeReq({ attachments: [GUI, removed, ANH] }) })).toMatchObject({ status: 409 });
  });
});

describe("gỡ tệp", () => {
  it("không xoá phần tử, đánh dấu removedAt/removedBy, ghi 1 dòng lịch sử", () => {
    const r = plan();
    if (!r.ok) throw new Error(r.error);
    expect(r.attachments).toHaveLength(3);
    expect(r.attachments[1]).toMatchObject({ path: SAI.path, removedAt: NOW, removedBy: { uid: "phuong", name: PHUONG.name } });
    expect(r.attachments[1].replacedByPath).toBeUndefined();
    expect(r.historyEntry).toEqual({ at: NOW, actor: PHUONG.name, action: DECISION_ATTACHMENT_REMOVED_ACTION, note: SAI.name });
    expect(r.history).toHaveLength(3);
  });

  it("hành động bắt buộc đính kèm: gỡ được khi còn tệp khác, KHÔNG gỡ được tệp còn hiệu lực cuối cùng", () => {
    expect(plan({ group: ON_REQUIRED }).ok).toBe(true);
    const only = makeReq({ attachments: [GUI, SAI] }, [SAI.name]);
    const blocked = plan({ request: only, group: ON_REQUIRED });
    expect(blocked).toMatchObject({ ok: false, status: 400 });
    if (!blocked.ok) expect(blocked.error).toContain("chỉ thay");
    // Không bắt buộc → gỡ được cả tệp cuối.
    expect(plan({ request: only, group: ON_OPTIONAL }).ok).toBe(true);
    // Bắt buộc nhưng được THAY tệp cuối.
    const replaced = plan({
      request: only,
      group: ON_REQUIRED,
      input: { action: "replace", path: SAI.path, file: { name: "Dung.xlsx", path: freshPath("phuong"), size: 1 } },
    });
    expect(replaced.ok).toBe(true);
  });
});

describe("thay tệp", () => {
  const replaceInput = (path = freshPath("phuong")) =>
    ({ action: "replace", path: SAI.path, file: { name: "Bang KL DUNG.xlsx", path, size: 999 } }) as const;

  it("tệp cũ đánh dấu replacedByPath, tệp mới nối cuối với replacesPath + kích thước đo thật", () => {
    const r = plan({ input: replaceInput(), verifiedSize: 1234 });
    if (!r.ok) throw new Error(r.error);
    expect(r.attachments).toHaveLength(4);
    expect(r.attachments[1]).toMatchObject({ removedAt: NOW, replacedByPath: freshPath("phuong") });
    expect(r.attachments[3]).toEqual({
      name: "Bang KL DUNG.xlsx",
      path: freshPath("phuong"),
      size: 1234,
      source: "decision",
      addedBy: PHUONG.name,
      addedByUid: "phuong",
      addedAt: NOW,
      replacesPath: SAI.path,
    });
    expect(r.historyEntry).toMatchObject({
      action: DECISION_ATTACHMENT_REPLACED_ACTION,
      note: "Bang KL SAI.xlsx → Bang KL DUNG.xlsx",
    });
  });

  it("tệp mới phải là tệp CHÍNH người gọi vừa tải (≤ 24 giờ), không trùng tệp đã có", () => {
    expect(plan({ input: replaceInput(freshPath("thi")) })).toMatchObject({ ok: false, status: 400 });
    const old = `requests/phuong/${NOW_MS - 25 * 3_600_000}-x.pdf`;
    expect(plan({ input: replaceInput(old) })).toMatchObject({ ok: false, status: 400 });
    const dup = makeReq({ attachments: [GUI, SAI, ANH, dec("Dup.pdf", freshPath("phuong"))] });
    expect(plan({ request: dup, input: replaceInput() })).toMatchObject({ ok: false, status: 400 });
    // Admin thay tệp của người khác: tệp mới phải là của admin.
    expect(plan({ actor: actor("admin1", true), input: replaceInput(freshPath("admin1")) }).ok).toBe(true);
  });

  it("chuỗi thay thế: ý kiến cũ trỏ tệp hiện hành, tệp cũ gạch ngang + dòng lịch sử; thay 2 lần vẫn đúng", () => {
    const r1 = plan({ input: replaceInput() });
    if (!r1.ok) throw new Error(r1.error);
    const second = freshPath("admin1", "Ban_cuoi.xlsx");
    const r2 = planDecisionAttachmentEdit({
      request: makeReq({ attachments: r1.attachments, history: r1.history }),
      input: { action: "replace", path: freshPath("phuong"), file: { name: "Ban cuoi.xlsx", path: second, size: 1 } },
      actor: actor("admin1", true),
      group: ON_OPTIONAL,
      nowIso: "2026-10-06T07:05:00.000Z",
    });
    if (!r2.ok) throw new Error(r2.error);
    const r3 = planDecisionAttachmentEdit({
      request: makeReq({ attachments: r2.attachments, history: r2.history }),
      input: { action: "remove", path: ANH.path },
      actor: actor("phuong"),
      group: ON_OPTIONAL,
      nowIso: "2026-10-06T07:06:00.000Z",
    });
    if (!r3.ok) throw new Error(r3.error);

    const opinions = extractApproverOpinions({ ...makeReq(), attachments: r3.attachments, history: r3.history });
    expect(opinions).toHaveLength(1); // dòng thay/gỡ KHÔNG thành ý kiến mới
    const o = opinions[0];
    expect(o.attachments.map((a) => a.name)).toEqual(["Ban cuoi.xlsx"]);
    expect(o.formerAttachments.map((a) => a.name)).toEqual(["Bang KL SAI.xlsx", "Bang KL DUNG.xlsx", "Anh.jpg"]);
    expect(o.attachmentChanges.map((c) => [c.kind, c.by, c.oldName, c.newName])).toEqual([
      ["replaced", PHUONG.name, "Bang KL SAI.xlsx", "Bang KL DUNG.xlsx"],
      ["replaced", "Người khác", "Bang KL DUNG.xlsx", "Ban cuoi.xlsx"],
      ["removed", PHUONG.name, "Anh.jpg", undefined],
    ]);
  });

  it("tệp thay thế trùng tên với tệp của ý kiến khác không bị ghép nhầm làm tệp gốc", () => {
    const AT2 = "2026-10-06T06:58:00.000Z";
    const other = { ...dec("Bang KL DUNG.xlsx", "requests/thi/1759700000009-Bang_KL_DUNG.xlsx"), addedBy: THI.name, addedAt: AT2 };
    const base = makeReq({
      attachments: [GUI, SAI, ANH, other],
      history: [
        ...makeReq().history,
        { at: AT2, actor: THI.name, action: HISTORY_ACTION.approved, attachmentNames: [other.name] },
      ],
    });
    const r = plan({ request: base, input: replaceInput() });
    if (!r.ok) throw new Error(r.error);
    const ops = extractApproverOpinions({ ...base, attachments: r.attachments, history: r.history });
    expect(ops[0].attachments.map((a) => a.path)).toEqual([freshPath("phuong"), ANH.path]);
    expect(ops[1].attachments.map((a) => a.path)).toEqual([other.path]);
  });
});

describe("dòng lịch sử mới không làm sai tiến trình người duyệt", () => {
  it("buildApproverProgress bỏ qua 'Đã thay/gỡ tệp đính kèm'", () => {
    const base = {
      ...makeReq(),
      approvalFlow: "sequential" as const,
      approverStepMeta: undefined,
      submittedAt: "2026-10-06T01:00:00.000Z",
      deadlineAt: null,
    } as Parameters<typeof buildApproverProgress>[0] & Pick<RequestInstance, "attachments">;
    const before = buildApproverProgress(base, null, new Date(NOW_MS));
    const r = plan({ input: { action: "remove", path: ANH.path } });
    if (!r.ok) throw new Error(r.error);
    const after = buildApproverProgress({ ...base, history: r.history }, null, new Date(NOW_MS));
    expect(after.rows.map((x) => [x.status, x.startAt, x.endAt])).toEqual(
      before.rows.map((x) => [x.status, x.startAt, x.endAt]),
    );
    expect(after.cycleStartAt).toBe(before.cycleStartAt);
  });
});

describe("parseDecisionAttachmentEditBody", () => {
  it("nhận remove/replace đúng dạng, chặn body lạ", () => {
    expect(parseDecisionAttachmentEditBody({ action: "remove", path: "a" })).toMatchObject({ ok: true });
    expect(
      parseDecisionAttachmentEditBody({ action: "replace", path: "a", file: { name: " b.pdf ", path: "p", size: 3 } }),
    ).toEqual({ ok: true, input: { action: "replace", path: "a", file: { name: "b.pdf", path: "p", size: 3 } } });
    expect(parseDecisionAttachmentEditBody(null)).toMatchObject({ ok: false, status: 400 });
    expect(parseDecisionAttachmentEditBody({ action: "delete", path: "a" })).toMatchObject({ ok: false });
    expect(parseDecisionAttachmentEditBody({ action: "replace", path: "a", file: { name: 1, path: "p" } })).toMatchObject({
      ok: false,
    });
  });
});
