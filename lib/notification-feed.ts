import { canApproverAct } from "@/lib/approval-logic";
import { isAwaitingMyAdjustmentDecision } from "@/lib/adjustment-settings";
import {
  ADJUSTMENT_HISTORY_PREFIX,
  ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX,
  DECISION_ATTACHMENT_EDIT_ACTIONS,
  TABLE_SUPPLEMENT_HISTORY_PREFIX,
} from "@/lib/request-history-labels";
import { resolveRequestTitle } from "@/lib/request-title";
import type { NotificationCategory, NotificationSettings, RequestHistoryEntry, RequestInstance } from "@/lib/types";

/**
 * Chuông thông báo (Đợt 1, Sếp duyệt demo 06/10/2026) — tính TOÀN BỘ danh sách thông
 * báo của 1 người từ các đề xuất còn hiệu lực, 1 lần, ở máy chủ (app/api/notifications).
 * Thay cho 7 lượt tải riêng lẻ trước đây (mỗi lượt đọc cả kho, chỉ giữ 8 mục, nhiều
 * loại không có trạng thái "đã đọc"). Hàm thuần — không đụng Firestore — để test được.
 *
 * Quy tắc chính:
 *  - MỖI ĐỀ XUẤT 1 DÒNG: gom mọi sự kiện của đề xuất, hiện sự kiện quan trọng nhất
 *    (việc cần duyệt) hoặc mới nhất, kèm "và N cập nhật khác".
 *  - "Cần bạn duyệt" (đến lượt duyệt / điều chỉnh chờ duyệt) luôn nằm trên, không
 *    giới hạn, không bao giờ bị mục khác đẩy mất.
 *  - Đã đọc = có sự kiện mới hơn `viewedAt[uid]` (mở đề xuất là ghi). Các dòng do hệ
 *    thống tự ghi (đồng bộ Kho/Thu mua, lưu nháp, nhân bản…) và thao tác của CHÍNH
 *    người xem không tính là "mới".
 *  - Tôn trọng cài đặt thông báo cá nhân (NotificationSettings).
 */

export type NotificationKind =
  | "approver_pending"
  | "adjustment_pending"
  | "own_approved"
  | "own_rejected"
  | "own_returned"
  | "comment_on_mine"
  | "mentioned"
  | "following"
  | "manager_bypassed"
  | "approver_followup";

export interface NotificationEvent {
  kind: NotificationKind;
  text: string;
  at: string;
}

export interface NotificationEntry {
  requestId: string;
  code: string | null;
  title: string;
  groupName: string;
  /** Việc cần chính người xem duyệt — luôn tính vào số trên chuông. */
  must: boolean;
  unread: boolean;
  /** Tính vào SỐ ĐỎ trên chuông: việc cần duyệt, hoặc có sự kiện chưa đọc liên quan
   * trực tiếp (không chỉ là "đề xuất đang theo dõi"). Đo trên dữ liệu thật 06/10/2026:
   * mỗi đề xuất ~13 người theo dõi — tính cả loại này thì số đỏ có người lên 30, đúng
   * kiểu "báo nhiều, không thiết thực"; bỏ ra thì còn tối đa 3. Dòng theo dõi vẫn hiện
   * trong chuông (chấm chưa đọc), chỉ không đẩy số đỏ. */
  counted: boolean;
  at: string;
  main: NotificationEvent;
  /** Số sự kiện khác (chưa đọc) của cùng đề xuất — "và N cập nhật khác". */
  extra: number;
}

export interface NotificationFeed {
  entries: NotificationEntry[];
  /** Mọi đề xuất có dòng TRƯỚC khi cắt bớt — xem StoredNotificationFeed.trackedRequestIds. */
  trackedRequestIds?: string[];
  /** Số đỏ trên chuông = số dòng `counted` (việc cần duyệt + chưa đọc liên quan trực tiếp). */
  badge: number;
  mustCount: number;
}

export interface NotificationFeedContext {
  uid: string;
  /** Tên hiển thị — `history.actor`/`history.target` lưu theo TÊN, không có uid. */
  name: string;
  settings: NotificationSettings | null;
  now: number;
  /** Đề xuất mà người xem là quản lý trực tiếp bị chọn người khác duyệt thay (máy chủ tính). */
  bypassedRequestIds?: ReadonlySet<string>;
  /** Id bình luận nhắc tới người xem QUA PHÒNG BAN (máy chủ giãn sẵn). */
  groupMentionCommentIds?: ReadonlySet<string>;
}

