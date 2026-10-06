import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sendMailMock = vi.fn().mockResolvedValue(true);
const resolveUserEmailMock = vi.fn(async (uid: string) => `${uid}@hpcons.com.vn`);

vi.mock("@/lib/server/mailer", () => ({
  sendMail: sendMailMock,
  resolveUserEmail: resolveUserEmailMock,
  buildRequestEmailHtml: () => "<p>html</p>",
  // escapeHtml thật — không cần giả, hàm này thuần/không phụ thuộc gì (đã
  // có test riêng ở mailer.test.ts), chỉ cần không undefined khi bị import.
  escapeHtml: (value: string) => value,
}));

const {
  notifyPendingApprovers,
  notifySubmitterResult,
  notifyFollowersSubmitted,
  notifyFollowersFullyApproved,
  notifySubmitterReturned,
  notifyAdjustmentRequesterResult,
} = await import("./notification-emails");

import type { RequestInstance, TaggedUser } from "@/lib/types";

function user(id: string): TaggedUser {
  return { id, name: id, username: id, avatarInitial: id[0].toUpperCase() };
}

function baseRequest(overrides: Partial<RequestInstance> = {}): RequestInstance {
  return {
    id: "r1",
    code: "000000001",
    groupId: "g1",
    groupNameSnapshot: "Nhóm test",
    fieldsSnapshot: [],
    values: {},
    submittedBy: { uid: "submitter", email: "submitter@hpcons.com.vn", name: "Người gửi" },
    submittedAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    approvalFlow: "sequential",
    approversSnapshot: [user("uA"), user("uB")],
    approverStepMeta: undefined,
    approvers: [
      { id: "uA", decision: "pending" },
      { id: "uB", decision: "pending" },
    ],
    followers: [],
    status: "pending",
    deadlineAt: null,
    history: [],
    comments: [],
    deletedAt: null,
    ...overrides,
  } as RequestInstance;
}

