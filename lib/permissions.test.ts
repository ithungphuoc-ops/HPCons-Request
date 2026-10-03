import { describe, expect, it } from "vitest";
import { canManageGroupsAtAppScope, isFollowerAllowedToApprove, isWithinUsedForScope } from "./permissions";
import type { TaggedUser } from "./types";

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
