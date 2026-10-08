import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { canApproverAct } from "@/lib/approval-logic";
import { getHpcoreDb } from "@/lib/hpcore";
import {
  metaAdjustmentPending,
  metaAdjustmentResult,
  metaComment,
  metaFollowApproved,
  metaFollowSubmitted,
  metaPendingApproval,
  metaSubmitterDecision,
  type HpcoreNotificationMeta,
} from "@/lib/hpcore-notification-meta";
import { pendingAdjustmentFiles } from "@/lib/adjustment-settings";
import { NOTIFICATION_TEXT } from "@/lib/notification-feed";
import { resolveRequestTitle } from "@/lib/request-title";
import { requestDetailUrl } from "@/lib/server/mailer";
import { sendWebPushItems, type PushItem } from "@/lib/server/web-push";
import { buildPushPayload, type PushKind } from "@/lib/web-push-payload";
import type { RequestInstance, TaggedUser } from "@/lib/types";

/**
 * Chuông thông báo CHUNG của HPcore (app tổng) — Sếp chốt 07/10/2026: gộp
 * thông báo của Request-app vào Firestore collection `notifications` của
 * HPcore, loại `de_xuat` ("Đề xuất"). Ghi THẲNG bằng chính service account
 * (`HPCORE_FIREBASE_SERVICE_ACCOUNT`) app này đã dùng sẵn để SSO + đọc
 * `users/{uid}` (xem lib/hpcore.ts) — không cần API trung gian, không cần
 * quy đổi uid vì 2 app đã chung 1 mã người dùng.
 *
 * Bắn rồi quên — lỗi ghi (mất mạng, thiếu quyền...) chỉ log, KHÔNG được làm
 * hỏng luồng nghiệp vụ chính của Request-app. Gọi trong `after()` ở nơi gọi,
 * giống hệt cách email (lib/server/notification-emails.ts) đã làm.
 */
const HPCORE_NOTIFICATION_TYPE = "de_xuat";

/** Trường thêm (tuỳ có) để dựng `meta` — tên dòng 2 (fieldsSnapshot/values), người làm
 * (history), người tới lượt (approversSnapshot), người đề nghị điều chỉnh. Nơi gọi đều
 * truyền nguyên đề xuất nên có sẵn; thiếu thì meta dùng câu dự phòng không tên. */
type MetaExtras = Partial<
  Pick<RequestInstance, "fieldsSnapshot" | "values" | "history" | "approversSnapshot" | "pendingAdjustment">
>;

interface HpcoreNotificationEntry {
  userId: string;
  title: string;
  body: string;
  link: string;
  /** Dữ liệu có cấu trúc cho App Tổng hiện dòng y chuông app này (08/10/2026) —
   * `title`/`body` vẫn giữ nguyên câu cũ cho bản App Tổng chưa đọc `meta`. */
  meta: HpcoreNotificationMeta | null;
}

/**
 * Dựng `meta` an toàn: lỗi trong lúc dựng (dữ liệu đề xuất cũ thiếu trường lạ…) KHÔNG được
 * làm mất thông báo — trả null để vẫn ghi thông báo bằng title/body như trước 08/10/2026.
 */
function safeMeta(build: () => HpcoreNotificationMeta): HpcoreNotificationMeta | null {
  try {
    return build();
  } catch (error) {
    console.error("Dựng meta thông báo HPcore lỗi — ghi thông báo không kèm meta:", error);
    return null;
  }
}

async function pushToHpcore(entries: HpcoreNotificationEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const db = getHpcoreDb();
    const batch = db.batch();
    for (const e of entries) {
      const ref = db.collection("notifications").doc();
      batch.set(ref, {
        userId: e.userId,
        title: e.title,
        body: e.body,
        link: e.link,
        ...(e.meta ? { meta: e.meta } : {}),
        type: HPCORE_NOTIFICATION_TYPE,
        isRead: false,
        createdAt: Timestamp.now(),
      });
    }
    await batch.commit();
  } catch (error) {
    console.error("Ghi thông báo sang chuông chung HPcore thất bại (không ảnh hưởng thao tác chính):", error);
  }
}

/**
 * Thông báo "ra màn hình" (Web Push — cấp 3) đi KÈM đúng các điểm ghi chuông chung ở dưới:
 * nơi này đã biết loại sự kiện + người nhận, khỏi tính lại lần 2.
 * 4 nhóm được đẩy: chờ tôi duyệt / được nhắc tên / bình luận trên đề xuất của tôi / kết quả
 * đề xuất của tôi. Người theo dõi KHÔNG đẩy ra màn hình (chỉ có trên chuông); không báo tiến
 * độ từng bước (Sếp chốt câu 4 demo "noi-dung-thong-bao-day-2026-10-08").
 * `actorUid` = người vừa thao tác → không bao giờ tự đẩy cho chính họ.
 */
