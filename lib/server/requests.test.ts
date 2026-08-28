import { describe, expect, it, vi } from "vitest";

// "server-only" chỉ có tác dụng chặn import nhầm ở BUNDLE CLIENT qua webpack
// của Next — dưới vitest (chạy thẳng bằng Node/jsdom) nó throw ngay khi import
// vì tưởng đang ở "client". Mock rỗng để test được, không ảnh hưởng hành vi
// thật lúc build (file gốc `lib/server/requests.ts` vẫn giữ nguyên
// `import "server-only"`, chỉ mock trong phạm vi test này).
vi.mock("server-only", () => ({}));

// Stub Firestore hpcore hoàn toàn — resolveApproverStepsDetailed() gọi
// getHpcoreDb() qua withTitle()/resolveManagerOverride() để tra chức danh/
// quản lý trực tiếp. Test này KHÔNG cần dữ liệu thật, chỉ cần không throw và
// không gọi mạng thật (repo chưa có pattern mock Firestore cho lib/server/
// requests.ts trước đây — file này thêm mock tối thiểu, không đụng gì khác).
vi.mock("@/lib/hpcore", () => ({
  getHpcoreDb: () => ({
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: false, data: () => undefined }),
      }),
    }),
  }),
}));

const {
  resolveApproverStepsDetailed,
  resolveApproverSteps,
  resolveInitialSlaHours,
  recomputeDeadlineForNextStep,
  MissingApproverError,
} = await import("./requests");

import type { ApproverStepDef, ProposalGroup, TaggedUser } from "@/lib/types";

const userA: TaggedUser = { id: "uA", name: "Nguyễn A", username: "a", avatarInitial: "A" };
const userB: TaggedUser = { id: "uB", name: "Trần B", username: "b", avatarInitial: "B" };

function fixedStep(user: TaggedUser, extra: Partial<Extract<ApproverStepDef, { kind: "fixed" }>> = {}) {
  return { kind: "fixed" as const, user, users: [user], ...extra };
}

function flexibleStep(
  name: string,
  users: TaggedUser[],
  extra: Partial<Extract<ApproverStepDef, { kind: "flexible_approver" }>> = {},
) {
  return { kind: "flexible_approver" as const, name, users, ...extra };
}

