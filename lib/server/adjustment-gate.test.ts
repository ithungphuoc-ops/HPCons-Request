import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrgDepartment } from "./hpcore-org";

vi.mock("server-only", () => ({}));

const DEPARTMENTS: OrgDepartment[] = [
  { id: "dept-thicong", name: "Thi công", parentId: null, leaderId: "uid-truong-thicong" },
  { id: "dept-thumua", name: "Thu mua cung ứng ", parentId: null, leaderId: "uid-truong-thumua" },
  { id: "dept-khac", name: "QA-QC", parentId: null, leaderId: "uid-truong-qaqc" },
];

const MEMBERSHIPS: Record<string, { primaryGroupIds: string[]; secondaryGroupIds: string[] }> = {
  "uid-thicong": { primaryGroupIds: ["dept-thicong"], secondaryGroupIds: [] },
  "uid-thumua": { primaryGroupIds: ["dept-thumua"], secondaryGroupIds: [] },
  "uid-khac": { primaryGroupIds: ["dept-khac"], secondaryGroupIds: [] },
  "uid-kiem-nhiem": { primaryGroupIds: ["dept-khac"], secondaryGroupIds: ["dept-thumua"] },
};

const getCachedDepartmentsMock = vi.fn(async () => DEPARTMENTS);
const getScopeMembershipMock = vi.fn(async (uid: string) => MEMBERSHIPS[uid] ?? { primaryGroupIds: [], secondaryGroupIds: [] });
vi.mock("@/lib/server/hpcore-org", () => ({
  getCachedDepartments: getCachedDepartmentsMock,
  getScopeMembership: getScopeMembershipMock,
}));

const userDocs: Record<string, { fullName?: string }> = {
  "uid-truong-thumua": { fullName: "Trần Văn B" },
};
vi.mock("@/lib/hpcore", () => ({
  getHpcoreDb: () => ({
    collection: () => ({
      doc: (uid: string) => ({
        get: async () => ({ data: () => userDocs[uid] }),
      }),
    }),
  }),
}));

const { resolveGateDepartment, resolveAdjustmentApprover } = await import("./adjustment-gate");

describe("resolveGateDepartment", () => {
  beforeEach(() => {
    getCachedDepartmentsMock.mockClear();
    getScopeMembershipMock.mockClear();
  });

  it("uid thuộc phòng Thi công (đơn vị chính) -> thi_cong", async () => {
    expect(await resolveGateDepartment("uid-thicong")).toBe("thi_cong");
  });

  it("uid thuộc phòng Thu mua cung ứng (đơn vị chính, tên có khoảng trắng dư) -> thu_mua_cung_ung", async () => {
    expect(await resolveGateDepartment("uid-thumua")).toBe("thu_mua_cung_ung");
  });

  it("uid thuộc phòng khác -> other", async () => {
    expect(await resolveGateDepartment("uid-khac")).toBe("other");
  });

  it("uid kiêm nhiệm Thu mua cung ứng (secondaryGroupIds) vẫn tính -> thu_mua_cung_ung", async () => {
    expect(await resolveGateDepartment("uid-kiem-nhiem")).toBe("thu_mua_cung_ung");
  });

  it("uid không có trong hệ thống (membership rỗng) -> other, không throw", async () => {
    expect(await resolveGateDepartment("uid-la")).toBe("other");
  });

  it("getScopeMembership ném lỗi -> other, không throw ra ngoài", async () => {
    getScopeMembershipMock.mockRejectedValueOnce(new Error("Firestore lỗi"));
    await expect(resolveGateDepartment("uid-thicong")).resolves.toBe("other");
  });
});

describe("resolveAdjustmentApprover", () => {
  it("thi_cong -> Trưởng phòng Thu mua cung ứng (tra leaderId + tên thật)", async () => {
    const result = await resolveAdjustmentApprover("thi_cong", { originalFirstApprover: null });
    expect(result).toEqual({ approverUid: "uid-truong-thumua", approverName: "Trần Văn B" });
  });

  it("thu_mua_cung_ung -> originalFirstApprover của đề xuất (Chỉ huy trưởng)", async () => {
    const result = await resolveAdjustmentApprover("thu_mua_cung_ung", {
      originalFirstApprover: { id: "uid-chi-huy", name: "Lê Văn C", username: "c", avatarInitial: "L" },
    });
    expect(result).toEqual({ approverUid: "uid-chi-huy", approverName: "Lê Văn C" });
  });

  it("thu_mua_cung_ung nhưng đề xuất không có originalFirstApprover -> null (fallback)", async () => {
    const result = await resolveAdjustmentApprover("thu_mua_cung_ung", { originalFirstApprover: undefined });
    expect(result).toBeNull();
  });

  it("thi_cong nhưng phòng Thu mua cung ứng không có leaderId -> null (fallback)", async () => {
    getCachedDepartmentsMock.mockResolvedValueOnce([
      { id: "dept-thumua", name: "Thu mua cung ứng", parentId: null, leaderId: null },
    ]);
    const result = await resolveAdjustmentApprover("thi_cong", { originalFirstApprover: null });
    expect(result).toBeNull();
  });
});
