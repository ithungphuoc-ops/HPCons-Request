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

// Web Push (08/10/2026): chỉ bắt lại danh sách thư định đẩy để kiểm nội dung/người nhận —
// việc gửi thật đã test riêng ở web-push.test.ts.
const { mockSendWebPush } = vi.hoisted(() => ({ mockSendWebPush: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/server/web-push", () => ({ sendWebPushItems: mockSendWebPush }));

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

describe("Web Push (cấp 3) — đi kèm đúng 3 nhóm sự kiện, nội dung ngắn", () => {
  /** Đề xuất có tên tự gõ chứa số tiền + bảng giá trị — KHÔNG được lọt ra màn hình khoá. */
  const nhayCam = () =>
    baseRequest({
      groupNameSnapshot: "1.0. Phiếu đề nghị (HPCons)",
      fieldsSnapshot: [{ id: "f1", code: "ten_de_xuat", label: "Tên đề xuất", type: "short_text", required: false }] as unknown as RequestInstance["fieldsSnapshot"],
      values: { f1: "Mua thép 987.654.321 đồng" },
    });
  const allPushed = () => mockSendWebPush.mock.calls.flatMap((c) => c[0] as { uid: string; payload: { title: string; body: string; kind: string } }[]);

  it("chờ duyệt / nhắc tên / kết quả / điều chỉnh → có đẩy, kèm actorUid để loại người làm", async () => {
    await hpcorePendingApprovers(nhayCam(), { actorUid: "submitter" });
    await hpcoreMentioned(nhayCam(), ["uA", "uC"], "Người A", "Giá 500.000.000 nhé @uA", { actorUid: "uX" });
    await hpcoreSubmitterResult({ ...nhayCam(), status: "approved" }, { actorUid: "uB" });
    await hpcoreSubmitterReturned(nhayCam(), "Sai số tiền 123.456", { actorUid: "uA" });
    await hpcoreAdjustmentPending(nhayCam(), ["uA"], { actorUid: "submitter" });
    await hpcoreAdjustmentResult(nhayCam(), "submitter", "rejected", "Người B", { actorUid: "uB" });
    expect(mockSendWebPush.mock.calls.map((c) => c[1])).toEqual([
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
      "submitter:adjustment_rejected",
    ]);
    for (const { payload } of items) {
      const text = `${payload.title} ${payload.body}`;
      expect(text).not.toMatch(/987|500\.000|123\.456|Mua thép|Giá|Sai số/);
      expect(text).toContain("000000001");
    }
    expect(items[0].payload.body).toBe("Người gửi gửi · 1.0. Phiếu đề nghị (HPCons)");
    expect(items[1].payload.title).toBe("Người A nhắc bạn trong đề xuất 000000001");
    // Chứng minh dữ liệu nhạy cảm CÓ trên chuông (meta.groupName = tên tự gõ) nhưng KHÔNG lên push.
    expect(mockSet.mock.calls[0][1].meta.groupName).toBe("Mua thép 987.654.321 đồng");
  });

  it("theo dõi / bình luận thường KHÔNG đẩy ra màn hình (chỉ có trên chuông)", async () => {
    await hpcoreFollowersSubmitted([user("f1")], baseRequest());
    await hpcoreFollowersFullyApproved(baseRequest({ status: "approved", followers: [user("f1")] }));
    await hpcoreCommentOnMine(baseRequest(), "uA", "Người A", "hi");
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
