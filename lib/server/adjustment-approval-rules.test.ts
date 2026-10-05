import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const CHI_HUY_TRUONG: import("@/lib/types").AdjustmentApproverRef = { kind: "chi_huy_truong" };
const TRUONG_PHONG_THU_MUA: import("@/lib/types").AdjustmentApproverRef = {
  kind: "department_leader",
  departmentId: "dept-thumua",
  departmentName: "Thu mua cung ứng",
};
const TRUONG_PHONG_THI_CONG: import("@/lib/types").AdjustmentApproverRef = {
  kind: "department_leader",
  departmentId: "dept-thicong",
  departmentName: "Thi công",
};

const DEPARTMENTS = [
  { id: "dept-thicong", name: "Thi công", parentId: null, leaderId: "uid-truong-thicong" },
  { id: "dept-thumua", name: "Thu mua cung ứng", parentId: null, leaderId: "uid-truong-thumua" },
  { id: "dept-no-leader", name: "Phòng chưa có trưởng", parentId: null, leaderId: null },
];
const getCachedDepartmentsMock = vi.fn(async () => DEPARTMENTS);
const getScopeMembershipMock = vi.fn(async () => ({ primaryGroupIds: [], secondaryGroupIds: [] }));
vi.mock("@/lib/server/hpcore-org", () => ({
  getCachedDepartments: getCachedDepartmentsMock,
  getScopeMembership: getScopeMembershipMock,
}));

const userDocs: Record<string, { fullName?: string }> = {
  "uid-truong-thumua": { fullName: "Trần Văn B" },
  "uid-truong-thicong": { fullName: "Ngô Thị D" },
};
vi.mock("@/lib/hpcore", () => ({
  getHpcoreDb: () => ({
    collection: () => ({
      doc: (uid: string) => ({ get: async () => ({ data: () => userDocs[uid] }) }),
    }),
  }),
}));

const { matchAdjustmentBranch, planAdjustmentApproval, resolveApproverRefs } = await import(
  "./adjustment-approval-rules"
);

describe("matchAdjustmentBranch", () => {
  const branches = [
    { departments: [{ id: "dept-thicong", name: "Thi công" }], requiredApprovers: [TRUONG_PHONG_THU_MUA] },
    { departments: [{ id: "dept-thumua", name: "Thu mua cung ứng" }], requiredApprovers: [CHI_HUY_TRUONG] },
  ];

  it("khớp đúng nhánh đầu tiên có phòng ban trùng", () => {
    expect(matchAdjustmentBranch(branches, ["dept-thicong"])).toEqual({ requiredApprovers: [TRUONG_PHONG_THU_MUA] });
  });

  it("không khớp phòng ban nào -> null", () => {
    expect(matchAdjustmentBranch(branches, ["dept-khac"])).toBeNull();
  });

  it("xét ĐÚNG thứ tự — khớp nhánh đứng trước nếu 1 phòng ban xuất hiện ở nhiều nhánh", () => {
    const dup = [
      { departments: [{ id: "x", name: "X" }], requiredApprovers: [CHI_HUY_TRUONG] },
      { departments: [{ id: "x", name: "X" }], requiredApprovers: [TRUONG_PHONG_THU_MUA] },
    ];
    expect(matchAdjustmentBranch(dup, ["x"])).toEqual({ requiredApprovers: [CHI_HUY_TRUONG] });
  });
});

