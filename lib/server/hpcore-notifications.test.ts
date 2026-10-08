import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/server/mailer", () => ({
  requestDetailUrl: (id: string) => `https://request.hpcons.example/request/requests/${id}`,
}));

const { mockSet, mockCommit, mockBatch, mockCollection } = vi.hoisted(() => {
  const mockSet = vi.fn();
  const mockCommit = vi.fn().mockResolvedValue(undefined);
  const mockBatch = vi.fn(() => ({ set: mockSet, commit: mockCommit }));
  const mockDoc = vi.fn(() => ({ id: "generated-id" }));
  const mockCollection = vi.fn(() => ({ doc: mockDoc }));
  return { mockSet, mockCommit, mockBatch, mockCollection };
});

// Thông báo ra màn hình (08/10/2026, gửi qua App Tổng): chỉ bắt lại danh sách thư định đẩy để
// kiểm nội dung/người nhận — việc dựng gói + gọi App Tổng test riêng ở push-dispatch.test.ts.
const { mockSendWebPush } = vi.hoisted(() => ({ mockSendWebPush: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/server/push-dispatch", () => ({ dispatchPushItems: mockSendWebPush }));

vi.mock("@/lib/hpcore", () => ({
  getHpcoreDb: () => ({ collection: mockCollection, batch: mockBatch }),
}));

const {
  hpcorePendingApprovers,
  hpcoreSubmitterResult,
  hpcoreSubmitterReturned,
  hpcoreFollowersSubmitted,
  hpcoreFollowersFullyApproved,
  hpcoreCommentOnMine,
  hpcoreMentioned,
  hpcoreAdjustmentPending,
  hpcoreAdjustmentResult,
} = await import("./hpcore-notifications");

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

beforeEach(() => {
  mockSet.mockClear();
  mockCommit.mockClear();
  mockBatch.mockClear();
  mockCollection.mockClear();
  mockSendWebPush.mockClear();
});

describe("hpcorePendingApprovers — đúng người đang tới lượt, không phụ thuộc công tắc nhóm", () => {
  it("luồng sequential → chỉ người đầu tiên đang pending", async () => {
    await hpcorePendingApprovers(baseRequest());
    expect(mockCollection).toHaveBeenCalledWith("notifications");
    expect(mockSet).toHaveBeenCalledTimes(1);
    const payload = mockSet.mock.calls[0][1];
    expect(payload).toMatchObject({
      userId: "uA",
      title: "Đang chờ bạn duyệt",
      type: "de_xuat",
      isRead: false,
      link: "https://request.hpcons.example/request/requests/r1",
    });
    expect(payload.body).toContain("Nhóm test");
    expect(payload.body).toContain("000000001");
  });

  it("không ai đang tới lượt → không ghi gì, không gọi batch/commit", async () => {
    await hpcorePendingApprovers(
      baseRequest({ approvers: [{ id: "uA", decision: "approved" }, { id: "uB", decision: "approved" }] }),
    );
    expect(mockBatch).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("luồng concurrent → báo TẤT CẢ người còn pending", async () => {
    await hpcorePendingApprovers(baseRequest({ approvalFlow: "concurrent" }));
    expect(mockSet).toHaveBeenCalledTimes(2);
  });
});

describe("hpcoreSubmitterResult", () => {
  it("còn pending → không ghi", async () => {
    await hpcoreSubmitterResult(baseRequest({ status: "pending" }));
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("approved → báo đúng người tạo, tiêu đề đúng", async () => {
    await hpcoreSubmitterResult(baseRequest({ status: "approved" }));
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0][1]).toMatchObject({ userId: "submitter", title: "Đã được chấp thuận" });
  });

  it("rejected → tiêu đề khác", async () => {
    await hpcoreSubmitterResult(baseRequest({ status: "rejected" }));
    expect(mockSet.mock.calls[0][1]).toMatchObject({ userId: "submitter", title: "Đã bị từ chối" });
  });
});

describe("hpcoreSubmitterReturned", () => {
  it("có lý do → lý do nằm trong nội dung", async () => {
    await hpcoreSubmitterReturned(baseRequest(), "thiếu chứng từ");
    expect(mockSet.mock.calls[0][1].body).toContain("thiếu chứng từ");
  });

  it("không có lý do → vẫn ghi, không crash", async () => {
    await hpcoreSubmitterReturned(baseRequest(), undefined);
    expect(mockSet).toHaveBeenCalledTimes(1);
  });
});

describe("hpcoreFollowersSubmitted / hpcoreFollowersFullyApproved", () => {
  it("danh sách theo dõi rỗng → không ghi", async () => {
    await hpcoreFollowersSubmitted([], baseRequest());
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("có người theo dõi → ghi đủ từng người", async () => {
    await hpcoreFollowersSubmitted([user("f1"), user("f2")], baseRequest());
    expect(mockSet).toHaveBeenCalledTimes(2);
  });

  it("chưa approved → không báo người theo dõi", async () => {
    await hpcoreFollowersFullyApproved(baseRequest({ status: "rejected", followers: [user("f1")] }));
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("approved hoàn toàn → báo đủ người theo dõi", async () => {
    await hpcoreFollowersFullyApproved(baseRequest({ status: "approved", followers: [user("f1")] }));
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0][1]).toMatchObject({ userId: "f1", title: "Đề xuất bạn theo dõi đã duyệt xong" });
  });
});

describe("hpcoreCommentOnMine — không tự báo cho chính người bình luận", () => {
  it("người khác bình luận → báo người tạo", async () => {
    await hpcoreCommentOnMine(baseRequest(), "uA", "Người A");
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet.mock.calls[0][1]).toMatchObject({ userId: "submitter", title: "Có bình luận mới" });
    expect(mockSet.mock.calls[0][1].body).toContain("Người A");
  });

  it("chính người tạo tự bình luận → không báo", async () => {
    await hpcoreCommentOnMine(baseRequest(), "submitter", "Người gửi");
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe("hpcoreMentioned", () => {
  it("danh sách rỗng → không ghi", async () => {
    await hpcoreMentioned(baseRequest(), [], "Người A");
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("có người bị nhắc → báo đủ từng người", async () => {
    await hpcoreMentioned(baseRequest(), ["uA", "uC"], "Người A");
    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet.mock.calls[0][1].title).toBe("Bạn được nhắc tên");
  });
});

describe("hpcoreAdjustmentPending / hpcoreAdjustmentResult", () => {
  it("danh sách rỗng → không ghi", async () => {
    await hpcoreAdjustmentPending(baseRequest(), []);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("có người cần duyệt → báo đủ", async () => {
    await hpcoreAdjustmentPending(baseRequest(), ["uA", "uB"]);
    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet.mock.calls[0][1].title).toBe("Điều chỉnh sau duyệt đang chờ bạn duyệt");
  });

  it("approved → báo đúng người đề nghị, tiêu đề đúng", async () => {
    await hpcoreAdjustmentResult(baseRequest(), "nguoiDeNghi", "approved");
    expect(mockSet.mock.calls[0][1]).toMatchObject({
      userId: "nguoiDeNghi",
      title: "Điều chỉnh sau duyệt đã được chấp thuận",
    });
  });

  it("rejected → tiêu đề khác", async () => {
    await hpcoreAdjustmentResult(baseRequest(), "nguoiDeNghi", "rejected");
    expect(mockSet.mock.calls[0][1].title).toBe("Điều chỉnh sau duyệt đã bị từ chối");
  });
});

describe("Ghi lỗi (mất mạng/thiếu quyền) — không được throw ra ngoài", () => {
  it("batch.commit() lỗi → nuốt lỗi, không ảnh hưởng luồng gọi", async () => {
    mockCommit.mockRejectedValueOnce(new Error("Firestore lỗi"));
    await expect(hpcoreSubmitterResult(baseRequest({ status: "approved" }))).resolves.toBeUndefined();
  });
});

describe("meta (08/10/2026) — gắn kèm mọi thông báo, title/body giữ nguyên", () => {
  it("nhắc tên → meta.kind mentioned + đoạn bình luận, body vẫn là câu cũ", async () => {
    await hpcoreMentioned(baseRequest(), ["uA"], "Người A", "@uA xem giúp");
    const payload = mockSet.mock.calls[0][1];
    expect(payload.title).toBe("Bạn được nhắc tên");
    expect(payload.body).toContain("nhắc bạn trong bình luận đề xuất");
    expect(payload.meta).toEqual({
      v: 1,
      kind: "mentioned",
      headline: "Người A nhắc tới bạn: “@uA xem giúp”",
      actorName: "Người A",
      excerpt: "@uA xem giúp",
      requestCode: "000000001",
      groupName: "Nhóm test",
    });
  });

  it("mọi hàm đều gắn meta có v=1 + đúng kind", async () => {
    await hpcorePendingApprovers(baseRequest());
    await hpcoreSubmitterResult(baseRequest({ status: "rejected" }));
    await hpcoreSubmitterReturned(baseRequest(), "thiếu");
    await hpcoreFollowersSubmitted([user("f1")], baseRequest());
    await hpcoreFollowersFullyApproved(baseRequest({ status: "approved", followers: [user("f1")] }));
    await hpcoreCommentOnMine(baseRequest(), "uA", "Người A", "hi");
    await hpcoreAdjustmentPending(baseRequest(), ["uA"]);
    await hpcoreAdjustmentResult(baseRequest(), "x", "approved");
    await hpcoreAdjustmentResult(baseRequest(), "x", "rejected", "Người B");
    const kinds = mockSet.mock.calls.map((c) => c[1].meta);
    expect(kinds.every((m) => m.v === 1 && m.requestCode === "000000001")).toBe(true);
    expect(kinds.map((m) => m.kind)).toEqual([
      "pending_approval",
      "rejected",
      "returned",
      "follow_submitted",
      "follow_approved",
      "comment_on_mine",
      "adjustment_pending",
      "adjustment_approved",
      "adjustment_rejected",
    ]);
    // Firestore Admin không nhận undefined — meta không được chứa khoá undefined.
    for (const m of kinds) expect(Object.values(m).includes(undefined)).toBe(false);
  });
});

describe("meta lỗi → vẫn ghi thông báo, chỉ bỏ meta", () => {
  it("dựng meta ném lỗi (dữ liệu lạ) → thông báo vẫn ghi với title/body, không có khoá meta", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // fieldsSnapshot không lặp được → resolveRequestTitle ném lỗi trong lúc dựng meta.
    await hpcorePendingApprovers(baseRequest({ fieldsSnapshot: {} as unknown as RequestInstance["fieldsSnapshot"] }));
    expect(mockSet).toHaveBeenCalledTimes(1);
    const payload = mockSet.mock.calls[0][1];
    expect(payload.title).toBe("Đang chờ bạn duyệt");
    expect("meta" in payload).toBe(false);
    expect(mockCommit).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});


describe("Web Push (cấp 3) — 4 nhóm sự kiện, nội dung rõ theo demo 08/10/2026", () => {
  const coTen = () =>
    baseRequest({
      groupNameSnapshot: "1.0. Phiếu đề nghị (HPCons)",
      fieldsSnapshot: [{ id: "f1", code: "ten_de_xuat", label: "Tên đề xuất", type: "short_text", required: false }] as unknown as RequestInstance["fieldsSnapshot"],
      values: { f1: "Mua thép hộp\n40×80" },
    });
  const allPushed = () =>
    mockSendWebPush.mock.calls.flatMap((c) => c[0] as { uid: string; payload: { title: string; body: string; kind: string; actionTitle: string } }[]);

  it("đúng người nhận + loại + actorUid; nội dung có tên đề xuất / trích dẫn (1 dòng)", async () => {
    await hpcorePendingApprovers(coTen(), { actorUid: "submitter" });
    await hpcoreMentioned(coTen(), ["uA", "uC"], "Người A", "Giá 500.000.000\nnhé @uA", { actorUid: "uX" });
    await hpcoreSubmitterResult({ ...coTen(), status: "approved" }, { actorUid: "uB" });
    await hpcoreSubmitterReturned(coTen(), "Bổ sung hình ảnh", { actorUid: "uA" });
    await hpcoreAdjustmentPending(
      { ...coTen(), pendingAdjustment: { noiDung: "Đổi 120 → 90 cây", attachment: null, attachments: [], requestedByUid: "submitter", requestedByName: "Người gửi", createdAt: "", approvers: [] } },
      ["uA"],
      { actorUid: "submitter" },
    );
    await hpcoreAdjustmentResult(coTen(), "submitter", "approved", undefined, { actorUid: "uB", approverCount: 2 });
    expect(mockSendWebPush.mock.calls.map((c) => ({ actorUid: (c[1] as { actorUid?: string }).actorUid }))).toEqual([
      { actorUid: "submitter" },
      { actorUid: "uX" },
      { actorUid: "uB" },
      { actorUid: "uA" },
      { actorUid: "submitter" },
      { actorUid: "uB" },
    ]);
    const items = allPushed();
    expect(items.map((i) => `${i.uid}:${i.payload.kind}`)).toEqual([
      "uA:pending_approval",
      "uA:mentioned",
      "uC:mentioned",
      "submitter:approved",
      "submitter:returned",
      "uA:adjustment_pending",
      "submitter:adjustment_approved",
    ]);
    expect(items[0].payload).toMatchObject({
      title: "⏳ Chờ bạn duyệt — Người gửi gửi",
      body: "Mua thép hộp 40×80\n#000001 · 1.0. Phiếu đề nghị (HPCons)",
      actionTitle: "Mở để duyệt",
    });
    expect(items[1].payload.body).toBe("“Giá 500.000.000 nhé @uA”\n#000001 · 1.0. Phiếu đề nghị (HPCons)");
    expect(items[3].payload.body).toBe("Mua thép hộp 40×80 · #000001");
    expect(items[4].payload).toMatchObject({ actionTitle: "Sửa và gửi lại", url: "/request/groups/g1/submit?draftId=r1" });
    expect(items[4].payload.body.split("\n")[0]).toContain("“Bổ sung hình ảnh”");
    expect(items[5].payload.body.split("\n")[0]).toBe("Người gửi: “Đổi 120 → 90 cây”");
    expect(items[6].payload.body.split("\n")[0]).toBe("Đủ 2/2 người duyệt");
  });

  it("đề xuất TRỰC TIẾP: dòng nhóm là 'Đề xuất trực tiếp', tên tự gõ hiện ở dòng tên đề xuất", async () => {
    const direct = baseRequest({ groupId: null, groupNameSnapshot: "Tạm ứng công tác" });
    await hpcorePendingApprovers(direct, { actorUid: "submitter" });
    expect(allPushed()[0].payload.body).toBe("Tạm ứng công tác\n#000001 · Đề xuất trực tiếp");
  });

  it("bình luận trên đề xuất của tôi → đẩy loại comment_on_mine, không đẩy cho chính người bình luận", async () => {
    await hpcoreCommentOnMine(coTen(), "uA", "Lê Văn C", "Đã nhận hàng đợt 1", { actorUid: "uA", mentionedUids: [] });
    expect(allPushed()).toEqual([
      expect.objectContaining({ uid: "submitter", payload: expect.objectContaining({ kind: "comment_on_mine", title: "💬 Lê Văn C bình luận đề xuất của bạn" }) }),
    ]);
    mockSendWebPush.mockClear();
    await hpcoreCommentOnMine(coTen(), "submitter", "Người gửi", "tự bình luận");
    expect(mockSendWebPush).not.toHaveBeenCalled();
  });

  it("người gửi cũng bị nhắc trong chính bình luận đó → chỉ nhận 'nhắc tên' (nhắc tên thắng)", async () => {
    const mentioned = ["submitter", "uC"];
    await Promise.all([
      hpcoreCommentOnMine(coTen(), "uA", "Người A", "@submitter xem", { actorUid: "uA", mentionedUids: mentioned }),
      hpcoreMentioned(coTen(), mentioned, "Người A", "@submitter xem", { actorUid: "uA" }),
    ]);
    // Cả 2 thư cùng được giao cho bộ gửi; thư "bình luận" gắn onlyIfDisabled: "mention" → chỉ đi
    // khi người đó tắt "Nhắc tên" (App Tổng xét theo công tắc thật; gói gửi đi kiểm ở push-dispatch.test.ts).
    const forSubmitter = (mockSendWebPush.mock.calls.flatMap((c) => c[0]) as { uid: string; payload: { kind: string }; onlyIfDisabled?: string }[])
      .filter((i) => i.uid === "submitter")
      .map((i) => `${i.payload.kind}:${i.onlyIfDisabled ?? "-"}`)
      .sort();
    expect(forSubmitter).toEqual(["comment_on_mine:mention", "mentioned:-"]);
    // Chuông vẫn ghi đủ như trước (không đổi hành vi chuông).
    expect(mockSet.mock.calls.some((c) => c[1].userId === "submitter" && c[1].meta?.kind === "comment_on_mine")).toBe(true);
  });

  it("người theo dõi KHÔNG đẩy ra màn hình (chỉ có trên chuông)", async () => {
    await hpcoreFollowersSubmitted([user("f1")], baseRequest());
    await hpcoreFollowersFullyApproved(baseRequest({ status: "approved", followers: [user("f1")] }));
    expect(mockSendWebPush).not.toHaveBeenCalled();
  });

  it("ghi chuông lỗi vẫn đẩy được (2 việc độc lập)", async () => {
    mockCommit.mockRejectedValueOnce(new Error("Firestore lỗi"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await hpcoreSubmitterResult(baseRequest({ status: "rejected" }));
    expect(allPushed().map((i) => i.payload.kind)).toEqual(["rejected"]);
    errSpy.mockRestore();
  });
});

describe("kết quả cuối: người quyết định + lý do lấy THẲNG từ route", () => {
  it("từ chối: dùng actorName/note truyền vào, không suy từ nhật ký", async () => {
    await hpcoreSubmitterResult(baseRequest({ status: "rejected" }), { actorUid: "uB", actorName: "Lê Văn C", note: "Thiếu báo giá" });
    const p = (mockSendWebPush.mock.calls[0][0] as { payload: { body: string } }[])[0].payload;
    expect(p.body.split("\n")[0]).toBe("Lê Văn C: “Thiếu báo giá”");
  });

  it("duyệt xong luồng đồng thời: 'duyệt cuối cùng (n/n)'", async () => {
    await hpcoreSubmitterResult(
      baseRequest({ status: "approved", approvalFlow: "concurrent", approvers: [{ id: "uA", decision: "approved" }, { id: "uB", decision: "approved" }] } as Partial<RequestInstance>),
      { actorUid: "uB", actorName: "Người B" },
    );
    const p = (mockSendWebPush.mock.calls[0][0] as { payload: { body: string } }[])[0].payload;
    expect(p.body.split("\n")[0]).toBe("Người B duyệt cuối cùng (2/2)");
  });

  it("trả lại đề xuất trực tiếp → link sửa /request/direct/new?draftId=", async () => {
    await hpcoreSubmitterReturned(baseRequest({ groupId: null }), "bổ sung", { actorUid: "uA", actorName: "Người A" });
    const p = (mockSendWebPush.mock.calls[0][0] as { payload: { url: string } }[])[0].payload;
    expect(p.url).toBe("/request/direct/new?draftId=r1");
  });
});