/**
 * Chuông "cấp 2" (Sếp duyệt 08/10/2026 — thông báo phải được ĐẨY tới, không hỏi
 * vòng): máy chủ tính sẵn danh sách thông báo của TỪNG NGƯỜI bị ảnh hưởng ngay lúc
 * có sự kiện rồi ghi vào `notification-feed/{uid}` (project hpcons-request); trình
 * duyệt chỉ nghe (onSnapshot) đúng tài liệu của mình — xem
 * lib/server/notification-feed.ts và lib/firebase/notification-feed-listener.ts.
 * Rules chỉ cho đọc đúng tài liệu `uid` của mình (firestore.rules).
 */
export const NOTIFICATION_FEED_COLLECTION = "notification-feed";
/** Đổi cấu trúc tài liệu thì tăng số này — client thấy lệch sẽ gọi GET để tính lại. */
export const NOTIFICATION_FEED_VERSION = 1;
/** `profileAt` (lần cuối tính bằng PHIÊN của chính người đó) cũ hơn ngần này → mở app thì
 * gọi GET 1 lần để tính lại: bù cho thứ đổi NGOÀI sự kiện đề xuất (họ tên ở App Tổng, cài
 * đặt, cấu hình nhóm, quản lý trực tiếp, thành viên phòng ban…). Dựa trên `profileAt`, KHÔNG
 * dựa `updatedAt` — người có sự kiện liên tục thì `updatedAt` luôn mới, tên/cài đặt lưu kèm
 * sẽ không bao giờ được làm tươi (review PR #92). Không phải hỏi vòng — 1 lần lúc mở trang. */
export const NOTIFICATION_FEED_STALE_MS = 12 * 60 * 60 * 1000;

/** Tối đa ngần này dòng CHƯA ĐỌC chỉ-theo-dõi (không tính số đỏ) — người theo dõi rất nhiều
 * đề xuất mà không mở bao giờ thì danh sách không phình tới giới hạn 1 MB của tài liệu. */
export const MAX_UNREAD_FOLLOWING_ENTRIES = 50;

export interface StoredNotificationFeed extends NotificationFeed {
  v: number;
  uid: string;
  /** Tên hiển thị lúc tính — sự kiện của người khác tính lại cho mình cần tên này
   * (`history.actor` lưu theo TÊN) mà không phải đọc App Tổng. */
  name: string;
  /** Cài đặt thông báo lúc tính — cùng lý do, đỡ 1 lượt đọc App Tổng mỗi người mỗi sự kiện. */
  settings: NotificationSettings;
  /** Id đề xuất đang có dòng trên chuông — để sự kiện của 1 đề xuất tìm lại đúng những
   * người cần GỠ dòng (vd bị bỏ khỏi người theo dõi, đề xuất bị xoá). */
  requestIds: string[];
  /** Mọi đề xuất có dòng cho người này TRƯỚC khi cắt bớt (đã đọc quá 20, theo dõi chưa đọc
   * quá 50) — sự kiện tính lại chỉ đọc đề xuất "gần đây" + những đề xuất này
   * (feedCandidateRequests), nên phải nhớ cả dòng đang bị cắt để kết quả y như đọc cả kho. */
  trackedRequestIds: string[];
  /** Mốc dữ liệu (ms, thời điểm đọc kho) đã dùng để tính — chặn bản tính cũ ghi đè bản mới. */
  basedOn: number;
  updatedAt: string;
  /** Lần cuối tính bằng phiên của chính người này (GET / đánh dấu đã đọc / đổi cài đặt) — tên
   * + cài đặt lưu kèm tươi tới mốc này. Sự kiện của người khác KHÔNG đổi mốc này. */
  profileAt: string;
  /** Lần tính lại do sự kiện bị lỗi → client gọi GET 1 lần để tự chữa. */
  stale?: boolean;
}

/**
 * Những ai CÓ THỂ có dòng của đề xuất `r` trên chuông — đúng các vai trò mà
 * buildNotificationFeed xét (người gửi, người duyệt, người theo dõi, người bị nhắc tên
 * kể cả qua phòng ban đã giãn sẵn vào `mentionedUids`, người duyệt điều chỉnh). Thiếu
 * quản lý trực tiếp bị "qua mặt" — cần tra App Tổng nên máy chủ tự thêm. Thừa người
 * thì vô hại (tính lại ra y như cũ thì không ghi), thiếu người mới là lỗi.
 */
