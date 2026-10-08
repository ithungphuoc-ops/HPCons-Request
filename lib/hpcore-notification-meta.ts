import {
  DECISION_ACTIONS,
  FORWARD_ACTIONS,
  isQuietHistoryEntry,
  NOTIFICATION_TEXT,
  quoted,
  SUBMIT_ACTIONS,
} from "@/lib/notification-feed";
import { resolveRequestTitle } from "@/lib/request-title";
import { clipGraphemes } from "@/lib/text-clip";
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
  /** Mã đề xuất; đề xuất chưa có mã → "" (KHÔNG dùng id Firestore 20 ký tự — chuông app
   * này khi không có mã chỉ hiện tên, dòng 2 App Tổng phải y vậy). */
  requestCode: string;
  /** TÊN ĐỀ XUẤT đúng như dòng 2 chuông app này hiện (resolveRequestTitle: trường tên đề
   * xuất nếu có, không thì tên nhóm). Tên khoá giữ `groupName` vì là hợp đồng với App Tổng. */
  groupName: string;
}

export const EXCERPT_MAX = 120;

/** Gộp khoảng trắng/xuống dòng thành 1 dòng, cắt ở EXCERPT_MAX + "…". Rỗng → undefined
 * (Firestore không nhận `undefined` — nơi ghi bỏ hẳn khoá rỗng, xem withoutEmpty). */
export function excerptOf(text: string | null | undefined): string | undefined {
  // Cắt theo cụm ký tự (không vỡ emoji / dấu tổ hợp) + bỏ ký tự điều khiển — lib/text-clip.ts.
  return clipGraphemes(text, EXCERPT_MAX) || undefined;
}

/** Firestore App Tổng (lib/hpcore.ts) KHÔNG bật ignoreUndefinedProperties — 1 giá trị
 * `undefined` bất kỳ trong meta làm hỏng CẢ lượt ghi thông báo. Nên: bỏ mọi khoá
 * undefined/null; actorName/excerpt rỗng cũng bỏ; requestCode/groupName luôn là chuỗi. */
function withoutEmpty(meta: HpcoreNotificationMeta): HpcoreNotificationMeta {
  const out = { ...meta, requestCode: meta.requestCode ?? "", groupName: meta.groupName ?? "" } as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    if (out[k] === undefined || out[k] === null) delete out[k];
    else if ((k === "actorName" || k === "excerpt") && out[k] === "") delete out[k];
  }
  return out as unknown as HpcoreNotificationMeta;
}

/** Tên người làm: rỗng/toàn khoảng trắng → undefined, để dùng câu dự phòng không tên
 * (tránh câu bắt đầu bằng dấu cách " gửi đề xuất…"). */
function nameOf(name: string | null | undefined): string | undefined {
  const t = (name ?? "").trim();
  return t || undefined;
}

export type MetaRequest = Pick<RequestInstance, "id" | "code" | "groupNameSnapshot"> &
  Partial<Pick<RequestInstance, "fieldsSnapshot" | "values">>;

function base(request: MetaRequest) {
  return {
    v: 1 as const,
    requestCode: request.code ?? "",
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
  const actorName = nameOf(forwardedToMe ? lastTurn!.actor : request.submittedBy?.name);
  return withoutEmpty({
    ...base(request),
    kind: "pending_approval",
    headline: !actorName
      ? "Có đề xuất đang chờ bạn duyệt"
      : forwardedToMe
        ? NOTIFICATION_TEXT.forwardedToMe(actorName)
        : NOTIFICATION_TEXT.approverPending(actorName),
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
  const actorName = nameOf(h?.actor);
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
    headline: actorName ? NOTIFICATION_TEXT.ownDecided(actorName, type, reason) : fallback,
    actorName,
    excerpt: excerptOf(reason),
  });
}

/** Bình luận: người bị nhắc → "X nhắc tới bạn: “…”"; người gửi → "X bình luận: “…”".
 * Bình luận lưu dạng chữ thường, nhắc tên nằm sẵn trong chữ ("@HauNT") — giữ nguyên như chuông. */
export function metaComment(
  request: MetaRequest,
  kind: "comment_on_mine" | "mentioned",
  actor: string,
  text?: string,
): HpcoreNotificationMeta {
  const actorName = nameOf(actor);
  const headline = actorName
    ? kind === "mentioned"
      ? NOTIFICATION_TEXT.mentioned(actorName, text)
      : NOTIFICATION_TEXT.commented(actorName, text)
    : `${kind === "mentioned" ? "Bạn được nhắc tên trong bình luận" : "Có bình luận mới"}${quoted(text)}`;
  return withoutEmpty({
    ...base(request),
    kind,
    headline,
    actorName,
    excerpt: excerptOf(text),
  });
}

export function metaFollowSubmitted(request: MetaRequest & Pick<RequestInstance, "submittedBy">): HpcoreNotificationMeta {
  const actorName = nameOf(request.submittedBy?.name);
  return withoutEmpty({
    ...base(request),
    kind: "follow_submitted",
    headline: actorName ? NOTIFICATION_TEXT.followSubmitted(actorName) : "Đề xuất bạn theo dõi vừa được gửi",
    actorName,
  });
}

/** Người theo dõi: chỉ báo lần chấp thuận CUỐI — người chấp thuận = dòng "Đã chấp thuận" cuối. */
export function metaFollowApproved(request: MetaRequest & Partial<Pick<RequestInstance, "history">>): HpcoreNotificationMeta {
  const actorName = nameOf(lastHistory(request, (a) => a === DECISION_ACTIONS.approved)?.actor);
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
  const actorName = nameOf(request.pendingAdjustment?.requestedByName);
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
  actor?: string,
): HpcoreNotificationMeta {
  const actorName = nameOf(actor);
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
