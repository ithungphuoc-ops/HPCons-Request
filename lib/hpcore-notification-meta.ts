import {
  DECISION_ACTIONS,
  FORWARD_ACTIONS,
  isQuietHistoryEntry,
  NOTIFICATION_TEXT,
  SUBMIT_ACTIONS,
} from "@/lib/notification-feed";
import { resolveRequestTitle } from "@/lib/request-title";
import type { RequestInstance } from "@/lib/types";

/**
 * `meta` gắn kèm thông báo gửi sang chuông App Tổng (Sếp duyệt demo
 * "chuong-dong-bo-app-tong-2026-10-08"): App Tổng đọc `meta` để hiện dòng y như chuông
 * của app này — ai làm gì, đoạn bình luận, mã đề xuất · tên — thay cho câu chung chung
 * "Bạn được nhắc tên…". `title`/`body` cũ VẪN GIỮ NGUYÊN cho bản App Tổng cũ chưa đọc meta.
 *
 * Lược đồ CỐ ĐỊNH (App Tổng sửa song song để đọc đúng lược đồ này) — đổi thì tăng `v`.
 * Hàm thuần, không đụng Firestore — test được (hpcore-notification-meta.test.ts).
 */
export type HpcoreNotificationKind =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "returned"
  | "comment_on_mine"
  | "mentioned"
  | "follow_submitted"
  | "follow_approved"
  | "adjustment_pending"
  | "adjustment_approved"
  | "adjustment_rejected";

export interface HpcoreNotificationMeta {
  v: 1;
  kind: HpcoreNotificationKind;
  /** Dòng đầu — đúng câu chữ dòng chuông của app này (NOTIFICATION_TEXT). */
  headline: string;
  actorName?: string;
  /** Đoạn bình luận / lý do — 1 dòng, tối đa EXCERPT_MAX ký tự + "…". */
  excerpt?: string;
  requestCode: string;
  /** Dòng 2 "mã · tên" — đúng tên chuông app này hiện (resolveRequestTitle). */
  groupName: string;
}

export const EXCERPT_MAX = 120;

/** Gộp khoảng trắng/xuống dòng thành 1 dòng, cắt ở EXCERPT_MAX + "…". Rỗng → undefined
 * (Firestore không nhận `undefined` — nơi ghi bỏ hẳn khoá rỗng, xem withoutEmpty). */
export function excerptOf(text: string | null | undefined): string | undefined {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > EXCERPT_MAX ? `${t.slice(0, EXCERPT_MAX)}…` : t;
}

/** Firestore Admin báo lỗi khi gặp giá trị `undefined` — bỏ khoá rỗng trước khi ghi. */
function withoutEmpty(meta: HpcoreNotificationMeta): HpcoreNotificationMeta {
  const out = { ...meta } as Record<string, unknown>;
  for (const k of ["actorName", "excerpt"]) if (out[k] === undefined || out[k] === "") delete out[k];
  return out as unknown as HpcoreNotificationMeta;
}

export type MetaRequest = Pick<RequestInstance, "id" | "code" | "groupNameSnapshot"> &
  Partial<Pick<RequestInstance, "fieldsSnapshot" | "values">>;

function base(request: MetaRequest) {
  return {
    v: 1 as const,
    requestCode: request.code ?? request.id,
    // Cùng nhãn dòng 2 của chuông app này (NotificationEntry.title = resolveRequestTitle).
    groupName: resolveRequestTitle({
      fieldsSnapshot: request.fieldsSnapshot ?? [],
      values: request.values ?? {},
      groupNameSnapshot: request.groupNameSnapshot,
    }),
  };
}

/** Dòng nhật ký "đáng báo" cuối cùng khớp `match` — cùng cách lọc của chuông
 * (isQuietHistoryEntry bỏ dòng hệ thống tự ghi). */
function lastHistory(
  request: Partial<Pick<RequestInstance, "history">>,
  match: (action: string) => boolean,
): RequestInstance["history"][number] | undefined {
  const list = request.history ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i];
    if (!isQuietHistoryEntry(h) && match(h.action)) return h;
  }
  return undefined;
}

/** Người duyệt đang tới lượt: "X chuyển tiếp cho bạn duyệt" nếu lượt cuối là chuyển tiếp
 * ĐÚNG tới người này, ngược lại "Người gửi gửi đề xuất, chờ bạn duyệt" — y logic chuông. */
export function metaPendingApproval(
  request: MetaRequest & Pick<RequestInstance, "submittedBy"> & Partial<Pick<RequestInstance, "history" | "approversSnapshot">>,
  recipientUid: string,
): HpcoreNotificationMeta {
  const recipientName = request.approversSnapshot?.find((a) => a.id === recipientUid)?.name;
  const lastTurn = lastHistory(
    request,
    (a) => SUBMIT_ACTIONS.includes(a) || FORWARD_ACTIONS.includes(a) || a === DECISION_ACTIONS.approved,
  );
  const forwardedToMe = !!lastTurn && FORWARD_ACTIONS.includes(lastTurn.action) && !!recipientName && lastTurn.target === recipientName;
  const actorName = forwardedToMe ? lastTurn!.actor : request.submittedBy.name;
  return withoutEmpty({
    ...base(request),
    kind: "pending_approval",
    headline: forwardedToMe ? NOTIFICATION_TEXT.forwardedToMe(actorName) : NOTIFICATION_TEXT.approverPending(actorName),
    actorName,
  });
}