export function feedRecipientCandidates(r: RequestInstance): string[] {
  const out = new Set<string>();
  out.add(r.submittedBy.uid);
  for (const a of r.approvers ?? []) out.add(a.id);
  for (const a of r.approversSnapshot ?? []) out.add(a.id);
  for (const f of r.followers ?? []) out.add(f.id);
  for (const a of r.pendingAdjustment?.approvers ?? []) out.add(a.uid);
  for (const u of r.adjustmentReviewerUids ?? []) out.add(u);
  // `mentionedUids` đã giãn sẵn MỌI lượt nhắc (người lẫn phòng ban) ra uid lúc tạo bình
  // luận (app/api/requests/[id]/comments). KHÔNG lấy `comments[].mentionIds` — trong đó có
  // id phòng ban thô, thành lượt đọc `notification-feed/{id phòng ban}` vô ích.
  for (const u of r.mentionedUids ?? []) out.add(u);
  out.delete("");
  return [...out];
}

/**
 * Đề xuất cần đọc khi TÍNH LẠI do sự kiện (không đọc cả kho): còn chờ duyệt, đang có điều
 * chỉnh chờ duyệt, có biến động trong cửa sổ hiển thị (`updatedAt` ≥ 14 ngày trước), hoặc
 * nằm trong `keepIds` (trackedRequestIds của những người được tính lại + đề xuất vừa có sự
 * kiện). Ra ĐÚNG kết quả như đọc cả kho vì:
 *  - dòng "phải duyệt" chỉ có ở đề xuất pending / có pendingAdjustment;
 *  - dòng đã đọc chỉ hiện khi `at` ≥ mốc 14 ngày, mà `at` (giờ sự kiện) ≤ `updatedAt`
 *    (mọi thao tác tạo sự kiện đều ghi updatedAt; dòng nhật ký không ghi updatedAt — xoá/
 *    khôi phục, đồng bộ… — đều là dòng "im lặng", xem isQuietHistoryEntry);
 *  - dòng chưa đọc cũ hơn cửa sổ thì đã có trong trackedRequestIds từ lần tính đầy đủ trước
 *    (xem đề xuất không đổi `updatedAt` chỉ làm mất "chưa đọc", không làm hiện dòng mới);
 *  - đề xuất vừa có sự kiện mà không đổi updatedAt (vd thêm người theo dõi) luôn được đưa
 *    vào `keepIds`.
 * Đổi ngoài sự kiện (cài đặt, cấu hình nhóm, phòng ban) thì đường GET đọc cả kho chữa lại.
 * notification-feed.test.ts so 2 cách tính trên dữ liệu ngẫu nhiên.
 */
export function feedCandidateRequests(requests: RequestInstance[], now: number, keepIds: ReadonlySet<string>): RequestInstance[] {
  const floor = new Date(now - READ_ENTRY_WINDOW_DAYS * 86_400_000).toISOString();
  return requests.filter(
    (r) => r.status === "pending" || !!r.pendingAdjustment || (r.updatedAt ?? "") >= floor || keepIds.has(r.id),
  );
}

/** Dòng ĐÃ ĐỌC quá cửa sổ hiển thị thì ẩn — tài liệu lưu sẵn có thể đã tính từ vài ngày
 * trước, client tự lọc theo giờ hiện tại (cùng mốc `readFloor` của buildNotificationFeed;
 * dòng bị ẩn không bao giờ `counted` nên số đỏ không đổi). */
export function hideExpiredEntries(feed: NotificationFeed, now: number): NotificationFeed {
  const floor = new Date(now - READ_ENTRY_WINDOW_DAYS * 86_400_000).toISOString();
  const entries = feed.entries.filter((e) => e.must || e.unread || e.at >= floor);
  if (entries.length === feed.entries.length) return feed;
  return { ...feed, entries, badge: entries.filter((e) => e.counted).length };
}

/** JSON với khoá xếp theo thứ tự — Firestore trả map theo khoá đã sắp xếp, còn object
 * vừa tính thì theo thứ tự tạo, so JSON thường sẽ luôn "khác". */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** 2 bản danh sách giống hệt nhau? — giống thì khỏi ghi (đỡ 1 lượt ghi + 1 lượt đọc
 * ở trình duyệt đang nghe). */
export function sameFeedContent(a: NotificationFeed, b: NotificationFeed): boolean {
  return (
    a.badge === b.badge &&
    a.mustCount === b.mustCount &&
    stableJson(a.entries) === stableJson(b.entries) &&
    stableJson([...(a.trackedRequestIds ?? [])].sort()) === stableJson([...(b.trackedRequestIds ?? [])].sort())
  );
}