export interface PushOptions {
  actorUid?: string;
  /** Bình luận: những người được nhắc trong CHÍNH bình luận này — người gửi đề xuất nếu cũng
   * bị nhắc thì chỉ nhận thông báo "nhắc tên" (nhắc tên thắng), không nhận 2 cái. */
  mentionedUids?: string[];
  /** Điều chỉnh được chấp thuận: số người đã duyệt ("Đủ k/k người duyệt"). */
  approverCount?: number;
}

type PushRequest = Pick<RequestInstance, "id" | "groupId" | "code" | "groupNameSnapshot"> &
  Partial<Pick<RequestInstance, "fieldsSnapshot" | "values">>;

/** Đề xuất TRỰC TIẾP (groupId null) lưu TÊN NGƯỜI DÙNG TỰ GÕ vào groupNameSnapshot
 * (app/api/requests/route.ts) — dòng "nhóm" dùng chữ cố định; tên tự gõ vẫn hiện ở dòng
 * "tên đề xuất" (Sếp cho phép hiện tên đề xuất từ 08/10/2026). */
export const DIRECT_REQUEST_PUSH_LABEL = "Đề xuất trực tiếp";

export function pushGroupLabel(request: Pick<RequestInstance, "groupId" | "groupNameSnapshot">): string {
  return typeof request.groupId === "string" && request.groupId ? request.groupNameSnapshot : DIRECT_REQUEST_PUSH_LABEL;
}

/** Tên đề xuất y như chuông hiện; dữ liệu cũ lạ làm hàm ném lỗi → rơi về tên nhóm/snapshot. */
function pushRequestTitle(request: PushRequest): string {
  try {
    return resolveRequestTitle({
      fieldsSnapshot: request.fieldsSnapshot ?? [],
      values: request.values ?? {},
      groupNameSnapshot: request.groupNameSnapshot,
    });
  } catch {
    return request.groupNameSnapshot;
  }
}

type PushExtra = Omit<Parameters<typeof buildPushPayload>[0], "kind" | "requestId" | "code" | "groupName" | "requestTitle" | "hasCustomTitle">;

function pushItem(userId: string, kind: PushKind, request: PushRequest, extra: PushExtra = {}): PushItem {
  const title = pushRequestTitle(request);
  const isGroup = typeof request.groupId === "string" && !!request.groupId;
  return {
    uid: userId,
    payload: buildPushPayload({
      kind,
      requestId: request.id,
      code: request.code,
      groupName: pushGroupLabel(request),
      requestTitle: title,
      // Không có trường "tên đề xuất" → title = tên nhóm, khỏi lặp lại ở 2 dòng.
      hasCustomTitle: !isGroup || title !== request.groupNameSnapshot,
      ...extra,
    }),
  };
}

/** Ghi chuông chung + đẩy ra màn hình SONG SONG — 2 việc độc lập, lỗi bên này không chặn bên kia. */
async function deliverAll(entries: HpcoreNotificationEntry[], pushItems: PushItem[], opts: PushOptions | undefined): Promise<void> {
  await Promise.all([pushToHpcore(entries), sendWebPushItems(pushItems, { actorUid: opts?.actorUid })]);
}

/** "tên đề xuất (mã)" — KHÔNG escape HTML vì HPcore render thẳng dạng text
 * (không dangerouslySetInnerHTML, xem NotificationsPageClient.tsx), không
 * có rủi ro XSS như email (lib/server/mailer.ts) đã phải vá. */
function label(request: Pick<RequestInstance, "groupNameSnapshot" | "code" | "id">): string {
  return `"${request.groupNameSnapshot}" (mã ${request.code ?? request.id})`;
}

