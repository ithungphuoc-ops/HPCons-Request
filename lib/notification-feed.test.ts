import { describe, expect, it } from "vitest";
import {
  buildNotificationFeed,
  feedCandidateRequests,
  feedRecipientCandidates,
  MAX_UNREAD_FOLLOWING_ENTRIES,
  hideExpiredEntries,
  isQuietHistoryEntry,
  sameFeedContent,
  type NotificationFeedContext,
} from "./notification-feed";
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

describe("feedRecipientCandidates — ai cần tính lại khi đề xuất đổi", () => {
  const people = ["lm", "a1", "a2", "f1", "m1", "dep-uid", "adj1", "adj-old", "nguoi-ngoai"];
  const names: Record<string, string> = Object.fromEntries(people.map((u) => [u, `Tên ${u}`]));
  const r = req({
    id: "9",
    status: "approved",
    approvalFlow: "parallel",
    submittedBy: { uid: "lm", name: names.lm },
    approversSnapshot: [{ id: "a1" }, { id: "a2" }],
    approvers: [
      { id: "a1", decision: "approved" },
      { id: "a2", decision: "approved" },
    ],
    followers: [{ id: "f1", name: names.f1, avatarInitial: "F" }],
    history: [
      { at: t(60), actor: names.lm, action: "Đã gửi đề xuất" },
      { at: t(50), actor: names.a1, action: "Đã chấp thuận" },
      { at: t(40), actor: names.a2, action: "Đã chấp thuận" },
    ],
    comments: [
      { id: "c1", authorUid: "a1", authorName: names.a1, text: "@m1 xem giúp", at: t(30), mentionIds: ["m1"] },
      { id: "c2", authorUid: "a1", authorName: names.a1, text: "@Phòng KT", at: t(20), mentionIds: ["phong-kt"] },
    ],
    mentionedUids: ["m1", "dep-uid"],
    adjustmentReviewerUids: ["adj-old"],
    pendingAdjustment: {
      noiDung: "đổi",
      attachment: null,
      requestedByUid: "lm",
      requestedByName: names.lm,
      createdAt: t(10),
      approvers: [{ uid: "adj1", name: names.adj1, approvedAt: null }],
    },
  } as never);

  it("gồm mọi người mà buildNotificationFeed cho ra dòng của đề xuất này (không sót ai)", () => {
    const candidates = new Set(feedRecipientCandidates(r));
    for (const uid of people) {
      const feed = buildNotificationFeed([r], {
        uid,
        name: names[uid],
        settings: null,
        now: NOW,
        groupMentionCommentIds: uid === "dep-uid" ? new Set(["c2"]) : undefined,
      });
      if (feed.entries.length > 0) expect(candidates.has(uid), uid).toBe(true);
    }
    expect(candidates.has("nguoi-ngoai")).toBe(false);
  });

  it("liệt kê đủ các vai trò", () => {
    expect(new Set(feedRecipientCandidates(r))).toEqual(
      // Không có "phong-kt" (id phòng ban thô trong comments[].mentionIds) — review PR #92.
      new Set(["lm", "a1", "a2", "f1", "adj1", "adj-old", "m1", "dep-uid"]),
    );
  });
});

describe("hideExpiredEntries — tài liệu lưu sẵn, client lọc theo giờ hiện tại", () => {
  it("ẩn dòng đã đọc quá 14 ngày, giữ việc cần duyệt / chưa đọc, số đỏ không đổi", () => {
    const old = new Date(NOW - 15 * 86_400_000).toISOString();
    const mk = (id: string, over: object) => ({
      requestId: id,
      code: null,
      title: id,
      groupName: "g",
      must: false,
      unread: false,
      counted: false,
      at: old,
      main: { kind: "following" as const, text: "x", at: old },
      extra: 0,
      ...over,
    });
    const feed = {
      entries: [mk("must", { must: true, counted: true }), mk("unread", { unread: true, counted: true }), mk("doc-cu", {}), mk("moi", { at: t(5) })],
      badge: 2,
      mustCount: 1,
    };
    const out = hideExpiredEntries(feed, NOW);
    expect(out.entries.map((e) => e.requestId)).toEqual(["must", "unread", "moi"]);
    expect(out.badge).toBe(2);
    expect(hideExpiredEntries(feed, NOW - 2 * 86_400_000)).toBe(feed);
  });
});

