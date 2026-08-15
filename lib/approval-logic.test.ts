import { describe, expect, it } from "vitest";
import {
  ApprovalActionError,
  applyApproverDecision,
  approveAndForward,
  canApproverAct,
  dedupeApprovers,
  forwardThenApprove,
  getRequestStatus,
  missingRequiredNote,
  type ApproverState,
} from "./approval-logic";
import type { TaggedUser } from "./types";

function approvers(...ids: string[]): ApproverState[] {
  return ids.map((id) => ({ id, decision: "pending" as const }));
}

describe("Xử lý đồng thời (concurrent)", () => {
  it("cho phép mọi người duyệt thao tác bất kỳ lúc nào", () => {
    const list = approvers("a", "b", "c");
    expect(canApproverAct("concurrent", list, "a")).toBe(true);
    expect(canApproverAct("concurrent", list, "b")).toBe(true);
    expect(canApproverAct("concurrent", list, "c")).toBe(true);
  });

  it("chỉ hoàn tất khi TẤT CẢ người duyệt cần thiết đã chấp thuận", () => {
    let list = approvers("a", "b");
    list = applyApproverDecision("concurrent", list, "a", "approved");
    expect(getRequestStatus("concurrent", list)).toBe("pending");

    list = applyApproverDecision("concurrent", list, "b", "approved");
    expect(getRequestStatus("concurrent", list)).toBe("approved");
  });

  it("từ chối ngay khi có một người từ chối", () => {
    let list = approvers("a", "b");
    list = applyApproverDecision("concurrent", list, "b", "rejected");
    expect(getRequestStatus("concurrent", list)).toBe("rejected");
  });
});

describe("Xử lý lần lượt (sequential)", () => {
  it("chỉ người đầu tiên còn pending theo thứ tự được phép thao tác", () => {
    const list = approvers("a", "b", "c");
    expect(canApproverAct("sequential", list, "a")).toBe(true);
    expect(canApproverAct("sequential", list, "b")).toBe(false);
    expect(canApproverAct("sequential", list, "c")).toBe(false);
  });

  it("người thứ hai chỉ được thao tác sau khi người đầu đã xử lý xong", () => {
    let list = approvers("a", "b", "c");
    list = applyApproverDecision("sequential", list, "a", "approved");

    expect(canApproverAct("sequential", list, "b")).toBe(true);
    expect(canApproverAct("sequential", list, "c")).toBe(false);
  });

  it("ném lỗi nếu người chưa tới lượt cố thao tác", () => {
    const list = approvers("a", "b");
    expect(() => applyApproverDecision("sequential", list, "b", "approved")).toThrow(
      ApprovalActionError,
    );
  });

  it("hoàn tất khi tất cả đã duyệt theo đúng thứ tự", () => {
    let list = approvers("a", "b");
    list = applyApproverDecision("sequential", list, "a", "approved");
    list = applyApproverDecision("sequential", list, "b", "approved");
    expect(getRequestStatus("sequential", list)).toBe("approved");
  });
});

describe("Chỉ cần một người duyệt (single)", () => {
  it("hoàn tất ngay khi một người hợp lệ chấp thuận", () => {
    let list = approvers("a", "b", "c");
    list = applyApproverDecision("single", list, "b", "approved");
    expect(getRequestStatus("single", list)).toBe("approved");
  });

  it("chỉ từ chối khi tất cả đều từ chối", () => {
    let list = approvers("a", "b");
    list = applyApproverDecision("single", list, "a", "rejected");
    expect(getRequestStatus("single", list)).toBe("pending");

    list = applyApproverDecision("single", list, "b", "rejected");
    expect(getRequestStatus("single", list)).toBe("rejected");
  });

  it("ai cũng có thể thao tác trước khi có người chấp thuận", () => {
    const list = approvers("a", "b");
    expect(canApproverAct("single", list, "a")).toBe(true);
    expect(canApproverAct("single", list, "b")).toBe(true);
  });
});

describe("Ràng buộc chung", () => {
  it("không cho một người duyệt thao tác hai lần", () => {
    let list = approvers("a");
    list = applyApproverDecision("concurrent", list, "a", "approved");
    expect(() => applyApproverDecision("concurrent", list, "a", "approved")).toThrow(
      ApprovalActionError,
    );
  });
});

describe("Chấp nhận và chuyển tiếp (approveAndForward)", () => {
  it("người chuyển được ghi 'approved', người mới chèn NGAY SAU, pending", () => {
    const list = approvers("a", "b");
    const result = approveAndForward("concurrent", list, "a", "z");
    expect(result).toEqual([
      { id: "a", decision: "approved" },
      { id: "z", decision: "pending" },
      { id: "b", decision: "pending" },
    ]);
  });

  it("lần lượt: người mới vào đúng lượt kế tiếp (a đã duyệt, z tới lượt)", () => {
    const list = approvers("a", "b");
    const result = approveAndForward("sequential", list, "a", "z");
    expect(canApproverAct("sequential", result, "z")).toBe(true);
    expect(canApproverAct("sequential", result, "b")).toBe(false);
  });

  it("không cho khi chưa tới lượt, đã quyết định rồi, hoặc người nhận đã có mặt", () => {
    const list = approvers("a", "b");
    expect(() => approveAndForward("sequential", list, "b", "z")).toThrow(ApprovalActionError);
    expect(() => approveAndForward("concurrent", list, "a", "b")).toThrow(ApprovalActionError);
    let decided = approvers("a", "b");
    decided = applyApproverDecision("concurrent", decided, "a", "approved");
    expect(() => approveAndForward("concurrent", decided, "a", "z")).toThrow(ApprovalActionError);
  });

  it("một người duyệt: người chuyển đã 'approved' nên đề xuất hoàn tất luôn, không cần chờ z", () => {
    const list = approvers("a", "b");
    const result = approveAndForward("single", list, "a", "z");
    expect(getRequestStatus("single", result)).toBe("approved");
  });
});

