import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({ adminDb: {} }));

const { canAdjustAfterApproval } = await import("./adjustment-approval-rules");

/**
 * Ai được bấm "Điều chỉnh" — 06/10/2026 bỏ bảng nhánh phòng ban (PR #68), giữ
 * quyền bấm như cũ: người gửi luôn được; người theo dõi chỉ khi nhóm bật
 * `allowFollowers`.
 */
type Found = Parameters<typeof canAdjustAfterApproval>[0];
const req = (extra: object = {}): Found => ({
  status: "approved" as const,
  deletedAt: null,
  submittedBy: { uid: "owner", name: "Chủ" },
  followers: [{ id: "fol", name: "Theo dõi", username: "f", avatarInitial: "T" }],
  ...extra,
}) as unknown as Found;

describe("canAdjustAfterApproval", () => {
  it("người gửi luôn được (đề xuất đã duyệt), kể cả nhóm chưa cấu hình", () => {
    expect(canAdjustAfterApproval(req(), "owner", null)).toBe(true);
    expect(canAdjustAfterApproval(req(), "owner", { allowFollowers: false })).toBe(true);
  });
  it("chưa duyệt / đã xoá → không ai được", () => {
    expect(canAdjustAfterApproval(req({ status: "pending" }), "owner", null)).toBe(false);
    expect(canAdjustAfterApproval(req({ deletedAt: "x" }), "owner", null)).toBe(false);
  });
  it("người theo dõi: chỉ khi allowFollowers === true", () => {
    expect(canAdjustAfterApproval(req(), "fol", null)).toBe(false);
    expect(canAdjustAfterApproval(req(), "fol", undefined)).toBe(false);
    expect(canAdjustAfterApproval(req(), "fol", { allowFollowers: false })).toBe(false);
    expect(canAdjustAfterApproval(req(), "fol", { allowFollowers: true })).toBe(true);
  });
  it("dữ liệu nhánh cũ (branches/catchAll) còn trong Firestore không ảnh hưởng — chỉ đọc allowFollowers", () => {
    const legacy = {
      allowFollowers: true,
      branches: [{ id: "b1", departments: [{ id: "d", name: "D" }], requiredApprovers: [] }],
      catchAllApprovers: [],
    };
    expect(canAdjustAfterApproval(req(), "fol", legacy)).toBe(true);
  });
  it("người không liên quan → không", () => {
    expect(canAdjustAfterApproval(req(), "x", { allowFollowers: true })).toBe(false);
  });
});
