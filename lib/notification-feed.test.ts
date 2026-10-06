import { describe, expect, it } from "vitest";
import { buildNotificationFeed, isQuietHistoryEntry, type NotificationFeedContext } from "./notification-feed";
import type { NotificationSettings, RequestInstance } from "./types";

const ME = { uid: "me", name: "Nguyễn Hữu Phước" };
const NOW = Date.parse("2026-10-06T10:00:00.000Z");
const t = (min: number) => new Date(NOW - min * 60_000).toISOString();

function req(over: Partial<RequestInstance> & { id: string }): RequestInstance {
  return {
    code: "000000" + over.id.padStart(3, "0"),
    groupId: "g1",
    groupNameSnapshot: "1.0. Phiếu đề nghị",
    fieldsSnapshot: [],
    values: {},
    submittedBy: { uid: "lm", name: "Lê Minh" },
    submittedAt: t(120),
    updatedAt: t(120),
    approvalFlow: "sequential",
    approversSnapshot: [],
    approvers: [],
    followers: [],
    status: "pending",
    deadlineAt: null,
    history: [{ at: t(120), actor: "Lê Minh", action: "Đã gửi đề xuất" }],
    comments: [],
    deletedAt: null,
    ...over,
  } as unknown as RequestInstance;
}

const ctx = (over: Partial<NotificationFeedContext> = {}): NotificationFeedContext => ({ ...ME, settings: null, now: NOW, ...over });

describe("isQuietHistoryEntry", () => {
  it("bỏ qua dòng hệ thống tự ghi", () => {
    expect(isQuietHistoryEntry({ at: t(1), actor: "Hệ thống", action: "Đồng bộ App Thu mua thất bại (tự thử lại)" })).toBe(true);
    expect(isQuietHistoryEntry({ at: t(1), actor: "A", action: "Đã đồng bộ sang QLK CTR" })).toBe(true);
    expect(isQuietHistoryEntry({ at: t(1), actor: "A", action: "Đã lưu nháp" })).toBe(true);
    expect(isQuietHistoryEntry({ at: t(1), actor: "A", action: "Đã thay tệp đính kèm" })).toBe(true);
    expect(isQuietHistoryEntry({ at: t(1), actor: "A", action: "Đã chấp thuận" })).toBe(false);
  });
});

