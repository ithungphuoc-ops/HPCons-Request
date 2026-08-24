import "server-only";
import { canApproverAct } from "@/lib/approval-logic";
import { buildRequestEmailHtml, resolveUserEmail, sendMail } from "@/lib/server/mailer";
import { DEFAULT_GROUP_NOTIFICATION_RULES } from "@/lib/types";
import type { GroupNotificationRules, RequestInstance, TaggedUser } from "@/lib/types";

/** Chỉ cần đúng field `notificationRules` — nhận cả `ProposalGroup` đầy đủ
 * lẫn 1 object rút gọn (vd đọc trực tiếp từ Firestore doc trong route quyết
 * định, không cần dựng nguyên `ProposalGroup`). */
type GroupNotificationSource = { notificationRules?: GroupNotificationRules } | null | undefined;

/**
 * Gửi email thông báo THẬT cho 1 đề xuất — Sếp chốt 24/08/2026. Chỉ gửi khi
 * `group.notificationRules.emailNotify` bật (mặc định TẮT — nhóm cũ/chưa
 * cấu hình gì thì không tự nhiên bắt đầu gửi email). 2 cờ còn lại
 * (`sequentialTurnBasedNotify`/`perStepBlockNotify`) quyết định AI trong số
 * người duyệt được báo — mặc định cả 2 đều BẬT, khớp đúng cách tính "ai
 * đang tới lượt" (`canApproverAct`) đã dùng cho mọi nơi khác trong app, nên
 * hành vi mặc định = gửi cho đúng người có thể thao tác NGAY BÂY GIỜ:
 * - Luồng "Lần lượt": CHỈ người đang tới lượt (đúng ý "Loại duyệt lần lượt...
 *   người duyệt chỉ nhận khi đến lượt") — cờ `sequentialTurnBasedNotify`.
 * - Luồng "Đồng thời"/"Chỉ cần 1 người": TẤT CẢ người còn "pending" cùng lúc
 *   (đúng ý "thông báo theo từng khối người duyệt") — cờ `perStepBlockNotify`.
 * Tắt cờ tương ứng với luồng đang dùng → KHÔNG gửi email cho người duyệt
 * (không có hành vi thay thế nào khác được mô tả, nên coi là "tắt hẳn").
 * Bắn rồi quên — lỗi gửi mail (thiếu cấu hình/mạng) KHÔNG được throw ra
 * ngoài, không ảnh hưởng response chính của route gọi hàm này.
 */
function emailNotifyEnabled(group: GroupNotificationSource): boolean {
  return group?.notificationRules?.emailNotify === true;
}

function currentlyActionableUids(request: RequestInstance): string[] {
  return request.approvers
    .filter((a) => canApproverAct(request.approvalFlow, request.approvers, a.id))
    .map((a) => a.id);
}

async function sendToUid(uid: string, subject: string, html: string) {
  try {
    const email = await resolveUserEmail(uid);
    if (!email) return;
    await sendMail({ to: email, subject, html });
  } catch (error) {
    console.error("Gửi email thông báo cho 1 người thất bại (bỏ qua, không ảnh hưởng luồng chính):", error);
  }
}

/** Gọi ngay sau khi gửi đề xuất lần đầu, HOẶC sau mỗi quyết định còn làm đề
 * xuất "pending" (chuyển sang bước/người kế tiếp) — báo đúng người vừa tới
 * lượt (không báo lại người đã từng được báo ở bước trước). */
export async function notifyPendingApprovers(request: RequestInstance, group: GroupNotificationSource) {
  if (!emailNotifyEnabled(group)) return;
  const rules = { ...DEFAULT_GROUP_NOTIFICATION_RULES, ...group?.notificationRules };
  const allowed = request.approvalFlow === "sequential" ? rules.sequentialTurnBasedNotify : rules.perStepBlockNotify;
  if (!allowed) return;

  const targetUids = currentlyActionableUids(request);
  const subject = `[App Đề xuất] "${request.groupNameSnapshot}" đang chờ bạn duyệt`;
  const html = buildRequestEmailHtml({
    greeting: "Xin chào,",
    body: `Đề xuất <b>"${request.groupNameSnapshot}"</b> (mã ${request.code ?? request.id}) đang chờ bạn xét duyệt.`,
    requestId: request.id,
    ctaLabel: "Xem đề xuất",
  });
  await Promise.all(targetUids.map((uid) => sendToUid(uid, subject, html)));
}

