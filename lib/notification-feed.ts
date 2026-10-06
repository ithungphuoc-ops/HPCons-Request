import { canApproverAct } from "@/lib/approval-logic";
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
    const pa = r.pendingAdjustment;
    if (pa && pa.approvers.some((a) => a.uid === uid && !a.approvedAt)) {
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
  const unreadEntries = entries.filter((e) => !e.must && e.unread).sort((a, b) => b.at.localeCompare(a.at));
  const readEntries = entries
    .filter((e) => !e.must && !e.unread)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_READ_ENTRIES);
  const entriesOut = [...mustEntries, ...unreadEntries, ...readEntries];
  return {
    entries: entriesOut,
    badge: entriesOut.filter((e) => e.counted).length,
    mustCount: mustEntries.length,
  };
}