export async function hpcorePendingApprovers(
  request: Pick<RequestInstance, "id" | "groupId" | "groupNameSnapshot" | "code" | "approvalFlow" | "approvers" | "submittedBy"> & MetaExtras,
  opts?: PushOptions,
): Promise<void> {
  // Cùng cách tính "ai đang tới lượt" với email (notifyPendingApprovers) — xem
  // lib/server/notification-emails.ts. Khác email ở chỗ KHÔNG đọc công tắc
  // `notificationRules` của nhóm: Sếp chốt 07/10/2026 "HPcore nhận tất cả",
  // chuông chung không có khái niệm tắt theo từng nhóm như email.
  const uids = request.approvers
    .filter((a) => canApproverAct(request.approvalFlow, request.approvers, a.id))
    .map((a) => a.id);
  if (uids.length === 0) return;
  const link = requestDetailUrl(request.id);
  const entries = uids.map((userId) => ({
    userId,
    title: "Đang chờ bạn duyệt",
    body: `Đề xuất ${label(request)} đang chờ bạn xét duyệt.`,
    link,
    meta: safeMeta(() => metaPendingApproval(request, userId)),
  }));
  const pushItems = entries.map((e) => {
    const actorName = e.meta?.actorName ?? request.submittedBy?.name;
    return pushItem(e.userId, "pending_approval", request, {
      actorName,
      // Lượt tới tay người này do được chuyển tiếp → "X chuyển tiếp" thay vì "X gửi".
      forwarded: !!e.meta?.actorName && e.meta.headline === NOTIFICATION_TEXT.forwardedToMe(e.meta.actorName),
    });
  });
  await deliverAll(entries, pushItems, opts);
}

export async function hpcoreSubmitterResult(
  request: Pick<RequestInstance, "id" | "groupId" | "groupNameSnapshot" | "code" | "status" | "submittedBy"> &
    MetaExtras &
    Partial<Pick<RequestInstance, "approvers" | "approvalFlow">>,
  opts?: PushOptions,
): Promise<void> {
  if (request.status !== "approved" && request.status !== "rejected") return;
  const approved = request.status === "approved";
  const entry = {
    userId: request.submittedBy.uid,
    title: approved ? "Đã được chấp thuận" : "Đã bị từ chối",
    body: `Đề xuất ${label(request)} bạn đã gửi ${approved ? "đã được chấp thuận." : "đã bị từ chối."}`,
    link: requestDetailUrl(request.id),
    meta: safeMeta(() => metaSubmitterDecision(request, approved ? "approved" : "rejected")),
  };
  const item = approved
    ? pushItem(entry.userId, "approved", request, {
        actorName: entry.meta?.actorName,
        approverTotal: request.approvers?.length,
        singleApprover: request.approvalFlow === "single",
      })
    : pushItem(entry.userId, "rejected", request, { actorName: entry.meta?.actorName, excerpt: entry.meta?.excerpt });
  await deliverAll([entry], [item], opts);
}

export async function hpcoreSubmitterReturned(
  request: Pick<RequestInstance, "id" | "groupId" | "groupNameSnapshot" | "code" | "submittedBy"> & MetaExtras,
  reason: string | undefined,
  opts?: PushOptions,
): Promise<void> {
  const entry = {
    userId: request.submittedBy.uid,
    title: "Đã bị trả lại",
    body: `Đề xuất ${label(request)} bạn đã gửi đã bị trả lại${reason ? ` — lý do: ${reason}` : "."}`,
    link: requestDetailUrl(request.id),
    meta: safeMeta(() => metaSubmitterDecision(request, "returned", reason)),
  };
  await deliverAll(
    [entry],
    [pushItem(entry.userId, "returned", request, { actorName: entry.meta?.actorName, excerpt: reason ?? entry.meta?.excerpt })],
    opts,
  );
}

export async function hpcoreFollowersSubmitted(
  followers: TaggedUser[],
  request: Pick<RequestInstance, "id" | "groupId" | "groupNameSnapshot" | "code" | "submittedBy"> & MetaExtras,
): Promise<void> {
  if (followers.length === 0) return;
  const link = requestDetailUrl(request.id);
  const meta = safeMeta(() => metaFollowSubmitted(request));
  await pushToHpcore(
    followers.map((f) => ({
      userId: f.id,
      title: "Đề xuất bạn theo dõi vừa được gửi",
      body: `Đề xuất ${label(request)} mà bạn đang theo dõi vừa được gửi.`,
      link,
      meta,
    })),
  );
}

export async function hpcoreFollowersFullyApproved(
  request: Pick<RequestInstance, "id" | "groupId" | "groupNameSnapshot" | "code" | "status" | "followers"> & MetaExtras,
): Promise<void> {
  if (request.status !== "approved" || request.followers.length === 0) return;
  const link = requestDetailUrl(request.id);
  const meta = safeMeta(() => metaFollowApproved(request));
  await pushToHpcore(
    request.followers.map((f) => ({
      userId: f.id,
      title: "Đề xuất bạn theo dõi đã duyệt xong",
      body: `Đề xuất ${label(request)} mà bạn đang theo dõi đã được chấp thuận hoàn toàn.`,
      link,
      meta,
    })),
  );
}