/** Sự kiện trang chi tiết bắn sau khi ghi "đã xem" (RequestDetailView) — chuông tải lại. */
export const REQUEST_VIEWED_EVENT = "request-app:viewed";

/** Dòng đã đọc vẫn hiện (không chấm xanh) trong ngần này ngày, tối đa ngần này dòng. */
export const READ_ENTRY_WINDOW_DAYS = 14;
export const MAX_READ_ENTRIES = 20;

const KIND_CATEGORY: Record<NotificationKind, NotificationCategory> = {
  approver_pending: "approver_pending",
  adjustment_pending: "approver_pending",
  own_approved: "own_decided",
  own_rejected: "own_decided",
  own_returned: "own_decided",
  comment_on_mine: "own_decided",
  mentioned: "mentioned",
  following: "following",
  manager_bypassed: "manager_bypassed",
  approver_followup: "approver_followup",
};

const DECISION_ACTIONS = {
  approved: "Đã chấp thuận",
  rejected: "Đã từ chối",
  returned: "Đã trả lại",
  approveAndForward: "Đã chấp thuận và chuyển tiếp",
  forwardFirst: "Đã chuyển tiếp cho duyệt trước",
} as const;
const FORWARD_ACTIONS = [DECISION_ACTIONS.approveAndForward, DECISION_ACTIONS.forwardFirst, "Đã chuyển tiếp"];
const SUBMIT_ACTIONS = ["Đã gửi đề xuất", "Đã gửi lại đề xuất", "Đã chỉnh sửa đề xuất — duyệt lại từ đầu"];

/** Dòng nhật ký do HỆ THỐNG tự ghi hoặc không phải biến động đáng báo. */
export function isQuietHistoryEntry(h: RequestHistoryEntry): boolean {
  if (h.actor === "Hệ thống") return true;
  const a = h.action;
  return (
    a.startsWith("Đã đồng bộ") ||
    a.startsWith("Đồng bộ ") ||
    a.startsWith("QLK CTR CHƯA nhận") ||
    a.startsWith("Đã báo App") ||
    a === "Đã lưu nháp" ||
    a.startsWith("Đã nhân bản từ đề xuất") ||
    a === "Đã xóa đề xuất" ||
    a === "Đã khôi phục đề xuất" ||
    a.startsWith(TABLE_SUPPLEMENT_HISTORY_PREFIX) ||
    a.startsWith(ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX) ||
    DECISION_ATTACHMENT_EDIT_ACTIONS.includes(a)
  );
}

const snippet = (text: string | undefined, max = 70) => {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};
const quoted = (text: string | undefined) => (snippet(text) ? `: “${snippet(text)}”` : "");

interface Activity {
  key: string;
  at: string;
  actor: string;
  type: "submit" | "approved" | "rejected" | "returned" | "forward" | "adjust" | "comment";
  note?: string;
  target?: string;
  commentId?: string;
  mentionIds?: string[];
}