function group(overrides: Partial<ProposalGroup> = {}): ProposalGroup {
  return {
    id: "g1",
    name: "Nhóm test",
    description: "",
    category: "test",
    status: "active",
    approvalFlow: "sequential",
    slaHours: 24,
    notifyManager: false,
    usedFor: [],
    approverSteps: [],
    followers: [],
    fields: [],
    pinned: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("resolveApproverStepsDetailed — bước flexible_approver", () => {
  it("bỏ qua hoàn toàn bước linh động rỗng (không đẩy phần tử lỗi/null nào)", async () => {
    const steps: ApproverStepDef[] = [flexibleStep("QL BP", []), fixedStep(userA)];
    const detailed = await resolveApproverStepsDetailed(steps, "submitter1");
    // Chỉ có ĐÚNG 1 kết quả — của bước "fixed" — bước linh động rỗng biến mất
    // hoàn toàn khỏi danh sách, không phải 1 phần tử user:null.
    expect(detailed).toHaveLength(1);
    expect(detailed[0].kind).toBe("fixed");
    expect(detailed[0].user?.id).toBe(userA.id);
  });

  it("bước linh động CÓ người thì trả đủ, kèm name", async () => {
    const steps: ApproverStepDef[] = [flexibleStep("QL BP", [userA, userB])];
    const detailed = await resolveApproverStepsDetailed(steps, "submitter1");
    expect(detailed).toHaveLength(2);
    expect(detailed.every((d) => d.name === "QL BP")).toBe(true);
    expect(detailed.map((d) => d.user?.id).sort()).toEqual([userA.id, userB.id].sort());
  });
});

describe("resolveApproverStepsDetailed — bước flexible_approver có submitterAssigns", () => {
  it("chưa chọn ai → LỖI bắt buộc chọn (khác hẳn bước rỗng thường bị bỏ qua)", async () => {
    const steps: ApproverStepDef[] = [flexibleStep("CHT", [], { submitterAssigns: true })];
    const detailed = await resolveApproverStepsDetailed(steps, "submitter1");
    expect(detailed).toHaveLength(1);
    expect(detailed[0].user).toBeNull();
    expect(detailed[0].error).toMatch(/Vui lòng chọn người duyệt/);
  });

  it("có giới hạn danh sách — chọn người NGOÀI danh sách → lỗi, không lọt qua", async () => {
    const steps: ApproverStepDef[] = [flexibleStep("CHT", [userA], { submitterAssigns: true })];
    const detailed = await resolveApproverStepsDetailed(steps, "submitter1", {}, [], { 0: [userB.id] });
    expect(detailed).toHaveLength(1);
    expect(detailed[0].user).toBeNull();
    expect(detailed[0].error).toMatch(/không nằm trong danh sách được phép/);
  });

  it("không giới hạn danh sách (users rỗng) — người gửi chọn ai cũng được xét (không bị chặn bởi allowedIds)", async () => {
    const steps: ApproverStepDef[] = [flexibleStep("CHT", [], { submitterAssigns: true })];
    // Mock Firestore trong file này luôn trả "không tồn tại" (xem đầu file) —
    // nên kết quả là lỗi "không tìm thấy", KHÔNG PHẢI lỗi "ngoài danh sách
    // được phép" — đúng là điều cần xác nhận ở test này: không giới hạn thì
    // không bị chặn bởi allowedIds, request đi tiếp tới bước tra người dùng.
    const detailed = await resolveApproverStepsDetailed(steps, "submitter1", {}, [], { 0: [userB.id] });
    expect(detailed).toHaveLength(1);
    expect(detailed[0].user).toBeNull();
    expect(detailed[0].error).toMatch(/Không tìm thấy người dùng được chọn/);
  });

  it("uid trùng lặp trong lựa chọn của người gửi → chỉ xét 1 lần, không đẩy 2 kết quả cho cùng 1 người", async () => {
    const steps: ApproverStepDef[] = [flexibleStep("CHT", [], { submitterAssigns: true })];
    const detailed = await resolveApproverStepsDetailed(steps, "submitter1", {}, [], { 0: [userB.id, userB.id] });
    // Không phải 2 (dù overrideIds gửi lên có 2 phần tử trùng nhau).
    expect(detailed).toHaveLength(1);
  });
});

describe("resolveApproverSteps — chặn gửi khi không còn ai duyệt", () => {
  it("mọi bước đều là linh động rỗng → throw MissingApproverError", async () => {
    const steps: ApproverStepDef[] = [flexibleStep("QL BP", []), flexibleStep("TP/GĐ", [])];
    await expect(resolveApproverSteps(steps, "submitter1")).rejects.toBeInstanceOf(MissingApproverError);
  });

  it("còn ít nhất 1 bước có người (fixed) dù bước linh động khác rỗng → vẫn gửi được", async () => {
    const steps: ApproverStepDef[] = [flexibleStep("QL BP", []), fixedStep(userA)];
    const approvers = await resolveApproverSteps(steps, "submitter1");
    expect(approvers.map((u) => u.id)).toEqual([userA.id]);
  });

  it("không có bước nào cả (mảng rỗng) → không throw, trả mảng rỗng (hành vi cũ, không đổi)", async () => {
    const approvers = await resolveApproverSteps([], "submitter1");
    expect(approvers).toEqual([]);
  });
});

describe("resolveInitialSlaHours — quan hệ approverSlaEnabled / slaHours riêng bước", () => {
  it("approverSlaEnabled tắt → luôn dùng group.slaHours, dù bước có slaHours riêng", () => {
    const g = group({
      slaHours: 24,
      approverSlaEnabled: false,
      approverSteps: [fixedStep(userA, { slaHours: 4 })],
    });
    expect(resolveInitialSlaHours(g)).toBe(24);
  });

  it("approverSlaEnabled bật VÀ bước đầu có slaHours → dùng slaHours của bước đầu", () => {
    const g = group({
      slaHours: 24,
      approverSlaEnabled: true,
      approverSteps: [fixedStep(userA, { slaHours: 4 }), fixedStep(userB, { slaHours: 99 })],
    });
    expect(resolveInitialSlaHours(g)).toBe(4);
  });

  it("approverSlaEnabled bật NHƯNG bước đầu không có slaHours riêng → rơi về group.slaHours", () => {
    const g = group({
      slaHours: 24,
      approverSlaEnabled: true,
      approverSteps: [fixedStep(userA)],
    });
    expect(resolveInitialSlaHours(g)).toBe(24);
  });

  it("nhóm cũ không có approverSlaEnabled/slaHours ở bước nào → giống hệt hành vi cũ", () => {
    const g = group({ slaHours: 24, approverSteps: [fixedStep(userA)] });
    expect(resolveInitialSlaHours(g)).toBe(24);
  });
});

describe("recomputeDeadlineForNextStep — tính lại deadline khi qua bước tiếp theo", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");

  it("bỏ qua (undefined) nếu approverSlaEnabled tắt", () => {
    const result = recomputeDeadlineForNextStep({
      approvalFlow: "sequential",
      status: "pending",
      approvers: [
        { id: "uA", decision: "approved" },
        { id: "uB", decision: "pending" },
      ],
      approverStepMeta: [{ slaHours: 4 }, { slaHours: 8 }],
      approverSlaEnabled: false,
      groupSlaHours: 24,
      slaByWorkCalendar: false,
      now,
    });
    expect(result).toBeUndefined();
  });

  it("bỏ qua nếu luồng không phải 'sequential' (concurrent/single không có khái niệm lượt kế tiếp)", () => {
    const result = recomputeDeadlineForNextStep({
      approvalFlow: "concurrent",
      status: "pending",
      approvers: [
        { id: "uA", decision: "approved" },
        { id: "uB", decision: "pending" },
      ],
      approverStepMeta: [{ slaHours: 4 }, { slaHours: 8 }],
      approverSlaEnabled: true,
      groupSlaHours: 24,
      slaByWorkCalendar: false,
      now,
    });
    expect(result).toBeUndefined();
  });

  it("bỏ qua nếu đề xuất đã xong (approved/rejected) — không còn bước kế tiếp", () => {
    const result = recomputeDeadlineForNextStep({
      approvalFlow: "sequential",
      status: "approved",
      approvers: [
        { id: "uA", decision: "approved" },
        { id: "uB", decision: "approved" },
      ],
      approverStepMeta: [{ slaHours: 4 }, { slaHours: 8 }],
      approverSlaEnabled: true,
      groupSlaHours: 24,
      slaByWorkCalendar: false,
      now,
    });
    expect(result).toBeUndefined();
  });

  it("tính deadline mới theo SLA riêng của bước kế tiếp, TỪ THỜI ĐIỂM HIỆN TẠI (không cộng dồn)", () => {
    const result = recomputeDeadlineForNextStep({
      approvalFlow: "sequential",
      status: "pending",
      approvers: [
        { id: "uA", decision: "approved" },
        { id: "uB", decision: "pending" },
      ],
      approverStepMeta: [{ slaHours: 4 }, { slaHours: 8 }],
      approverSlaEnabled: true,
      groupSlaHours: 24,
      slaByWorkCalendar: false,
      now,
    });
    expect(result).toBe(new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString());
  });

  it("bước kế tiếp không có SLA riêng → rơi về SLA chung của nhóm", () => {
    const result = recomputeDeadlineForNextStep({
      approvalFlow: "sequential",
      status: "pending",
      approvers: [
        { id: "uA", decision: "approved" },
        { id: "uB", decision: "pending" },
      ],
      approverStepMeta: [{ slaHours: 4 }, {}],
      approverSlaEnabled: true,
      groupSlaHours: 24,
      slaByWorkCalendar: false,
      now,
    });
    expect(result).toBe(new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString());
  });
});