/** Người gửi nhận kết quả cuối (chấp thuận / từ chối / trả lại). `note` (lý do) truyền
 * thẳng khi nơi gọi có sẵn; không có thì lấy ghi chú trên dòng nhật ký quyết định. */
export function metaSubmitterDecision(
  request: MetaRequest & Partial<Pick<RequestInstance, "history">>,
  type: "approved" | "rejected" | "returned",
  note?: string,
): HpcoreNotificationMeta {
  const h = lastHistory(request, (a) => a === DECISION_ACTIONS[type]);
  const reason = type === "approved" ? undefined : (note ?? h?.note);
  const fallback =
    type === "approved"
      ? "Đề xuất của bạn đã được chấp thuận"
      : type === "rejected"
        ? "Đề xuất của bạn đã bị từ chối"
        : "Đề xuất của bạn đã bị trả lại";
  return withoutEmpty({
    ...base(request),
    kind: type,
    headline: h?.actor ? NOTIFICATION_TEXT.ownDecided(h.actor, type, reason) : fallback,
    actorName: h?.actor,
    excerpt: excerptOf(reason),
  });
}

/** Bình luận: người bị nhắc → "X nhắc tới bạn: “…”"; người gửi → "X bình luận: “…”".
 * Bình luận lưu dạng chữ thường, nhắc tên nằm sẵn trong chữ ("@HauNT") — giữ nguyên như chuông. */
export function metaComment(
  request: MetaRequest,
  kind: "comment_on_mine" | "mentioned",
  actorName: string,
  text?: string,
): HpcoreNotificationMeta {
  return withoutEmpty({
    ...base(request),
    kind,
    headline: kind === "mentioned" ? NOTIFICATION_TEXT.mentioned(actorName, text) : NOTIFICATION_TEXT.commented(actorName, text),
    actorName,
    excerpt: excerptOf(text),
  });
}

export function metaFollowSubmitted(request: MetaRequest & Pick<RequestInstance, "submittedBy">): HpcoreNotificationMeta {
  const actorName = request.submittedBy.name;
  return withoutEmpty({ ...base(request), kind: "follow_submitted", headline: NOTIFICATION_TEXT.followSubmitted(actorName), actorName });
}

/** Người theo dõi: chỉ báo lần chấp thuận CUỐI — người chấp thuận = dòng "Đã chấp thuận" cuối. */
export function metaFollowApproved(request: MetaRequest & Partial<Pick<RequestInstance, "history">>): HpcoreNotificationMeta {
  const actorName = lastHistory(request, (a) => a === DECISION_ACTIONS.approved)?.actor;
  return withoutEmpty({
    ...base(request),
    kind: "follow_approved",
    headline: actorName ? NOTIFICATION_TEXT.followApproved(actorName) : "Đề xuất bạn theo dõi đã được chấp thuận",
    actorName,
  });
}

/**
 * Điều chỉnh sau duyệt chờ duyệt. CỐ Ý không trích `noiDung` (chuông app này có trích):
 * nội dung điều chỉnh thường là số tiền/khối lượng thay đổi, mà chuông App Tổng là nơi
 * ai cũng liếc qua — yêu cầu "không đưa số tiền / nội dung bảng sang App Tổng".
 */
export function metaAdjustmentPending(
  request: MetaRequest & Partial<Pick<RequestInstance, "pendingAdjustment">>,
): HpcoreNotificationMeta {
  const actorName = request.pendingAdjustment?.requestedByName;
  return withoutEmpty({
    ...base(request),
    kind: "adjustment_pending",
    headline: actorName ? NOTIFICATION_TEXT.adjustmentPending(actorName) : "Điều chỉnh sau duyệt đang chờ bạn duyệt",
    actorName,
  });
}

/** Kết quả điều chỉnh cho người đề nghị. Chấp thuận = ĐỦ mọi người duyệt (không có "1 người
 * chấp thuận") nên không gắn tên; từ chối = 1 người từ chối là huỷ → gắn tên người đó. */
export function metaAdjustmentResult(
  request: MetaRequest,
  outcome: "approved" | "rejected",
  actorName?: string,
): HpcoreNotificationMeta {
  if (outcome === "approved") {
    return withoutEmpty({ ...base(request), kind: "adjustment_approved", headline: "Điều chỉnh sau duyệt bạn đề nghị đã được chấp thuận" });
  }
  return withoutEmpty({
    ...base(request),
    kind: "adjustment_rejected",
    headline: actorName ? `${actorName} đã từ chối điều chỉnh sau duyệt bạn đề nghị` : "Điều chỉnh sau duyệt bạn đề nghị đã bị từ chối",
    actorName,
  });
}
