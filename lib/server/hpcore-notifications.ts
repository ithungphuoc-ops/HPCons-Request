import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { canApproverAct } from "@/lib/approval-logic";
import { getHpcoreDb } from "@/lib/hpcore";
import { requestDetailUrl } from "@/lib/server/mailer";
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

interface HpcoreNotificationEntry {
  userId: string;
  title: string;
  body: string;
  link: string;
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

/** "tên đề xuất (mã)" — KHÔNG escape HTML vì HPcore render thẳng dạng text
 * (không dangerouslySetInnerHTML, xem NotificationsPageClient.tsx), không
 * có rủi ro XSS như email (lib/server/mailer.ts) đã phải vá. */
function label(request: Pick<RequestInstance, "groupNameSnapshot" | "code" | "id">): string {
  return `"${request.groupNameSnapshot}" (mã ${request.code ?? request.id})`;
}

export async function hpcorePendingApprovers(
  request: Pick<RequestInstance, "id" | "groupNameSnapshot" | "code" | "approvalFlow" | "approvers">,
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
  await pushToHpcore(
    uids.map((userId) => ({
      userId,
      title: "Đang chờ bạn duyệt",
      body: `Đề xuất ${label(request)} đang chờ bạn xét duyệt.`,
      link,
    })),
  );
}

export async function hpcoreSubmitterResult(
  request: Pick<RequestInstance, "id" | "groupNameSnapshot" | "code" | "status" | "submittedBy">,
): Promise<void> {
  if (request.status !== "approved" && request.status !== "rejected") return;
  const approved = request.status === "approved";
  await pushToHpcore([
    {
      userId: request.submittedBy.uid,
      title: approved ? "Đã được chấp thuận" : "Đã bị từ chối",
      body: `Đề xuất ${label(request)} bạn đã gửi ${approved ? "đã được chấp thuận." : "đã bị từ chối."}`,
      link: requestDetailUrl(request.id),
    },
  ]);
}

export async function hpcoreSubmitterReturned(
  request: Pick<RequestInstance, "id" | "groupNameSnapshot" | "code" | "submittedBy">,
  reason: string | undefined,
): Promise<void> {
  await pushToHpcore([
    {
      userId: request.submittedBy.uid,
      title: "Đã bị trả lại",
      body: `Đề xuất ${label(request)} bạn đã gửi đã bị trả lại${reason ? ` — lý do: ${reason}` : "."}`,
      link: requestDetailUrl(request.id),
    },
  ]);
}

export async function hpcoreFollowersSubmitted(
  followers: TaggedUser[],
  request: Pick<RequestInstance, "id" | "groupNameSnapshot" | "code">,
): Promise<void> {
  if (followers.length === 0) return;
  const link = requestDetailUrl(request.id);
  await pushToHpcore(
    followers.map((f) => ({
      userId: f.id,
      title: "Đề xuất bạn theo dõi vừa được gửi",
      body: `Đề xuất ${label(request)} mà bạn đang theo dõi vừa được gửi.`,
      link,
    })),
  );
}

export async function hpcoreFollowersFullyApproved(
  request: Pick<RequestInstance, "id" | "groupNameSnapshot" | "code" | "status" | "followers">,
): Promise<void> {
  if (request.status !== "approved" || request.followers.length === 0) return;
  const link = requestDetailUrl(request.id);
  await pushToHpcore(
    request.followers.map((f) => ({
      userId: f.id,
      title: "Đề xuất bạn theo dõi đã duyệt xong",
      body: `Đề xuất ${label(request)} mà bạn đang theo dõi đã được chấp thuận hoàn toàn.`,
      link,
    })),
  );
}

export async function hpcoreCommentOnMine(
  request: Pick<RequestInstance, "id" | "groupNameSnapshot" | "code" | "submittedBy">,
  commenterUid: string,
  commenterName: string,
): Promise<void> {
  if (request.submittedBy.uid === commenterUid) return;
  await pushToHpcore([
    {
      userId: request.submittedBy.uid,
      title: "Có bình luận mới",
      body: `${commenterName} bình luận trên đề xuất bạn đã gửi ${label(request)}.`,
      link: requestDetailUrl(request.id),
    },
  ]);
}

export async function hpcoreMentioned(
  request: Pick<RequestInstance, "id" | "groupNameSnapshot" | "code">,
  mentionedUids: string[],
  commenterName: string,
): Promise<void> {
  if (mentionedUids.length === 0) return;
  const link = requestDetailUrl(request.id);
  await pushToHpcore(
    mentionedUids.map((userId) => ({
      userId,
      title: "Bạn được nhắc tên",
      body: `${commenterName} nhắc bạn trong bình luận đề xuất ${label(request)}.`,
      link,
    })),
  );
}

export async function hpcoreAdjustmentPending(
  request: Pick<RequestInstance, "id" | "groupNameSnapshot" | "code">,
  uids: string[],
): Promise<void> {
  if (uids.length === 0) return;
  const link = requestDetailUrl(request.id);
  await pushToHpcore(
    uids.map((userId) => ({
      userId,
      title: "Điều chỉnh sau duyệt đang chờ bạn duyệt",
      body: `Có 1 điều chỉnh sau duyệt của đề xuất ${label(request)} đang chờ bạn xét duyệt.`,
      link,
    })),
  );
}

export async function hpcoreAdjustmentResult(
  request: Pick<RequestInstance, "id" | "groupNameSnapshot" | "code">,
  requesterUid: string,
  outcome: "approved" | "rejected",
): Promise<void> {
  await pushToHpcore([
    {
      userId: requesterUid,
      title: outcome === "approved" ? "Điều chỉnh sau duyệt đã được chấp thuận" : "Điều chỉnh sau duyệt đã bị từ chối",
      body:
        outcome === "approved"
          ? `Điều chỉnh sau duyệt bạn đã đề nghị cho đề xuất ${label(request)} đã được chấp thuận và áp dụng.`
          : `Điều chỉnh sau duyệt bạn đã đề nghị cho đề xuất ${label(request)} đã bị từ chối.`,
      link: requestDetailUrl(request.id),
    },
  ]);
}