describe("notifyPendingApprovers — chỉ gửi khi bật cờ, đúng người đang tới lượt", () => {
  it("emailNotify tắt (mặc định) → không gửi gì cả", async () => {
    sendMailMock.mockClear();
    await notifyPendingApprovers(baseRequest(), { notificationRules: undefined });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("luồng 'sequential' + sequentialTurnBasedNotify bật → CHỈ báo người đầu tiên đang pending", async () => {
    sendMailMock.mockClear();
    await notifyPendingApprovers(baseRequest(), {
      notificationRules: { sequentialTurnBasedNotify: true, perStepBlockNotify: true, emailNotify: true },
    });
    expect(resolveUserEmailMock).toHaveBeenCalledWith("uA", { groupId: "g1", category: "approver_pending" });
    expect(resolveUserEmailMock).not.toHaveBeenCalledWith("uB", { groupId: "g1", category: "approver_pending" });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("luồng 'sequential' + sequentialTurnBasedNotify tắt → không báo ai", async () => {
    sendMailMock.mockClear();
    resolveUserEmailMock.mockClear();
    await notifyPendingApprovers(baseRequest(), {
      notificationRules: { sequentialTurnBasedNotify: false, perStepBlockNotify: true, emailNotify: true },
    });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("luồng 'concurrent' + perStepBlockNotify bật → báo TẤT CẢ người còn pending", async () => {
    sendMailMock.mockClear();
    resolveUserEmailMock.mockClear();
    await notifyPendingApprovers(baseRequest({ approvalFlow: "concurrent" }), {
      notificationRules: { sequentialTurnBasedNotify: true, perStepBlockNotify: true, emailNotify: true },
    });
    expect(resolveUserEmailMock).toHaveBeenCalledWith("uA", { groupId: "g1", category: "approver_pending" });
    expect(resolveUserEmailMock).toHaveBeenCalledWith("uB", { groupId: "g1", category: "approver_pending" });
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });
});

describe("notifySubmitterResult — báo người tạo khi xong, không phụ thuộc 2 cờ turn-based/block", () => {
  it("còn pending → không gửi", async () => {
    sendMailMock.mockClear();
    await notifySubmitterResult(baseRequest({ status: "pending" }), {
      notificationRules: { sequentialTurnBasedNotify: false, perStepBlockNotify: false, emailNotify: true },
    });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("approved, dù 2 cờ turn-based/block đều tắt → vẫn báo người tạo", async () => {
    sendMailMock.mockClear();
    resolveUserEmailMock.mockClear();
    await notifySubmitterResult(baseRequest({ status: "approved" }), {
      notificationRules: { sequentialTurnBasedNotify: false, perStepBlockNotify: false, emailNotify: true },
    });
    expect(resolveUserEmailMock).toHaveBeenCalledWith("submitter", { groupId: "g1", category: "own_decided" });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});

describe("notifyFollowersSubmitted / notifyFollowersFullyApproved", () => {
  it("gửi cho mọi người theo dõi lúc gửi đề xuất", async () => {
    sendMailMock.mockClear();
    resolveUserEmailMock.mockClear();
    const followers = [user("f1"), user("f2")];
    await notifyFollowersSubmitted(followers, baseRequest(), {
      notificationRules: { sequentialTurnBasedNotify: true, perStepBlockNotify: true, emailNotify: true },
    });
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it("chỉ gửi cho người theo dõi khi status = approved", async () => {
    sendMailMock.mockClear();
    resolveUserEmailMock.mockClear();
    const req = baseRequest({ status: "rejected", followers: [user("f1")] });
    await notifyFollowersFullyApproved(req, {
      notificationRules: { sequentialTurnBasedNotify: true, perStepBlockNotify: true, emailNotify: true },
    });
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("group = null (đề xuất trực tiếp) mặc định BẬT — khác 'nhóm thật chưa cấu hình' (Sếp chốt 06/10/2026)", () => {
  it("group = null → vẫn gửi dù không có notificationRules nào để đọc", async () => {
    sendMailMock.mockClear();
    await notifySubmitterResult(baseRequest({ status: "approved", groupId: null }), null);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("group = { notificationRules: undefined } (nhóm thật nhưng chưa cấu hình) → vẫn TẮT như trước", async () => {
    sendMailMock.mockClear();
    await notifySubmitterResult(baseRequest({ status: "approved" }), { notificationRules: undefined });
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("notifySubmitterReturned — Đợt 3 Email, báo người tạo khi bị trả lại", () => {
  it("emailNotify tắt → không gửi", async () => {
    sendMailMock.mockClear();
    await notifySubmitterReturned(baseRequest({ status: "returned" }), { notificationRules: undefined }, "thiếu chứng từ");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("emailNotify bật → báo đúng người tạo đề xuất", async () => {
    sendMailMock.mockClear();
    resolveUserEmailMock.mockClear();
    await notifySubmitterReturned(
      baseRequest({ status: "returned" }),
      { notificationRules: { sequentialTurnBasedNotify: true, perStepBlockNotify: true, emailNotify: true } },
      "thiếu chứng từ",
    );
    expect(resolveUserEmailMock).toHaveBeenCalledWith("submitter", { groupId: "g1", category: "own_decided" });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("đề xuất trực tiếp (group = null) → mặc định BẬT, kể cả không có lý do", async () => {
    sendMailMock.mockClear();
    await notifySubmitterReturned(baseRequest({ status: "returned", groupId: null }), null, undefined);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});

describe("notifyAdjustmentRequesterResult — Đợt 3 Email, báo người đã đề nghị điều chỉnh", () => {
  it("emailNotify tắt → không gửi", async () => {
    sendMailMock.mockClear();
    await notifyAdjustmentRequesterResult(baseRequest(), { notificationRules: undefined }, "approved", "nguoiDeNghi");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("approved → báo đúng người đã đề nghị điều chỉnh (không phải người tạo đề xuất gốc)", async () => {
    sendMailMock.mockClear();
    resolveUserEmailMock.mockClear();
    await notifyAdjustmentRequesterResult(
      baseRequest(),
      { notificationRules: { sequentialTurnBasedNotify: true, perStepBlockNotify: true, emailNotify: true } },
      "approved",
      "nguoiDeNghi",
    );
    expect(resolveUserEmailMock).toHaveBeenCalledWith("nguoiDeNghi", { groupId: "g1", category: "own_decided" });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("rejected → vẫn báo đúng người, chỉ khác nội dung/tiêu đề", async () => {
    sendMailMock.mockClear();
    resolveUserEmailMock.mockClear();
    await notifyAdjustmentRequesterResult(
      baseRequest(),
      { notificationRules: { sequentialTurnBasedNotify: true, perStepBlockNotify: true, emailNotify: true } },
      "rejected",
      "nguoiDeNghi",
    );
    expect(resolveUserEmailMock).toHaveBeenCalledWith("nguoiDeNghi", { groupId: "g1", category: "own_decided" });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });
});
