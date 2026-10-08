import { describe, expect, it } from "vitest";
import {
  EXCERPT_MAX,
  excerptOf,
  metaAdjustmentPending,
  metaAdjustmentResult,
  metaComment,
  metaFollowApproved,
  metaFollowSubmitted,
  metaPendingApproval,
  metaSubmitterDecision,
} from "./hpcore-notification-meta";
import { buildNotificationFeed } from "./notification-feed";
import type { RequestInstance } from "./types";

const GROUP = "Phòng Hành chính Nhân sự - IT (HP Cons)";

function req(overrides: Partial<RequestInstance> = {}): RequestInstance {
  return {
    id: "r1",
    code: "000000166",
    groupId: "g1",
    groupNameSnapshot: GROUP,
    fieldsSnapshot: [],
    values: {},
    submittedBy: { uid: "sub", email: "sub@hpcons.com.vn", name: "Trần Văn B" },
    submittedAt: "2026-10-08T02:00:00.000Z",
    updatedAt: "2026-10-08T02:00:00.000Z",
    approvalFlow: "sequential",
    approversSnapshot: [
      { id: "uA", name: "Nguyễn Thị Cẩm Thu", username: "ThuNTC", avatarInitial: "N" },
      { id: "uB", name: "Lê Văn C", username: "CLV", avatarInitial: "L" },
    ],
    approvers: [
      { id: "uA", decision: "pending" },
      { id: "uB", decision: "pending" },
    ],
    followers: [],
    status: "pending",
    deadlineAt: null,
    history: [{ at: "2026-10-08T02:00:00.000Z", actor: "Trần Văn B", action: "Đã gửi đề xuất" }],
    comments: [],
    deletedAt: null,
    ...overrides,
  } as RequestInstance;
}

describe("excerptOf — 1 dòng, cắt 120 ký tự + …", () => {
  it("gộp xuống dòng/khoảng trắng, rỗng → undefined", () => {
    expect(excerptOf("  a\n\n  b  ")).toBe("a b");
    expect(excerptOf("   ")).toBeUndefined();
    expect(excerptOf(undefined)).toBeUndefined();
  });
  it("dài hơn 120 → đúng 120 ký tự + …", () => {
    const out = excerptOf("x".repeat(200))!;
    expect(out).toBe(`${"x".repeat(EXCERPT_MAX)}…`);
  });
});

