import { describe, expect, it } from "vitest";
import {
  checkAdjustmentContent,
  findLastApprover,
  findPurchasingDepartment,
  isAdjustmentReviewer,
  isAwaitingMyAdjustmentDecision,
  pendingAdjustmentFiles,
  resolveAdjustmentFieldRules,
  sanitizeAdjustmentFieldRules,
  validateAdjustmentApproverPick,
} from "./adjustment-settings";
import type { RequestInstance, TaggedUser } from "./types";

const u = (id: string, name: string): TaggedUser => ({ id, name, username: id, avatarInitial: name[0] });

describe("validateAdjustmentApproverPick — bắt buộc ĐÚNG 2 người", () => {
  it("0 / 1 / 3 người → chặn", () => {
    expect(validateAdjustmentApproverPick([], "me").ok).toBe(false);
    expect(validateAdjustmentApproverPick(["a"], "me").ok).toBe(false);
    expect(validateAdjustmentApproverPick(["a", "b", "c"], "me").ok).toBe(false);
  });
  it("không phải mảng / rỗng chuỗi → chặn", () => {
    expect(validateAdjustmentApproverPick(undefined, "me").ok).toBe(false);
    expect(validateAdjustmentApproverPick("a,b", "me").ok).toBe(false);
    expect(validateAdjustmentApproverPick(["a", ""], "me").ok).toBe(false);
    expect(validateAdjustmentApproverPick(["a", 5], "me").ok).toBe(false);
  });
  it("trùng người → chặn", () => {
    const r = validateAdjustmentApproverPick(["a", "a"], "me");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/khác nhau/);
  });
  it("chọn chính mình → chặn", () => {
    const r = validateAdjustmentApproverPick(["a", "me"], "me");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/chính mình/);
  });
  it("đúng 2 người khác nhau, không phải mình → hợp lệ", () => {
    expect(validateAdjustmentApproverPick([" a ", "b"], "me")).toEqual({ ok: true, uids: ["a", "b"] });
  });
});

describe("findLastApprover — người duyệt cuối", () => {
  const snapshot = [u("x", "Hồ Văn Thi"), u("y", "Trần Ngọc Phương"), u("z", "Hồ Minh Sang")];
  it("người THỰC TẾ bấm 'Đã chấp thuận' gần nhất (không nhất thiết là người cuối danh sách)", () => {
    const req = {
      approversSnapshot: snapshot,
      approvers: [
        { id: "x", decision: "approved" },
        { id: "y", decision: "approved" },
        { id: "z", decision: "pending" },
      ],
      history: [
        { at: "1", actor: "Hồ Văn Thi", action: "Đã chấp thuận" },
        { at: "2", actor: "Trần Ngọc Phương", action: "Đã chấp thuận" },
        { at: "3", actor: "Ai đó", action: "Đã đồng bộ sang Kho" },
      ],
    } as unknown as RequestInstance;
    expect(findLastApprover(req)?.id).toBe("y");
  });
  it("tính cả 'Đã chấp thuận và chuyển tiếp', bỏ qua dòng không phải quyết định", () => {
    const req = {
      approversSnapshot: snapshot,
      approvers: [],
      history: [
        { at: "1", actor: "hồ minh sang", action: "Đã chấp thuận và chuyển tiếp" },
        { at: "2", actor: "Hồ Văn Thi", action: "Điều chỉnh sau duyệt (lần 1)" },
      ],
    } as unknown as RequestInstance;
    expect(findLastApprover(req)?.id).toBe("z");
  });
  it("không ghép được tên → người cuối danh sách approversSnapshot", () => {
    const req = { approversSnapshot: snapshot, approvers: [], history: [] } as unknown as RequestInstance;
    expect(findLastApprover(req)?.id).toBe("z");
  });
  it("trùng tên → ưu tiên người có quyết định approved", () => {
    const req = {
      approversSnapshot: [u("p1", "Nguyễn A"), u("p2", "Nguyễn A")],
      approvers: [
        { id: "p1", decision: "approved" },
        { id: "p2", decision: "pending" },
      ],
      history: [{ at: "1", actor: "Nguyễn A", action: "Đã chấp thuận" }],
    } as unknown as RequestInstance;
    expect(findLastApprover(req)?.id).toBe("p1");
  });
  it("không có người duyệt → null", () => {
    expect(findLastApprover({ approversSnapshot: [], approvers: [], history: [] } as unknown as RequestInstance)).toBeNull();
  });
});

describe("findPurchasingDepartment — Trưởng phòng Thu mua", () => {
  it("tìm phòng chứa 'thu mua' (không phân biệt hoa thường/dấu), có trưởng phòng", () => {
    const depts = [
      { id: "1", name: "Phòng Thi công", leaderId: "l1" },
      { id: "2", name: "THU MUA CUNG ỨNG", leaderId: null },
      { id: "3", name: "Phòng Thu Mua", leaderId: "l3" },
    ];
    expect(findPurchasingDepartment(depts)?.id).toBe("3");
  });
  it("không có phòng nào → null (ẩn gợi ý)", () => {
    expect(findPurchasingDepartment([{ id: "1", name: "Kế toán", leaderId: "x" }])).toBeNull();
  });
});

