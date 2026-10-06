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

// findInvalidExternalCodeFields (qua lib/external-code-sources.ts) gọi
// loadContractCodeSuggestions()/loadSubcontractorCodeSuggestions() — mock dữ
// liệu giả cố định cho cả 2 nguồn, đủ để test luật khớp/không khớp mà không
// cần Firestore thật của app Công nợ.
const mockContracts = [
  { code: "01/2026/HĐXD-HPCS", project: "HOWELL", work: "", customerName: "", customerNameShort: "" },
  { code: "02/2026/HĐXD-HPCS", project: "CHENKAI-PS", work: "", customerName: "", customerNameShort: "" },
];
const mockSubcontractors = [
  { ma: "4001094696", mst: "4001094696", ten: "Comin An An Hòa", tenVietTat: "An An Hòa", diaChi: "" },
  // Nhà thầu tự thêm lúc Ký kết — chỉ có mst, không có ma.
  { ma: "", mst: "0317927805", ten: "Cơ khí Minh Phúc", tenVietTat: "", diaChi: "" },
];
// ★ (03/10/2026) Bản "đọc thẳng" (bỏ qua nhớ tạm) — mặc định trả y bản nhớ tạm;
// test lưới tự lành gán thêm mã mới vào `mockContractsMoi` để giả lập Công nợ
// vừa thêm hợp đồng mà báo thay đổi bị trượt (nhớ tạm còn bản cũ).
const mockContractsMoi: typeof mockContracts = [];
const docLaiHopDongCongNo = vi.fn(async () => [...mockContracts, ...mockContractsMoi]);
const docLaiNhaThauPhuCongNo = vi.fn(async () => mockSubcontractors);
vi.mock("@/lib/congno", () => ({
  loadContractCodeSuggestions: async () => mockContracts,
  loadSubcontractorCodeSuggestions: async () => mockSubcontractors,
  docLaiHopDongCongNo: () => docLaiHopDongCongNo(),
  docLaiNhaThauPhuCongNo: () => docLaiNhaThauPhuCongNo(),
}));