describe("buildNotificationFeed", () => {
  it("đến lượt duyệt → 'Cần bạn duyệt', luôn tính vào số trên chuông dù đã xem", () => {
    const r = req({ id: "1", approvers: [{ id: "me", decision: "pending" }], viewedAt: { me: t(1) } });
    const feed = buildNotificationFeed([r], ctx());
    expect(feed.mustCount).toBe(1);
    expect(feed.badge).toBe(1);
    expect(feed.entries[0]).toMatchObject({ must: true, main: { kind: "approver_pending", text: "Lê Minh gửi đề xuất, chờ bạn duyệt" } });
  });

  it("luồng lần lượt: chưa tới lượt thì chưa báo duyệt", () => {
    const r = req({ id: "1", approvers: [{ id: "x", decision: "pending" }, { id: "me", decision: "pending" }] });
    expect(buildNotificationFeed([r], ctx()).mustCount).toBe(0);
  });

  it("chuyển tiếp: chỉ đúng người được chuyển tiếp thấy chữ 'chuyển tiếp'", () => {
    const history = [
      { at: t(60), actor: "Lê Minh", action: "Đã gửi đề xuất" },
      { at: t(30), actor: "Võ Thanh", action: "Đã chấp thuận và chuyển tiếp", target: "Người Khác" },
    ];
    const r = req({ id: "1", approvalFlow: "parallel", history, approvers: [{ id: "me", decision: "pending" }, { id: "khac", decision: "pending" }] } as never);
    expect(buildNotificationFeed([r], ctx()).entries[0].main.text).toBe("Lê Minh gửi đề xuất, chờ bạn duyệt");
    const r2 = req({ ...r, history: [history[0], { ...history[1], target: ME.name }] } as never);
    expect(buildNotificationFeed([r2], ctx()).entries[0].main.text).toBe("Võ Thanh chuyển tiếp cho bạn duyệt");
  });

  it("người gửi: bị trả lại có lý do, mở xem rồi thì thành đã đọc", () => {
    const r = req({
      id: "1",
      submittedBy: { uid: "me", name: ME.name },
      status: "returned",
      history: [
        { at: t(60), actor: ME.name, action: "Đã gửi đề xuất" },
        { at: t(10), actor: "Đặng Hà", action: "Đã trả lại", note: "Bổ sung hoá đơn VAT" },
      ],
    } as never);
    const feed = buildNotificationFeed([r], ctx());
    expect(feed.entries[0]).toMatchObject({ unread: true, main: { kind: "own_returned", text: "Đặng Hà đã trả lại đề xuất của bạn: “Bổ sung hoá đơn VAT”" } });
    expect(feed.badge).toBe(1);
    const seen = buildNotificationFeed([{ ...r, viewedAt: { me: t(5) } }], ctx());
    expect(seen.entries[0].unread).toBe(false);
    expect(seen.badge).toBe(0);
  });

  it("người gửi: duyệt xong lấy đúng giờ quyết định, dòng hệ thống sau đó không đẩy giờ lên", () => {
    const r = req({
      id: "1",
      submittedBy: { uid: "me", name: ME.name },
      status: "approved",
      history: [
        { at: t(300), actor: ME.name, action: "Đã gửi đề xuất" },
        { at: t(200), actor: "Võ Thanh", action: "Đã chấp thuận" },
        { at: t(1), actor: "Hệ thống", action: "Đồng bộ App Thu mua thất bại (tự thử lại)" },
      ],
      viewedAt: { me: t(100) },
    } as never);
    const feed = buildNotificationFeed([r], ctx());
    expect(feed.entries[0]).toMatchObject({ unread: false, main: { kind: "own_approved", at: t(200) } });
    expect(feed.badge).toBe(0);
  });

  it("người gửi được báo khi có bình luận (không phải của chính mình)", () => {
    const r = req({
      id: "1",
      submittedBy: { uid: "me", name: ME.name },
      comments: [
        { id: "c1", authorUid: "me", authorName: ME.name, avatarInitial: "P", text: "của tôi", at: t(20) },
        { id: "c2", authorUid: "pt", authorName: "Phạm Thu", avatarInitial: "T", text: "Đã kiểm tra số lượng, ok anh", at: t(5) },
      ],
    } as never);
    const feed = buildNotificationFeed([r], ctx());
    expect(feed.entries[0].main).toMatchObject({ kind: "comment_on_mine", text: "Phạm Thu bình luận: “Đã kiểm tra số lượng, ok anh”" });
    expect(feed.entries[0].extra).toBe(0);
  });

  it("@ nhắc tên chỉ báo đúng bình luận có nhắc, không báo mãi sau đó", () => {
    const comments = [{ id: "c1", authorUid: "hn", authorName: "Hoàng Nam", avatarInitial: "N", text: "@Phước xem giá", at: t(30), mentionIds: ["me"] }];
    const r = req({ id: "1", followers: [{ id: "me", name: ME.name, avatarInitial: "P" }], comments, mentionedUids: ["me"] } as never);
    expect(buildNotificationFeed([r], ctx()).entries[0].main.kind).toBe("mentioned");
    // Đã xem sau bình luận; sau đó có người DUYỆT (không nhắc) → không còn "nhắc tới bạn".
    const later = { ...r, viewedAt: { me: t(20) }, history: [...r.history, { at: t(10), actor: "GĐ", action: "Đã từ chối" }], status: "rejected" } as never;
    const feed = buildNotificationFeed([later], ctx());
    expect(feed.entries[0].main.kind).toBe("following");
    expect(feed.entries[0].main.text).toBe("GĐ đã từ chối đề xuất bạn theo dõi");
  });

  it("nhắc qua phòng ban (máy chủ giãn sẵn) vẫn báo 'nhắc tới bạn'", () => {
    const r = req({ id: "1", comments: [{ id: "c9", authorUid: "hn", authorName: "Hoàng Nam", avatarInitial: "N", text: "@Phòng KT", at: t(3), mentionIds: ["dept1"] }] } as never);
    expect(buildNotificationFeed([r], ctx()).entries).toHaveLength(0);
    expect(buildNotificationFeed([r], ctx({ groupMentionCommentIds: new Set(["c9"]) })).entries[0].main.kind).toBe("mentioned");
  });

  it("điều chỉnh sau duyệt chờ mình duyệt → 'Cần bạn duyệt'", () => {
    const r = req({
      id: "1",
      status: "approved",
      pendingAdjustment: { noiDung: "Thép hộp 120 → 90 cây", attachment: null, requestedByUid: "tb", requestedByName: "Trần Bảo", createdAt: t(2), approvers: [{ uid: "me", name: ME.name, approvedAt: null }] },
    } as never);
    const feed = buildNotificationFeed([r], ctx());
    expect(feed.entries[0]).toMatchObject({ must: true, main: { kind: "adjustment_pending" } });
    expect(feed.entries[0].main.text).toContain("Trần Bảo đề nghị điều chỉnh sau duyệt");
  });

  it("mỗi đề xuất 1 dòng, các sự kiện khác ghi 'và N cập nhật khác'", () => {
    const r = req({
      id: "1",
      submittedBy: { uid: "me", name: ME.name },
      status: "approved",
      history: [
        { at: t(60), actor: ME.name, action: "Đã gửi đề xuất" },
        { at: t(30), actor: "Võ Thanh", action: "Đã chấp thuận" },
      ],
      comments: [
        { id: "a", authorUid: "x", authorName: "X", avatarInitial: "X", text: "1", at: t(20) },
        { id: "b", authorUid: "y", authorName: "Y", avatarInitial: "Y", text: "2", at: t(10) },
      ],
    } as never);
    const feed = buildNotificationFeed([r], ctx());
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0].extra).toBe(2);
    expect(feed.badge).toBe(1);
  });

  it("thứ tự: 'Cần bạn duyệt' trước, rồi chưa đọc, rồi đã đọc; đã đọc quá 14 ngày thì ẩn", () => {
    const must = req({ id: "1", approvers: [{ id: "me", decision: "pending" }], submittedAt: t(5000) });
    const unread = req({ id: "2", submittedBy: { uid: "me", name: ME.name }, status: "rejected", history: [{ at: t(30), actor: "GĐ", action: "Đã từ chối" }] } as never);
    const read = req({ id: "3", submittedBy: { uid: "me", name: ME.name }, status: "approved", history: [{ at: t(1), actor: "GĐ", action: "Đã chấp thuận" }], viewedAt: { me: t(0) } } as never);
    const old = req({ id: "4", submittedBy: { uid: "me", name: ME.name }, status: "approved", history: [{ at: t(60 * 24 * 20), actor: "GĐ", action: "Đã chấp thuận" }], viewedAt: { me: t(60 * 24 * 19) } } as never);
    const feed = buildNotificationFeed([read, old, unread, must], ctx());
    expect(feed.entries.map((e) => e.requestId)).toEqual(["1", "2", "3"]);
    expect(feed.badge).toBe(2);
  });

  it("tắt loại nào trong cài đặt thì không hiện loại đó", () => {
    const r = req({ id: "1", approvers: [{ id: "me", decision: "pending" }] });
    const settings = { approver_pending: false } as NotificationSettings;
    expect(buildNotificationFeed([r], ctx({ settings })).entries).toHaveLength(0);
  });

  it("bỏ nháp, đề xuất đã xoá; quản lý bị qua mặt chỉ khi máy chủ đánh dấu", () => {
    const draft = req({ id: "1", status: "draft" } as never);
    const deleted = req({ id: "2", deletedAt: t(1) } as never);
    const bypass = req({ id: "3" });
    const feed = buildNotificationFeed([draft, deleted, bypass], ctx({ bypassedRequestIds: new Set(["3", "1"]) }));
    expect(feed.entries.map((e) => [e.requestId, e.main.kind])).toEqual([["3", "manager_bypassed"]]);
  });

  it("người duyệt đã xử lý: báo khi bước sau từ chối", () => {
    const r = req({
      id: "1",
      status: "rejected",
      approvers: [{ id: "me", decision: "approved" }, { id: "gd", decision: "rejected" }],
      history: [
        { at: t(60), actor: "Lê Minh", action: "Đã gửi đề xuất" },
        { at: t(40), actor: ME.name, action: "Đã chấp thuận" },
        { at: t(5), actor: "GĐ", action: "Đã từ chối", note: "Vượt ngân sách" },
      ],
    } as never);
    const feed = buildNotificationFeed([r], ctx());
    expect(feed.entries[0].main).toMatchObject({ kind: "approver_followup", text: "GĐ đã từ chối ở bước sau: “Vượt ngân sách”" });
  });
});

describe("số đỏ trên chuông", () => {
  it("đề xuất chỉ đang THEO DÕI: vẫn hiện (chưa đọc) nhưng KHÔNG tính vào số đỏ", () => {
    const r = req({ id: "1", followers: [{ id: "me", name: ME.name, avatarInitial: "P" }] } as never);
    const feed = buildNotificationFeed([r], ctx());
    expect(feed.entries[0]).toMatchObject({ unread: true, counted: false, main: { kind: "following" } });
    expect(feed.badge).toBe(0);
  });

  it("theo dõi nhưng bị @ nhắc tên → tính vào số đỏ", () => {
    const r = req({
      id: "1",
      followers: [{ id: "me", name: ME.name, avatarInitial: "P" }],
      comments: [{ id: "c1", authorUid: "hn", authorName: "Hoàng Nam", avatarInitial: "N", text: "@Phước", at: t(3), mentionIds: ["me"] }],
    } as never);
    const feed = buildNotificationFeed([r], ctx());
    expect(feed.entries[0].counted).toBe(true);
    expect(feed.badge).toBe(1);
  });
});