describe("Chuyển tiếp và Duyệt (forwardThenApprove)", () => {
  it("người mới chèn NGAY TRƯỚC, người chuyển vẫn còn nguyên, pending", () => {
    const list = approvers("a", "b");
    const result = forwardThenApprove("concurrent", list, "a", "z");
    expect(result).toEqual([
      { id: "z", decision: "pending" },
      { id: "a", decision: "pending" },
      { id: "b", decision: "pending" },
    ]);
  });

  it("lần lượt: người mới xử lý TRƯỚC, người chuyển chưa tới lượt cho tới khi z quyết định", () => {
    const list = approvers("a", "b");
    const result = forwardThenApprove("sequential", list, "a", "z");
    expect(canApproverAct("sequential", result, "z")).toBe(true);
    expect(canApproverAct("sequential", result, "a")).toBe(false);
    const afterZ = applyApproverDecision("sequential", result, "z", "approved");
    expect(canApproverAct("sequential", afterZ, "a")).toBe(true);
  });

  it("không cho khi chưa tới lượt, đã quyết định rồi, hoặc người nhận đã có mặt", () => {
    const list = approvers("a", "b");
    expect(() => forwardThenApprove("sequential", list, "b", "z")).toThrow(ApprovalActionError);
    expect(() => forwardThenApprove("concurrent", list, "a", "b")).toThrow(ApprovalActionError);
    let decided = approvers("a", "b");
    decided = applyApproverDecision("concurrent", decided, "a", "approved");
    expect(() => forwardThenApprove("concurrent", decided, "a", "z")).toThrow(ApprovalActionError);
  });
});

describe("missingRequiredNote", () => {
  it("rejected luôn bắt buộc ghi chú, không phụ thuộc cấu hình nhóm", () => {
    expect(missingRequiredNote("rejected", undefined, undefined)).toBe(true);
    expect(missingRequiredNote("rejected", "  ", undefined)).toBe(true);
    expect(missingRequiredNote("rejected", "Lý do", undefined)).toBe(false);
  });

  it("returned luôn bắt buộc ghi chú, không phụ thuộc cấu hình nhóm", () => {
    expect(missingRequiredNote("returned", undefined, { approve: true })).toBe(true);
    expect(missingRequiredNote("returned", "Lý do", undefined)).toBe(false);
  });

  it("approved không bắt buộc khi nhóm chưa bật cờ", () => {
    expect(missingRequiredNote("approved", undefined, undefined)).toBe(false);
    expect(missingRequiredNote("approved", undefined, { approve: false })).toBe(false);
  });

  it("approved bắt buộc khi nhóm bật cờ approve", () => {
    expect(missingRequiredNote("approved", undefined, { approve: true })).toBe(true);
    expect(missingRequiredNote("approved", "Ok", { approve: true })).toBe(false);
  });

  it("2 kiểu chuyển tiếp không bắt buộc khi nhóm chưa bật cờ", () => {
    expect(missingRequiredNote("approve_and_forward", undefined, undefined)).toBe(false);
    expect(missingRequiredNote("forward_then_approve", undefined, undefined)).toBe(false);
  });

  it("2 kiểu chuyển tiếp bắt buộc khi nhóm bật cờ forward", () => {
    expect(missingRequiredNote("approve_and_forward", undefined, { forward: true })).toBe(true);
    expect(missingRequiredNote("approve_and_forward", "Chuyển", { forward: true })).toBe(false);
    expect(missingRequiredNote("forward_then_approve", undefined, { forward: true })).toBe(true);
    expect(missingRequiredNote("forward_then_approve", "Chuyển", { forward: true })).toBe(false);
  });
});

function user(id: string): TaggedUser {
  return { id, name: id, username: id, avatarInitial: id[0] };
}

describe("dedupeApprovers", () => {
  it("giữ nguyên khi không ai trùng", () => {
    const list = [user("a"), user("b"), user("c")];
    expect(dedupeApprovers(list)).toEqual(list);
  });

  it("người trùng 2 bước chỉ giữ 1 lần, ở vị trí lần xuất hiện sau cùng", () => {
    const [a, b] = [user("a"), user("b")];
    const result = dedupeApprovers([a, b, a]);
    expect(result).toEqual([b, a]);
  });

  it("trùng nhiều id khác nhau xen kẽ vẫn đúng thứ tự theo lần cuối", () => {
    const [a, b, c] = [user("a"), user("b"), user("c")];
    // a(0) b(1) c(2) a(3) b(4) -> giữ c(2), a(3), b(4) theo đúng thứ tự đó
    const result = dedupeApprovers([a, b, c, a, b]);
    expect(result.map((u) => u.id)).toEqual(["c", "a", "b"]);
  });

  it("danh sách rỗng trả về rỗng", () => {
    expect(dedupeApprovers([])).toEqual([]);
  });
});