const {
  resolveApproverStepsDetailed,
  resolveApproverSteps,
  resolveInitialSlaHours,
  recomputeDeadlineForNextStep,
  findInvalidExternalCodeFields,
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

function contractCodeField(overrides: Partial<import("@/lib/types").ProposalField> = {}) {
  return {
    id: "f1",
    name: "Số Hợp Đồng CĐT",
    dataType: "short_text" as const,
    required: false,
    order: 0,
    // Cờ CŨ (contractCodeLookup) — cố ý dùng cờ cũ ở đây (không phải
    // externalCodeLookup) để test luôn PHỦ ĐƯỢC đường tương thích ngược
    // (field trên production chưa migrate) — xem Decision 8 design.md của
    // change add-external-code-lookup-picker.
    contractCodeLookup: true,
    ...overrides,
  };
}

function subcontractorCodeField(
  matchField: "ma" | "mst" | "ten" | "tenVietTat",
  overrides: Partial<import("@/lib/types").ProposalField> = {},
) {
  return {
    id: "f2",
    name: "Mã nhà thầu phụ",
    dataType: "short_text" as const,
    required: false,
    order: 0,
    externalCodeLookup: { sourceId: "congno_subcontractors" as const, matchField },
    ...overrides,
  };
}

describe("findInvalidExternalCodeFields", () => {
  it("giá trị khớp đúng 1 hợp đồng thật (field cũ contractCodeLookup) → không báo lỗi", async () => {
    const fields = [contractCodeField()];
    const result = await findInvalidExternalCodeFields(fields, { f1: "01/2026/HĐXD-HPCS" });
    expect(result).toHaveLength(0);
  });

  it("giá trị không khớp hợp đồng nào → báo lỗi đúng field", async () => {
    const fields = [contractCodeField()];
    const result = await findInvalidExternalCodeFields(fields, { f1: "SO-BAY-VU" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("f1");
  });

  it("field không bật ràng buộc nào → bỏ qua dù giá trị sai", async () => {
    const fields = [contractCodeField({ contractCodeLookup: false })];
    const result = await findInvalidExternalCodeFields(fields, { f1: "SO-BAY-VU" });
    expect(result).toHaveLength(0);
  });

  it("giá trị rỗng (kể cả required) → bỏ qua, không phải lỗi của luật này", async () => {
    const fields = [contractCodeField({ required: true })];
    const result = await findInvalidExternalCodeFields(fields, { f1: "" });
    expect(result).toHaveLength(0);
  });

  it("field bị ẩn (visibleWhen không thoả) → bỏ qua dù giá trị sai", async () => {
    const fields = [
      contractCodeField({
        visibleWhen: { conjunction: "all", rules: [{ fieldCode: "khac", operator: "equals", value: "x" }] },
      }),
    ];
    const result = await findInvalidExternalCodeFields(fields, { f1: "SO-BAY-VU" });
    expect(result).toHaveLength(0);
  });

  it("giá trị không phải string (client gửi sai kiểu) → coi là không khớp", async () => {
    const fields = [contractCodeField()];
    const result = await findInvalidExternalCodeFields(fields, { f1: 12345 });
    expect(result).toHaveLength(1);
  });

  // Cấp D — Sếp chốt 30/09/2026: Admin chọn TƯỜNG MINH đúng 1 field để khớp
  // (thay bản đầu "khớp 1 trong nhiều field" dễ gây nhầm không biết field nào
  // đang thật sự dùng) — mỗi field cấu hình CHỈ khớp theo ĐÚNG `matchField`
  // đã chọn, không còn tự động thử các field khác của cùng nguồn.

  it("khớp theo Mã NCC (matchField=ma) → không báo lỗi", async () => {
    const fields = [subcontractorCodeField("ma")];
    const result = await findInvalidExternalCodeFields(fields, { f2: "4001094696" });
    expect(result).toHaveLength(0);
  });

  it("field khớp theo Mã NCC (ma) mà gõ đúng MST lại → vẫn báo lỗi (không còn khớp chéo field khác)", async () => {
    const fields = [subcontractorCodeField("ma")];
    // Nhà thầu "Cơ khí Minh Phúc" không có `ma`, chỉ có `mst` — field này chỉ
    // khớp theo `ma`, nên gõ đúng mst của nó vẫn phải bị chặn.
    const result = await findInvalidExternalCodeFields(fields, { f2: "0317927805" });
    expect(result).toHaveLength(1);
  });

  it("khớp theo MST/CCCD (matchField=mst) → không báo lỗi", async () => {
    const fields = [subcontractorCodeField("mst")];
    const result = await findInvalidExternalCodeFields(fields, { f2: "0317927805" });
    expect(result).toHaveLength(0);
  });

  it("khớp theo Tên nhà cung cấp (matchField=ten) → không báo lỗi (Sếp phản hồi 30/09/2026: field 'Tên nhà thầu phụ đề xuất' cần chọn/gõ theo tên)", async () => {
    const fields = [subcontractorCodeField("ten")];
    const result = await findInvalidExternalCodeFields(fields, { f2: "Cơ khí Minh Phúc" });
    expect(result).toHaveLength(0);
  });

  it("khớp theo Tên viết tắt (matchField=tenVietTat) → không báo lỗi", async () => {
    const fields = [subcontractorCodeField("tenVietTat")];
    const result = await findInvalidExternalCodeFields(fields, { f2: "An An Hòa" });
    expect(result).toHaveLength(0);
  });

  it("giá trị không tồn tại trong field đã chọn → báo lỗi đúng field", async () => {
    const fields = [subcontractorCodeField("ten")];
    const result = await findInvalidExternalCodeFields(fields, { f2: "khong-ton-tai" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("f2");
  });

  it("2 field khác nguồn cùng lúc — chỉ báo lỗi field thật sự sai", async () => {
    const fields = [contractCodeField(), subcontractorCodeField("ten")];
    const result = await findInvalidExternalCodeFields(fields, {
      f1: "01/2026/HĐXD-HPCS", // đúng
      f2: "sai-hoan-toan", // sai
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("f2");
  });

  // ★ (03/10/2026, QA đợt 2) Nhớ tạm Công nợ 12 giờ — lưới tự lành.
  it("mã khớp ngay trong nhớ tạm → KHÔNG đọc thẳng nguồn (không tốn lượt đọc)", async () => {
    docLaiHopDongCongNo.mockClear();
    const result = await findInvalidExternalCodeFields([contractCodeField()], { f1: "01/2026/HĐXD-HPCS" });
    expect(result).toHaveLength(0);
    expect(docLaiHopDongCongNo).not.toHaveBeenCalled();
  });

  it("hợp đồng vừa thêm bên Công nợ, nhớ tạm chưa có (báo bị trượt) → đọc thẳng rồi cho qua, không chặn oan", async () => {
    docLaiHopDongCongNo.mockClear();
    mockContractsMoi.push({ code: "03/2026/HĐXD-HPCS", project: "MOI", work: "", customerName: "", customerNameShort: "" });
    try {
      const result = await findInvalidExternalCodeFields([contractCodeField()], { f1: "03/2026/HĐXD-HPCS" });
      expect(result).toHaveLength(0);
      expect(docLaiHopDongCongNo).toHaveBeenCalledTimes(1);
    } finally {
      mockContractsMoi.length = 0;
    }
  });

  it("đọc thẳng rồi vẫn không có → vẫn chặn", async () => {
    docLaiHopDongCongNo.mockClear();
    const result = await findInvalidExternalCodeFields([contractCodeField()], { f1: "SO-BAY-VU" });
    expect(result).toHaveLength(1);
    expect(docLaiHopDongCongNo).toHaveBeenCalledTimes(1);
  });

  it("giá trị sai kiểu (không phải chuỗi) → chặn luôn, không tốn lượt đọc thẳng", async () => {
    docLaiHopDongCongNo.mockClear();
    const result = await findInvalidExternalCodeFields([contractCodeField()], { f1: 12345 });
    expect(result).toHaveLength(1);
    expect(docLaiHopDongCongNo).not.toHaveBeenCalled();
  });
});

describe("collectAttachmentPaths — tệp đã gỡ/đã thay (Sửa tệp đính kèm khi duyệt)", () => {
  it("mặc định ẩn tệp đã gỡ khỏi danh sách tải; Owner/Admin (includeRemoved) vẫn tải được", async () => {
    const { collectAttachmentPaths } = await import("./requests");
    const req = {
      values: { f1: [{ name: "a.pdf", path: "requests/u1/1-a.pdf", size: 1 }] },
      attachments: [
        { name: "b.pdf", path: "requests/u2/2-b.pdf", size: 1, source: "decision", removedAt: "2026-10-06T00:00:00.000Z" },
        { name: "c.pdf", path: "requests/u2/3-c.pdf", size: 1, source: "decision" },
      ],
    } as unknown as Parameters<typeof collectAttachmentPaths>[0];
    expect([...collectAttachmentPaths(req)].sort()).toEqual(["requests/u1/1-a.pdf", "requests/u2/3-c.pdf"]);
    expect(collectAttachmentPaths(req, { includeRemoved: true }).has("requests/u2/2-b.pdf")).toBe(true);
  });
});

describe("canView — người duyệt Điều chỉnh sau duyệt (06/10/2026)", () => {
  const base = {
    id: "r1",
    status: "approved",
    submittedBy: { uid: "owner", name: "Chủ" },
    approversSnapshot: [{ id: "a1", name: "A1", username: "a1", avatarInitial: "A" }],
    followers: [],
    values: {},
    attachments: [],
  } as unknown as import("@/lib/types").RequestInstance;

  it("người KHÔNG liên quan → không xem được", async () => {
    const { canView } = await import("./requests");
    expect(canView(base, "x", "employee")).toBe(false);
  });

  it("đang nằm trong pendingAdjustment.approvers (kể cả được chuyển tiếp tới, kể cả pending kiểu cũ) → xem được", async () => {
    const { canView } = await import("./requests");
    const req = {
      ...base,
      pendingAdjustment: {
        noiDung: "x",
        attachment: null,
        requestedByUid: "owner",
        requestedByName: "Chủ",
        createdAt: "t",
        approvers: [{ uid: "rv1", name: "RV1", approvedAt: null }],
      },
    };
    expect(canView(req, "rv1", "employee")).toBe(true);
    expect(canView(req, "rv2", "employee")).toBe(false);
  });

  it("từng được giao (adjustmentReviewerUids) → vẫn xem được sau khi điều chỉnh xong", async () => {
    const { canView } = await import("./requests");
    const req = { ...base, pendingAdjustment: null, adjustmentReviewerUids: ["rv1"] };
    expect(canView(req, "rv1", "employee")).toBe(true);
  });

  it("tải tệp của điều chỉnh ĐANG CHỜ được (collectAttachmentPaths gồm cả dạng cũ 1 tệp và dạng mới nhiều tệp)", async () => {
    const { collectAttachmentPaths } = await import("./requests");
    const legacy = {
      ...base,
      pendingAdjustment: {
        noiDung: "", attachment: { name: "a.pdf", path: "requests/owner/1-a.pdf", size: 1 },
        requestedByUid: "owner", requestedByName: "Chủ", createdAt: "t", approvers: [],
      },
    };
    expect(collectAttachmentPaths(legacy).has("requests/owner/1-a.pdf")).toBe(true);
    const multi = {
      ...base,
      pendingAdjustment: {
        noiDung: "", attachment: null,
        attachments: [
          { name: "b.pdf", path: "requests/owner/2-b.pdf", size: 1 },
          { name: "c.pdf", path: "requests/owner/3-c.pdf", size: 1 },
        ],
        requestedByUid: "owner", requestedByName: "Chủ", createdAt: "t", approvers: [],
      },
    };
    const paths = collectAttachmentPaths(multi);
    expect(paths.has("requests/owner/2-b.pdf")).toBe(true);
    expect(paths.has("requests/owner/3-c.pdf")).toBe(true);
  });
});
