import { describe, expect, it } from "vitest";
import {
  canManageGroupsAtAppScope,
  isFollowerAllowedToApprove,
  isWithinUsedForScope,
  resolveAdjustmentAccess,
} from "./permissions";
import type { RequestInstance, TaggedUser } from "./types";

const alice: TaggedUser = { id: "u1", name: "Alice", username: "alice", avatarInitial: "A" };
const bob: TaggedUser = { id: "u2", name: "Bob", username: "bob", avatarInitial: "B" };

describe("canManageGroupsAtAppScope", () => {
  it("chỉ owner và admin (vai trò toàn cục app tổng) được quản lý ở mức toàn ứng dụng", () => {
    expect(canManageGroupsAtAppScope("owner")).toBe(true);
    expect(canManageGroupsAtAppScope("admin")).toBe(true);
    expect(canManageGroupsAtAppScope("manager")).toBe(false);
    expect(canManageGroupsAtAppScope("employee")).toBe(false);
  });
});

describe("isWithinUsedForScope", () => {
  it("để trống usedFor nghĩa là toàn công ty được dùng", () => {
    expect(isWithinUsedForScope([], { userId: "anyone", groupIds: [] })).toBe(true);
  });

  it("cho phép người dùng có id nằm trong usedFor", () => {
    expect(isWithinUsedForScope([alice], { userId: "u1", groupIds: [] })).toBe(true);
    expect(isWithinUsedForScope([alice], { userId: "u2", groupIds: [] })).toBe(false);
  });

  it("cho phép người dùng thuộc nhóm (kind: group) nằm trong usedFor", () => {
    const team: TaggedUser = { ...bob, id: "d1", kind: "group" };
    expect(isWithinUsedForScope([team], { userId: "u1", groupIds: ["d1"] })).toBe(true);
  });

  it("phần tử người lẻ chỉ khớp theo uid, không khớp nhầm id nhóm", () => {
    expect(isWithinUsedForScope([bob], { userId: "u1", groupIds: ["u2"] })).toBe(false);
  });
});

describe("isFollowerAllowedToApprove", () => {
  it("người theo dõi không tự động có quyền duyệt", () => {
    expect(isFollowerAllowedToApprove()).toBe(false);
  });
});

describe("resolveAdjustmentAccess", () => {
  const baseRequest: Pick<RequestInstance, "status" | "submittedBy" | "followers"> = {
    status: "approved",
    submittedBy: { uid: "u1", email: "a@x.com", name: "Alice" },
    followers: [bob],
  };

  it("submitter ở phòng khác -> direct (hành vi cũ)", () => {
    expect(resolveAdjustmentAccess(baseRequest, "u1", "other")).toBe("direct");
  });

  it("submitter ở phòng Thi công -> gated", () => {
    expect(resolveAdjustmentAccess(baseRequest, "u1", "thi_cong")).toBe("gated");
  });

  it("submitter ở phòng Thu mua cung ứng -> gated", () => {
    expect(resolveAdjustmentAccess(baseRequest, "u1", "thu_mua_cung_ung")).toBe("gated");
  });

  it("follower ở phòng Thi công -> gated", () => {
    expect(resolveAdjustmentAccess(baseRequest, "u2", "thi_cong")).toBe("gated");
  });

  it("follower ở phòng khác -> none (chỉ submitter mới có quyền direct)", () => {
    expect(resolveAdjustmentAccess(baseRequest, "u2", "other")).toBe("none");
  });

  it("người ngoài submitter/followers -> none, kể cả thuộc phòng gate", () => {
    expect(resolveAdjustmentAccess(baseRequest, "u3", "thu_mua_cung_ung")).toBe("none");
  });

  it("đề xuất chưa duyệt (status khác approved) -> none dù là submitter", () => {
    expect(resolveAdjustmentAccess({ ...baseRequest, status: "pending" }, "u1", "other")).toBe("none");
  });
});