describe("sameFeedContent", () => {
  it("không phân biệt thứ tự khoá (Firestore trả map theo khoá đã sắp xếp)", () => {
    const r = req({ id: "1", approvers: [{ id: "me", decision: "pending" }] });
    const feed = buildNotificationFeed([r], ctx());
    const reordered = JSON.parse(JSON.stringify(feed, (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v,
    ));
    expect(sameFeedContent(feed, reordered)).toBe(true);
    expect(sameFeedContent(feed, { ...feed, badge: 0 })).toBe(false);
    const changed = { ...feed, entries: [{ ...feed.entries[0], unread: !feed.entries[0].unread }] };
    expect(sameFeedContent(feed, changed)).toBe(false);
  });
});

describe("giới hạn dòng chưa đọc chỉ-theo-dõi", () => {
  it("giữ tối đa MAX_UNREAD_FOLLOWING_ENTRIES dòng mới nhất, dòng liên quan trực tiếp giữ hết, vẫn nhớ đủ id", () => {
    const n = MAX_UNREAD_FOLLOWING_ENTRIES + 5;
    const follow = Array.from({ length: n }, (_, i) =>
      req({ id: `f${i}`, followers: [{ id: "me", name: ME.name, avatarInitial: "P" }], history: [{ at: t(i + 1), actor: "Lê Minh", action: "Đã gửi đề xuất" }] } as never),
    );
    const mine = req({ id: "duyet", approvers: [{ id: "me", decision: "pending" }] });
    const feed = buildNotificationFeed([...follow, mine], ctx());
    expect(feed.entries.filter((e) => !e.must && e.unread && !e.counted)).toHaveLength(MAX_UNREAD_FOLLOWING_ENTRIES);
    expect(feed.entries.some((e) => e.requestId === "f0")).toBe(true);
    expect(feed.entries.some((e) => e.requestId === `f${n - 1}`)).toBe(false);
    expect(feed.mustCount).toBe(1);
    expect(feed.trackedRequestIds).toHaveLength(n + 1);
  });
});

/**
 * Đường SỰ KIỆN chỉ đọc feedCandidateRequests thay vì cả kho — phải ra Y HỆT. Sinh dữ liệu
 * ngẫu nhiên (cố định hạt giống), tính đầy đủ làm "tài liệu đang lưu", rồi giả lập 1 sự
 * kiện như route thật (ghi updatedAt; riêng thêm người theo dõi thì không) và so 2 cách.
 */
describe("feedCandidateRequests — tính lại do sự kiện ra y như đọc cả kho", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const users = ["me", "u1", "u2", "u3", "u4"];
  const nameOf = (u: string) => (u === "me" ? ME.name : `Tên ${u}`);
  const DAY = 24 * 60;

  function randomRequest(i: number): RequestInstance {
    const submitter = pick(users);
    const age = Math.floor(rnd() * 60 * DAY); // tới 60 ngày trước
    const status = pick(["pending", "approved", "rejected", "returned"] as const);
    const approvers = users.filter((u) => u !== submitter && rnd() < 0.4).map((id) => ({ id, decision: status === "pending" ? "pending" : "approved" }));
    const followers = users.filter((u) => u !== submitter && rnd() < 0.4).map((id) => ({ id, name: nameOf(id), avatarInitial: "X" }));
    const history = [{ at: t(age), actor: nameOf(submitter), action: "Đã gửi đề xuất" }];
    let last = age;
    if (status !== "pending" && approvers[0]) {
      last = Math.max(0, age - Math.floor(rnd() * 3 * DAY));
      history.push({ at: t(last), actor: nameOf(approvers[0].id), action: status === "approved" ? "Đã chấp thuận" : status === "rejected" ? "Đã từ chối" : "Đã trả lại" });
    }
    const comments = rnd() < 0.3 ? [{ id: `c${i}`, authorUid: pick(users), authorName: nameOf(pick(users)), text: "hi", at: t(last), mentionIds: [] }] : [];
    const viewedAt = Object.fromEntries(users.filter(() => rnd() < 0.5).map((u) => [u, t(Math.floor(rnd() * age))]));
    const pendingAdjustment =
      status === "approved" && rnd() < 0.15
        ? { noiDung: "đổi", attachment: null, requestedByUid: submitter, requestedByName: nameOf(submitter), createdAt: t(last), approvers: [{ uid: pick(users), name: "x", approvedAt: null }] }
        : null;
    return req({ id: `r${i}`, status, submittedBy: { uid: submitter, name: nameOf(submitter) }, submittedAt: t(age), updatedAt: t(last), approvers, approversSnapshot: approvers.map((a) => ({ id: a.id })), followers, history, comments, viewedAt, pendingAdjustment } as never);
  }

  const feedFor = (requests: RequestInstance[], uid: string) => buildNotificationFeed(requests, { uid, name: nameOf(uid), settings: null, now: NOW });
  const visible = (f: ReturnType<typeof feedFor>) => ({ entries: f.entries, badge: f.badge, mustCount: f.mustCount });

  it("200 lượt ngẫu nhiên × 5 người: kết quả trùng khớp", () => {
    for (let round = 0; round < 200; round++) {
      const before = Array.from({ length: 40 }, (_, i) => randomRequest(i));
      const stored = new Map(users.map((u) => [u, feedFor(before, u)]));
      // Sự kiện: chọn 1 đề xuất, đổi theo 1 trong 3 cách như route thật.
      const target = pick(before);
      const kind = pick(["comment", "follower", "decide"] as const);
      const after = before.map((r) => {
        if (r !== target) return r;
        if (kind === "follower") return { ...r, followers: [...r.followers, { id: pick(users), name: "x", avatarInitial: "X" }] } as RequestInstance; // không đổi updatedAt
        const at = t(0);
        if (kind === "comment") {
          const who = pick(users);
          return { ...r, updatedAt: at, comments: [...(r.comments ?? []), { id: `n${round}`, authorUid: who, authorName: nameOf(who), text: "mới", at }] } as RequestInstance;
        }
        return { ...r, updatedAt: at, status: "approved", history: [...r.history, { at, actor: nameOf(pick(users)), action: "Đã chấp thuận" }] } as RequestInstance;
      });
      const keep = new Set<string>([target.id]);
      for (const f of stored.values()) for (const id of f.trackedRequestIds ?? []) keep.add(id);
      const subset = feedCandidateRequests(after, NOW, keep);
      for (const u of users) {
        expect(visible(feedFor(subset, u)), `vòng ${round}, ${u}, ${kind}`).toEqual(visible(feedFor(after, u)));
      }
    }
  });
});