describe("resolveAdjustmentFieldRules / checkAdjustmentContent — ô Ghi chú / Đính kèm", () => {
  it("chưa cài → Ghi chú Có + Đính kèm Có, không bắt buộc", () => {
    expect(resolveAdjustmentFieldRules({})).toEqual({
      note: { enabled: true, required: false },
      attachment: { enabled: true, required: false },
    });
  });
  it("không cho tắt cả 2 ô; ô tắt thì không bắt buộc", () => {
    const r = resolveAdjustmentFieldRules({
      adjustmentFieldRules: { noteEnabled: false, noteRequired: true, attachmentEnabled: false },
    });
    expect(r.note).toEqual({ enabled: true, required: true });
    expect(sanitizeAdjustmentFieldRules({ attachmentEnabled: false, attachmentRequired: true })).toEqual({
      noteEnabled: true,
      noteRequired: false,
      attachmentEnabled: false,
      attachmentRequired: false,
    });
    expect(sanitizeAdjustmentFieldRules("x")).toBeNull();
  });
  it("luôn cần ít nhất ghi chú hoặc 1 tệp", () => {
    const rules = resolveAdjustmentFieldRules({});
    expect(checkAdjustmentContent(rules, { noiDung: "  ", fileCount: 0 }).ok).toBe(false);
    expect(checkAdjustmentContent(rules, { noiDung: "", fileCount: 1 }).ok).toBe(true);
    expect(checkAdjustmentContent(rules, { noiDung: "đổi", fileCount: 0 }).ok).toBe(true);
  });
  it("bắt buộc ghi chú / bắt buộc tệp", () => {
    const noteReq = resolveAdjustmentFieldRules({ adjustmentFieldRules: { noteRequired: true } });
    expect(checkAdjustmentContent(noteReq, { noiDung: "", fileCount: 2 }).ok).toBe(false);
    const fileReq = resolveAdjustmentFieldRules({ adjustmentFieldRules: { attachmentRequired: true } });
    expect(checkAdjustmentContent(fileReq, { noiDung: "đổi", fileCount: 0 }).ok).toBe(false);
  });
  it("ô tắt → bỏ phần đó (không lưu), và không tính vào 'ít nhất 1'", () => {
    const noFile = resolveAdjustmentFieldRules({ adjustmentFieldRules: { attachmentEnabled: false } });
    const r = checkAdjustmentContent(noFile, { noiDung: "", fileCount: 3 });
    expect(r.ok).toBe(false);
    const ok = checkAdjustmentContent(noFile, { noiDung: "đổi", fileCount: 3 });
    expect(ok).toEqual({ ok: true, noiDung: "đổi", keepFiles: false });
  });
});

describe("pendingAdjustment — tương thích dữ liệu cũ", () => {
  const pa = (extra: object) =>
    ({
      noiDung: "",
      attachment: null,
      requestedByUid: "o",
      requestedByName: "O",
      createdAt: "t",
      approvers: [
        { uid: "a", name: "A", approvedAt: null },
        { uid: "b", name: "B", approvedAt: "x" },
      ],
      ...extra,
    }) as NonNullable<RequestInstance["pendingAdjustment"]>;
  it("pendingAdjustmentFiles đọc được dạng cũ 1 tệp và dạng mới", () => {
    const f = { name: "a", path: "p", size: 1 };
    expect(pendingAdjustmentFiles(pa({ attachment: f }))).toEqual([f]);
    expect(pendingAdjustmentFiles(pa({ attachments: [f, { ...f, path: "q" }] }))).toHaveLength(2);
    expect(pendingAdjustmentFiles(null)).toEqual([]);
  });
  it("isAwaitingMyAdjustmentDecision chỉ đúng với phần CHƯA duyệt của mình", () => {
    const req = { status: "approved", pendingAdjustment: pa({}) } as RequestInstance;
    expect(isAwaitingMyAdjustmentDecision(req, "a")).toBe(true);
    expect(isAwaitingMyAdjustmentDecision(req, "b")).toBe(false);
    expect(isAwaitingMyAdjustmentDecision(req, "c")).toBe(false);
  });
  it("isAdjustmentReviewer: đang được giao hoặc từng được giao", () => {
    expect(isAdjustmentReviewer({ pendingAdjustment: pa({}) }, "a")).toBe(true);
    expect(isAdjustmentReviewer({ pendingAdjustment: null, adjustmentReviewerUids: ["z"] }, "z")).toBe(true);
    expect(isAdjustmentReviewer({ pendingAdjustment: null }, "a")).toBe(false);
  });
});