/** Gọi khi đề xuất vừa hoàn tất (approved/rejected) — báo cho người tạo,
 * "luôn nhận được thông báo" bất kể cờ turn-based/block (2 cờ đó chỉ áp
 * dụng cho người DUYỆT, không áp dụng cho người TẠO đề xuất). */
export async function notifySubmitterResult(request: RequestInstance, group: GroupNotificationSource) {
  if (!emailNotifyEnabled(group)) return;
  if (request.status !== "approved" && request.status !== "rejected") return;

  const subject = `[App Đề xuất] "${request.groupNameSnapshot}" đã ${
    request.status === "approved" ? "được chấp thuận" : "bị từ chối"
  }`;
  const html = buildRequestEmailHtml({
    greeting: "Xin chào,",
    body: `Đề xuất <b>"${request.groupNameSnapshot}"</b> (mã ${request.code ?? request.id}) bạn đã gửi ${
      request.status === "approved" ? "đã được <b>chấp thuận</b>" : "đã <b>bị từ chối</b>"
    }.`,
    requestId: request.id,
    ctaLabel: "Xem đề xuất",
  });
  await sendToUid(request.submittedBy.uid, subject, html);
}

/** Gọi lúc gửi đề xuất lần đầu — báo người theo dõi biết có đề xuất mới
 * ("người theo dõi chỉ nhận khi đề xuất được tạo hoặc chấp thuận hoàn
 * toàn"). Followers chưa được lọc theo `sequentialTurnBasedNotify` vì mô tả
 * cờ này chỉ nói tới hành vi người theo dõi, không nói cờ nào kiểm soát nó
 * riêng — coi là LUÔN áp dụng khi `emailNotify` bật, không phụ thuộc 2 cờ
 * turn-based/block. */
export async function notifyFollowersSubmitted(followers: TaggedUser[], request: RequestInstance, group: GroupNotificationSource) {
  if (!emailNotifyEnabled(group)) return;
  if (followers.length === 0) return;

  const subject = `[App Đề xuất] Đề xuất bạn đang theo dõi "${request.groupNameSnapshot}" vừa được gửi`;
  const html = buildRequestEmailHtml({
    greeting: "Xin chào,",
    body: `Đề xuất <b>"${request.groupNameSnapshot}"</b> (mã ${request.code ?? request.id}) mà bạn đang theo dõi vừa được gửi.`,
    requestId: request.id,
    ctaLabel: "Xem đề xuất",
  });
  await Promise.all(followers.map((f) => sendToUid(f.id, subject, html)));
}

/** Gọi khi đề xuất vừa được chấp thuận HOÀN TOÀN — báo người theo dõi. */
export async function notifyFollowersFullyApproved(request: RequestInstance, group: GroupNotificationSource) {
  if (!emailNotifyEnabled(group)) return;
  if (request.status !== "approved" || request.followers.length === 0) return;

  const subject = `[App Đề xuất] Đề xuất bạn đang theo dõi "${request.groupNameSnapshot}" đã được chấp thuận`;
  const html = buildRequestEmailHtml({
    greeting: "Xin chào,",
    body: `Đề xuất <b>"${request.groupNameSnapshot}"</b> (mã ${request.code ?? request.id}) mà bạn đang theo dõi đã được <b>chấp thuận hoàn toàn</b>.`,
    requestId: request.id,
    ctaLabel: "Xem đề xuất",
  });
  await Promise.all(request.followers.map((f) => sendToUid(f.id, subject, html)));
}