describe("meta theo từng loại — câu chữ khớp chuông app Đề xuất", () => {
  it("pending_approval — người gửi", () => {
    const m = metaPendingApproval(req(), "uA");
    expect(m).toEqual({
      v: 1,
      kind: "pending_approval",
      headline: "Trần Văn B gửi đề xuất, chờ bạn duyệt",
      actorName: "Trần Văn B",
      requestCode: "000000166",
      groupName: GROUP,
    });
  });

  it("pending_approval — được chuyển tiếp ĐÚNG tới mình", () => {
    const r = req({
      history: [
        { at: "2026-10-08T02:00:00.000Z", actor: "Trần Văn B", action: "Đã gửi đề xuất" },
        { at: "2026-10-08T03:00:00.000Z", actor: "Nguyễn Thị Cẩm Thu", action: "Đã chuyển tiếp", target: "Lê Văn C" },
        // Dòng hệ thống không được tính là "lượt cuối".
        { at: "2026-10-08T03:01:00.000Z", actor: "Hệ thống", action: "Đã đồng bộ Kho" },
      ],
    });
    expect(metaPendingApproval(r, "uB")).toMatchObject({
      headline: "Nguyễn Thị Cẩm Thu chuyển tiếp cho bạn duyệt",
      actorName: "Nguyễn Thị Cẩm Thu",
    });
    // Người khác (không phải người được chuyển tới) → câu "gửi đề xuất".
    expect(metaPendingApproval(r, "uA").headline).toBe("Trần Văn B gửi đề xuất, chờ bạn duyệt");
  });

  it("approved / rejected / returned — người quyết định + lý do", () => {
    const r = req({
      status: "approved",
      history: [
        { at: "2026-10-08T02:00:00.000Z", actor: "Trần Văn B", action: "Đã gửi đề xuất" },
        { at: "2026-10-08T04:00:00.000Z", actor: "Nguyễn Thị Cẩm Thu", action: "Đã chấp thuận", note: "ok" },
      ],
    });
    expect(metaSubmitterDecision(r, "approved")).toEqual({
      v: 1,
      kind: "approved",
      headline: "Nguyễn Thị Cẩm Thu đã chấp thuận đề xuất của bạn",
      actorName: "Nguyễn Thị Cẩm Thu",
      requestCode: "000000166",
      groupName: GROUP,
    });

    const rj = req({
      status: "rejected",
      history: [{ at: "2026-10-08T04:00:00.000Z", actor: "Lê Văn C", action: "Đã từ chối", note: "Thiếu\nbáo giá" }],
    });
    expect(metaSubmitterDecision(rj, "rejected")).toMatchObject({
      kind: "rejected",
      headline: "Lê Văn C đã từ chối đề xuất của bạn: “Thiếu báo giá”",
      actorName: "Lê Văn C",
      excerpt: "Thiếu báo giá",
    });

    const rt = req({
      status: "returned",
      history: [{ at: "2026-10-08T04:00:00.000Z", actor: "Lê Văn C", action: "Đã trả lại", note: "cũ" }],
    });
    // Lý do truyền thẳng từ nơi gọi được ưu tiên.
    expect(metaSubmitterDecision(rt, "returned", "Bổ sung chứng từ")).toMatchObject({
      kind: "returned",
      headline: "Lê Văn C đã trả lại đề xuất của bạn: “Bổ sung chứng từ”",
      excerpt: "Bổ sung chứng từ",
    });
  });

  it("không tìm thấy dòng nhật ký → câu dự phòng, không có actorName", () => {
    const m = metaSubmitterDecision(req({ history: [] }), "approved");
    expect(m.headline).toBe("Đề xuất của bạn đã được chấp thuận");
    expect("actorName" in m).toBe(false);
    expect("excerpt" in m).toBe(false);
  });

  it("mentioned — y câu chuông, nhắc tên giữ nguyên trong chữ", () => {
    expect(metaComment(req(), "mentioned", "Nguyễn Tấn Hậu", "@HauNT test chuông thông báo lần 2")).toEqual({
      v: 1,
      kind: "mentioned",
      headline: "Nguyễn Tấn Hậu nhắc tới bạn: “@HauNT test chuông thông báo lần 2”",
      actorName: "Nguyễn Tấn Hậu",
      excerpt: "@HauNT test chuông thông báo lần 2",
      requestCode: "000000166",
      groupName: GROUP,
    });
  });

  it("comment_on_mine", () => {
    expect(metaComment(req(), "comment_on_mine", "Lê Văn C", "Đã gửi báo giá")).toMatchObject({
      kind: "comment_on_mine",
      headline: "Lê Văn C bình luận: “Đã gửi báo giá”",
      excerpt: "Đã gửi báo giá",
    });
  });

  it("follow_submitted / follow_approved", () => {
    expect(metaFollowSubmitted(req())).toMatchObject({
      kind: "follow_submitted",
      headline: "Trần Văn B gửi đề xuất bạn đang theo dõi",
      actorName: "Trần Văn B",
    });
    const r = req({
      status: "approved",
      history: [
        { at: "2026-10-08T03:00:00.000Z", actor: "Lê Văn C", action: "Đã chấp thuận" },
        { at: "2026-10-08T04:00:00.000Z", actor: "Nguyễn Thị Cẩm Thu", action: "Đã chấp thuận" },
      ],
    });
    expect(metaFollowApproved(r)).toMatchObject({
      kind: "follow_approved",
      headline: "Nguyễn Thị Cẩm Thu đã chấp thuận đề xuất bạn theo dõi",
      actorName: "Nguyễn Thị Cẩm Thu",
    });
  });

  it("adjustment_pending — KHÔNG đưa nội dung điều chỉnh (thường có số tiền) sang App Tổng", () => {
    const r = req({
      status: "approved",
      pendingAdjustment: {
        noiDung: "Đổi đơn giá 1.200.000 thành 900.000",
        attachment: null,
        requestedByUid: "sub",
        requestedByName: "Trần Văn B",
        createdAt: "2026-10-08T05:00:00.000Z",
        approvers: [{ uid: "uA", name: "Nguyễn Thị Cẩm Thu", approvedAt: null }],
      },
    });
    const m = metaAdjustmentPending(r);
    expect(m).toEqual({
      v: 1,
      kind: "adjustment_pending",
      headline: "Trần Văn B đề nghị điều chỉnh sau duyệt, chờ bạn duyệt",
      actorName: "Trần Văn B",
      requestCode: "000000166",
      groupName: GROUP,
    });
    expect(JSON.stringify(m)).not.toContain("900.000");
  });

  it("adjustment_approved / adjustment_rejected", () => {
    expect(metaAdjustmentResult(req(), "approved", "Ai đó")).toEqual({
      v: 1,
      kind: "adjustment_approved",
      headline: "Điều chỉnh sau duyệt bạn đề nghị đã được chấp thuận",
      requestCode: "000000166",
      groupName: GROUP,
    });
    expect(metaAdjustmentResult(req(), "rejected", "Lê Văn C")).toMatchObject({
      kind: "adjustment_rejected",
      headline: "Lê Văn C đã từ chối điều chỉnh sau duyệt bạn đề nghị",
      actorName: "Lê Văn C",
    });
    expect(metaAdjustmentResult(req(), "rejected").headline).toBe("Điều chỉnh sau duyệt bạn đề nghị đã bị từ chối");
  });

  it("groupName = tên chuông app này hiện ở dòng 2 (trường tên đề xuất nếu có), mã rỗng → id", () => {
    const r = req({
      code: null as unknown as string,
      fieldsSnapshot: [{ id: "f1", code: "ten_de_xuat" } as unknown as RequestInstance["fieldsSnapshot"][number]],
      values: { f1: "Mua máy in" },
    });
    expect(metaFollowSubmitted(r)).toMatchObject({ requestCode: "r1", groupName: "Mua máy in" });
  });
});

describe("headline khớp ĐÚNG câu dòng chuông của app (cùng 1 dữ liệu)", () => {
  it("nhắc tên + người gửi đang tới lượt", () => {
    const r = req({
      comments: [
        {
          id: "c1",
          authorUid: "hau",
          authorName: "Nguyễn Tấn Hậu",
          avatarInitial: "N",
          text: "@HauNT test chuông thông báo lần 2",
          at: "2026-10-08T04:17:00.000Z",
          mentionIds: ["me"],
        },
      ],
    });
    const feed = buildNotificationFeed([r], { uid: "me", name: "Tôi", settings: null, now: Date.parse("2026-10-08T05:00:00.000Z") });
    expect(feed.entries[0].main.text).toBe(metaComment(r, "mentioned", "Nguyễn Tấn Hậu", r.comments![0].text).headline);
    expect(feed.entries[0].title).toBe(metaComment(r, "mentioned", "x", "y").groupName);

    const feedA = buildNotificationFeed([req()], { uid: "uA", name: "Nguyễn Thị Cẩm Thu", settings: null, now: Date.parse("2026-10-08T05:00:00.000Z") });
    expect(feedA.entries[0].main.text).toBe(metaPendingApproval(req(), "uA").headline);
  });
});