describe("planAdjustmentApproval", () => {
  const rules: import("@/lib/types").AdjustmentApprovalRules = {
    allowFollowers: true,
    branches: [
      { id: "b1", departments: [{ id: "dept-thicong", name: "Thi công" }], requiredApprovers: [TRUONG_PHONG_THU_MUA] },
      { id: "b2", departments: [{ id: "dept-thumua", name: "Thu mua cung ứng" }], requiredApprovers: [CHI_HUY_TRUONG] },
    ],
    catchAllApprovers: [CHI_HUY_TRUONG, TRUONG_PHONG_THU_MUA],
  };

  it("nhóm không có rules -> submitter direct, follower none", () => {
    expect(planAdjustmentApproval(undefined, { isSubmitter: true, departmentIds: ["dept-thicong"] })).toEqual({
      kind: "direct",
    });
    expect(planAdjustmentApproval(undefined, { isSubmitter: false, departmentIds: ["dept-thicong"] })).toEqual({
      kind: "none",
    });
  });

  it("khớp nhánh Thi công -> gated, cần Trưởng phòng Thu mua cung ứng", () => {
    expect(planAdjustmentApproval(rules, { isSubmitter: false, departmentIds: ["dept-thicong"] })).toEqual({
      kind: "gated",
      refs: [TRUONG_PHONG_THU_MUA],
    });
  });

  it("submitter khớp nhánh cũng bị gated (không chỉ follower)", () => {
    expect(planAdjustmentApproval(rules, { isSubmitter: true, departmentIds: ["dept-thumua"] })).toEqual({
      kind: "gated",
      refs: [CHI_HUY_TRUONG],
    });
  });

  it("không khớp nhánh nào, LÀ submitter -> luôn direct", () => {
    expect(planAdjustmentApproval(rules, { isSubmitter: true, departmentIds: ["dept-khac"] })).toEqual({
      kind: "direct",
    });
  });

  it("không khớp nhánh nào, là follower -> dùng catchAllApprovers", () => {
    expect(planAdjustmentApproval(rules, { isSubmitter: false, departmentIds: ["dept-khac"] })).toEqual({
      kind: "gated",
      refs: [CHI_HUY_TRUONG, TRUONG_PHONG_THU_MUA],
    });
  });

  it("catchAllApprovers rỗng -> follower không khớp gì thì none", () => {
    const r2 = { ...rules, catchAllApprovers: [] };
    expect(planAdjustmentApproval(r2, { isSubmitter: false, departmentIds: ["dept-khac"] })).toEqual({
      kind: "none",
    });
  });

  it("allowFollowers=false -> follower luôn none dù phòng ban khớp nhánh", () => {
    const r2 = { ...rules, allowFollowers: false };
    expect(planAdjustmentApproval(r2, { isSubmitter: false, departmentIds: ["dept-thicong"] })).toEqual({
      kind: "none",
    });
  });

  it("nhánh khớp nhưng requiredApprovers rỗng -> direct (lưu thẳng, không cần duyệt)", () => {
    const r2 = {
      ...rules,
      branches: [{ id: "b3", departments: [{ id: "dept-thicong", name: "Thi công" }], requiredApprovers: [] }],
    };
    expect(planAdjustmentApproval(r2, { isSubmitter: false, departmentIds: ["dept-thicong"] })).toEqual({
      kind: "direct",
    });
  });
});

describe("resolveApproverRefs", () => {
  beforeEach(() => getCachedDepartmentsMock.mockClear());

  it("chi_huy_truong -> originalFirstApprover của đề xuất", async () => {
    const result = await resolveApproverRefs([CHI_HUY_TRUONG], {
      originalFirstApprover: { id: "uid-chihuy", name: "Lê Văn C", username: "c", avatarInitial: "L" },
    });
    expect(result).toEqual([{ uid: "uid-chihuy", name: "Lê Văn C" }]);
  });

  it("chi_huy_truong nhưng đề xuất chưa có originalFirstApprover -> null (fallback)", async () => {
    const result = await resolveApproverRefs([CHI_HUY_TRUONG], { originalFirstApprover: null });
    expect(result).toBeNull();
  });

  it("department_leader -> tra đúng leaderId + tên thật", async () => {
    const result = await resolveApproverRefs([TRUONG_PHONG_THU_MUA], { originalFirstApprover: null });
    expect(result).toEqual([{ uid: "uid-truong-thumua", name: "Trần Văn B" }]);
  });

  it("department_leader nhưng phòng không có leaderId -> null (fallback)", async () => {
    const ref: import("@/lib/types").AdjustmentApproverRef = {
      kind: "department_leader",
      departmentId: "dept-no-leader",
      departmentName: "Phòng chưa có trưởng",
    };
    const result = await resolveApproverRefs([ref], { originalFirstApprover: null });
    expect(result).toBeNull();
  });

  it("2 ref trùng ra CÙNG 1 uid thật -> gộp còn 1 phần tử (Quyết định 3)", async () => {
    const result = await resolveApproverRefs(
      [CHI_HUY_TRUONG, TRUONG_PHONG_THU_MUA],
      { originalFirstApprover: { id: "uid-truong-thumua", name: "Trần Văn B (kiêm Chỉ huy trưởng)", username: "b", avatarInitial: "T" } },
    );
    expect(result).toHaveLength(1);
    expect(result?.[0].uid).toBe("uid-truong-thumua");
  });

  it("2 ref khác người -> giữ cả 2, không gộp nhầm", async () => {
    const result = await resolveApproverRefs([TRUONG_PHONG_THI_CONG, TRUONG_PHONG_THU_MUA], {
      originalFirstApprover: null,
    });
    expect(result).toEqual([
      { uid: "uid-truong-thicong", name: "Ngô Thị D" },
      { uid: "uid-truong-thumua", name: "Trần Văn B" },
    ]);
  });
});