function activitiesOf(r: RequestInstance): Activity[] {
  const out: Activity[] = [];
  r.history.forEach((h, i) => {
    if (isQuietHistoryEntry(h)) return;
    let type: Activity["type"] | null = null;
    if (SUBMIT_ACTIONS.includes(h.action)) type = "submit";
    else if (h.action === DECISION_ACTIONS.approved) type = "approved";
    else if (h.action === DECISION_ACTIONS.rejected) type = "rejected";
    else if (h.action === DECISION_ACTIONS.returned) type = "returned";
    else if (FORWARD_ACTIONS.includes(h.action)) type = "forward";
    else if (h.action.startsWith(ADJUSTMENT_HISTORY_PREFIX)) type = "adjust";
    if (type) out.push({ key: `h${i}`, at: h.at, actor: h.actor, type, note: h.note, target: h.target });
  });
  for (const c of r.comments ?? []) {
    out.push({ key: `c${c.id}`, at: c.at, actor: c.authorName, type: "comment", note: c.text, commentId: c.id, mentionIds: c.mentionIds });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

const PRIORITY: Record<NotificationKind, number> = {
  approver_pending: 100,
  adjustment_pending: 95,
  mentioned: 80,
  own_returned: 75,
  own_rejected: 74,
  own_approved: 73,
  comment_on_mine: 70,
  manager_bypassed: 60,
  approver_followup: 50,
  following: 40,
};

export function buildNotificationFeed(requests: RequestInstance[], ctx: NotificationFeedContext): NotificationFeed {
  const { uid, name, settings } = ctx;
  const enabled = (kind: NotificationKind) => settings?.[KIND_CATEGORY[kind]] !== false;
  const readFloor = new Date(ctx.now - READ_ENTRY_WINDOW_DAYS * 86_400_000).toISOString();
  const entries: NotificationEntry[] = [];

  for (const r of requests) {
    if (r.deletedAt || r.status === "draft") continue;
    const seen = r.viewedAt?.[uid] ?? "";
    const isSubmitter = r.submittedBy.uid === uid;
    const myApprover = r.approvers.find((a) => a.id === uid);
    const isFollower = r.followers.some((f) => f.id === uid);
    const acts = activitiesOf(r).filter((a) => a.actor !== name || a.type === "comment");
    // Bình luận của chính mình không phải "mới" với mình.
    const others = acts.filter((a) => !(a.type === "comment" && (r.comments ?? []).some((c) => c.id === a.commentId && c.authorUid === uid)));

    // key → sự kiện (giữ loại ưu tiên cao nhất khi 1 hoạt động khớp nhiều vai trò).
    const events = new Map<string, NotificationEvent & { must?: boolean }>();
    const add = (key: string, ev: NotificationEvent, must = false) => {
      if (!enabled(ev.kind)) return;
      const cur = events.get(key);
      if (!cur || PRIORITY[ev.kind] > PRIORITY[cur.kind]) events.set(key, { ...ev, must });
    };

    // 1. Đến lượt duyệt.
    if (r.status === "pending" && canApproverAct(r.approvalFlow, r.approvers, uid)) {
      const lastTurn = [...acts].reverse().find((a) => a.type === "submit" || a.type === "forward" || a.type === "approved");
      const forwardedToMe = lastTurn?.type === "forward" && lastTurn.target === name;
      add(
        "turn",
        {
          kind: "approver_pending",
          text: forwardedToMe
            ? `${lastTurn!.actor} chuyển tiếp cho bạn duyệt`
            : `${r.submittedBy.name} gửi đề xuất, chờ bạn duyệt`,
          at: lastTurn?.at ?? r.submittedAt,
        },
        true,
      );
    }
    // 2. Điều chỉnh sau duyệt đang chờ người xem duyệt.
    // Mô hình PR #85: 2 người do người điều chỉnh chọn (hoặc người được chuyển
    // tiếp tới thay đúng phần đó), mỗi người 1 `approvedAt` — dùng chung hàm
    // với danh sách "Đến lượt duyệt" để 2 nơi không hiểu lệch nhau.
    const pa = r.pendingAdjustment;
    if (pa && isAwaitingMyAdjustmentDecision(r, uid)) {
      add(
        "adjust-pending",
        { kind: "adjustment_pending", text: `${pa.requestedByName} đề nghị điều chỉnh sau duyệt${quoted(pa.noiDung)}, chờ bạn duyệt`, at: pa.createdAt },
        true,
      );
    }

    // 3. Người gửi: kết quả cuối cùng (duyệt xong / từ chối / trả lại).
    if (isSubmitter) {
      const finalType = r.status === "approved" ? "approved" : r.status === "rejected" ? "rejected" : r.status === "returned" ? "returned" : null;
      const decision = finalType ? [...others].reverse().find((a) => a.type === finalType) : null;
      if (decision) {
        const kind = finalType === "approved" ? "own_approved" : finalType === "rejected" ? "own_rejected" : "own_returned";
        const verb = finalType === "approved" ? "đã chấp thuận" : finalType === "rejected" ? "đã từ chối" : "đã trả lại";
        add(decision.key, { kind, text: `${decision.actor} ${verb} đề xuất của bạn${finalType === "approved" ? "" : quoted(decision.note)}`, at: decision.at });
      }
    }

    // 4. Bình luận / nhắc tên.
    for (const a of others) {
      if (a.type !== "comment") continue;
      const mentioned = (a.mentionIds ?? []).includes(uid) || (a.commentId ? ctx.groupMentionCommentIds?.has(a.commentId) : false);
      if (mentioned) add(a.key, { kind: "mentioned", text: `${a.actor} nhắc tới bạn${quoted(a.note)}`, at: a.at });
      else if (isSubmitter) add(a.key, { kind: "comment_on_mine", text: `${a.actor} bình luận${quoted(a.note)}`, at: a.at });
      else if (myApprover) add(a.key, { kind: "approver_followup", text: `${a.actor} bình luận${quoted(a.note)}`, at: a.at });
      else if (isFollower) add(a.key, { kind: "following", text: `${a.actor} bình luận${quoted(a.note)}`, at: a.at });
    }

    // 5. Người duyệt đã xử lý xong phần mình: biến động SAU khi mình xử lý.
    if (myApprover && myApprover.decision !== "pending" && !isSubmitter) {
      for (const a of others) {
        if (a.type === "rejected") add(a.key, { kind: "approver_followup", text: `${a.actor} đã từ chối ở bước sau${quoted(a.note)}`, at: a.at });
        else if (a.type === "returned") add(a.key, { kind: "approver_followup", text: `${a.actor} đã trả lại đề xuất${quoted(a.note)}`, at: a.at });
        else if (a.type === "adjust") add(a.key, { kind: "approver_followup", text: `${a.actor} điều chỉnh sau duyệt${quoted(a.note)}`, at: a.at });
      }
    }

    // 6. Người theo dõi.
    if (isFollower && !isSubmitter) {
      // Chỉ báo lần chấp thuận CUỐI (duyệt xong), không báo từng bước duyệt giữa chừng.
      const finalApproval = r.status === "approved" ? [...others].reverse().find((x) => x.type === "approved") : undefined;
      for (const a of others) {
        const t = a.type;
        if (t === "submit") add(a.key, { kind: "following", text: `${a.actor} gửi đề xuất bạn đang theo dõi`, at: a.at });
        else if (t === "approved" && a === finalApproval)
          add(a.key, { kind: "following", text: `${a.actor} đã chấp thuận đề xuất bạn theo dõi`, at: a.at });
        else if (t === "rejected") add(a.key, { kind: "following", text: `${a.actor} đã từ chối đề xuất bạn theo dõi`, at: a.at });
        else if (t === "returned") add(a.key, { kind: "following", text: `${a.actor} đã trả lại đề xuất bạn theo dõi`, at: a.at });
        else if (t === "adjust") add(a.key, { kind: "following", text: `${a.actor} điều chỉnh sau duyệt${quoted(a.note)}`, at: a.at });
      }
    }

    // 7. Quản lý trực tiếp bị chọn người khác duyệt thay.
    if (ctx.bypassedRequestIds?.has(r.id)) {
      add("bypassed", { kind: "manager_bypassed", text: `${r.submittedBy.name} gửi đề xuất và chọn người khác duyệt thay bạn`, at: r.submittedAt });
    }

    if (events.size === 0) continue;
    const list = [...events.values()];
    const mustEv = list.filter((e) => e.must).sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || b.at.localeCompare(a.at))[0];
    const unreadList = list.filter((e) => !e.must && e.at > seen);
    const latest = [...list].sort((a, b) => b.at.localeCompare(a.at))[0];
    const main = mustEv ?? [...unreadList].sort((a, b) => b.at.localeCompare(a.at))[0] ?? latest;
    const must = Boolean(mustEv);
    const unread = unreadList.length > 0;
    const counted = must || unreadList.some((e) => e.kind !== "following");
    const at = [...list].sort((a, b) => b.at.localeCompare(a.at))[0].at;
    if (!must && !unread && at < readFloor) continue;
    entries.push({
      requestId: r.id,
      code: r.code ?? null,
      title: resolveRequestTitle(r),
      groupName: r.groupNameSnapshot,
      must,
      unread,
      counted,
      at,
      main: { kind: main.kind, text: main.text, at: main.at },
      extra: unreadList.filter((e) => e !== main).length,
    });
  }

  const mustEntries = entries.filter((e) => e.must).sort((a, b) => b.at.localeCompare(a.at));
  // Dòng chưa đọc CHỈ do theo dõi (không tính số đỏ) giữ tối đa MAX_UNREAD_FOLLOWING_ENTRIES
  // dòng mới nhất; dòng chưa đọc liên quan trực tiếp (counted) giữ hết.
  let followingKept = 0;
  const unreadEntries = entries
    .filter((e) => !e.must && e.unread)
    .sort((a, b) => b.at.localeCompare(a.at))
    .filter((e) => e.counted || followingKept++ < MAX_UNREAD_FOLLOWING_ENTRIES);
  const readEntries = entries
    .filter((e) => !e.must && !e.unread)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_READ_ENTRIES);
  const entriesOut = [...mustEntries, ...unreadEntries, ...readEntries];
  return {
    entries: entriesOut,
    badge: entriesOut.filter((e) => e.counted).length,
    mustCount: mustEntries.length,
    trackedRequestIds: entries.map((e) => e.requestId),
  };
}