export async function hpcoreCommentOnMine(
  request: Pick<RequestInstance, "id" | "groupId" | "groupNameSnapshot" | "code" | "submittedBy"> & MetaExtras,
  commenterUid: string,
  commenterName: string,
  /** Nội dung bình luận — chỉ dùng cho `meta` (headline/excerpt), `body` giữ câu cũ. */
  commentText?: string,
  opts?: PushOptions,
): Promise<void> {
  if (request.submittedBy.uid === commenterUid) return;
  const entry = {
    userId: request.submittedBy.uid,
    title: "Có bình luận mới",
    body: `${commenterName} bình luận trên đề xuất bạn đã gửi ${label(request)}.`,
    link: requestDetailUrl(request.id),
    meta: safeMeta(() => metaComment(request, "comment_on_mine", commenterName, commentText)),
  };
  // Người gửi cũng bị nhắc tên trong CHÍNH bình luận này → đã có thông báo "nhắc tên" (nhắc
  // tên thắng), không đẩy thêm cái "bình luận mới" trùng nội dung. Chuông vẫn ghi như cũ.
  const mentionedToo = opts?.mentionedUids?.includes(entry.userId) ?? false;
  const items = mentionedToo ? [] : [pushItem(entry.userId, "comment_on_mine", request, { actorName: commenterName, excerpt: commentText })];
  await deliverAll([entry], items, { ...opts, actorUid: opts?.actorUid ?? commenterUid });
}

export async function hpcoreMentioned(
  request: Pick<RequestInstance, "id" | "groupId" | "groupNameSnapshot" | "code"> & MetaExtras,
  mentionedUids: string[],
  commenterName: string,
  commentText?: string,
  opts?: PushOptions,
): Promise<void> {
  if (mentionedUids.length === 0) return;
  const link = requestDetailUrl(request.id);
  const meta = safeMeta(() => metaComment(request, "mentioned", commenterName, commentText));
  const entries = mentionedUids.map((userId) => ({
    userId,
    title: "Bạn được nhắc tên",
    body: `${commenterName} nhắc bạn trong bình luận đề xuất ${label(request)}.`,
    link,
    meta,
  }));
  await deliverAll(
    entries,
    mentionedUids.map((uid) => pushItem(uid, "mentioned", request, { actorName: commenterName, excerpt: commentText })),
    opts,
  );
}

export async function hpcoreAdjustmentPending(
  request: Pick<RequestInstance, "id" | "groupId" | "groupNameSnapshot" | "code"> & MetaExtras,
  uids: string[],
  opts?: PushOptions,
): Promise<void> {
  if (uids.length === 0) return;
  const link = requestDetailUrl(request.id);
  const meta = safeMeta(() => metaAdjustmentPending(request));
  const entries = uids.map((userId) => ({
    userId,
    title: "Điều chỉnh sau duyệt đang chờ bạn duyệt",
    body: `Có 1 điều chỉnh sau duyệt của đề xuất ${label(request)} đang chờ bạn xét duyệt.`,
    link,
    meta,
  }));
  const extra: PushExtra = {
    actorName: request.pendingAdjustment?.requestedByName,
    excerpt: request.pendingAdjustment?.noiDung,
    fileCount: pendingAdjustmentFiles(request.pendingAdjustment).length,
  };
  await deliverAll(entries, uids.map((uid) => pushItem(uid, "adjustment_pending", request, extra)), opts);
}

export async function hpcoreAdjustmentResult(
  request: Pick<RequestInstance, "id" | "groupId" | "groupNameSnapshot" | "code"> & MetaExtras,
  requesterUid: string,
  outcome: "approved" | "rejected",
  /** Người vừa bấm quyết định (người từ chối) — chỉ dùng cho `meta`. */
  actorName?: string,
  opts?: PushOptions,
): Promise<void> {
  const entry = {
    userId: requesterUid,
    title: outcome === "approved" ? "Điều chỉnh sau duyệt đã được chấp thuận" : "Điều chỉnh sau duyệt đã bị từ chối",
    body:
      outcome === "approved"
        ? `Điều chỉnh sau duyệt bạn đã đề nghị cho đề xuất ${label(request)} đã được chấp thuận và áp dụng.`
        : `Điều chỉnh sau duyệt bạn đã đề nghị cho đề xuất ${label(request)} đã bị từ chối.`,
    link: requestDetailUrl(request.id),
    meta: safeMeta(() => metaAdjustmentResult(request, outcome, actorName)),
  };
  const kind = outcome === "approved" ? "adjustment_approved" : "adjustment_rejected";
  await deliverAll([entry], [pushItem(requesterUid, kind, request, { actorName, approverTotal: opts?.approverCount })], opts);
}
