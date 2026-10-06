import "server-only";
import { canApproverAct } from "@/lib/approval-logic";
import { buildRequestEmailHtml, escapeHtml, resolveUserEmail, sendMail } from "@/lib/server/mailer";
import { DEFAULT_GROUP_NOTIFICATION_RULES } from "@/lib/types";
import type { EmailNotifyCategory, GroupNotificationRules, RequestInstance, TaggedUser } from "@/lib/types";

/** Chỉ cần đúng field `notificationRules` — nhận cả `ProposalGroup` đầy đủ
 * lẫn 1 object rút gọn (vd đọc trực tiếp từ Firestore doc trong route quyết
 * định, không cần dựng nguyên `ProposalGroup`). `null`/`undefined` = đề xuất
 * TRỰC TIẾP (không thuộc nhóm nào) — phân biệt với "nhóm thật nhưng chưa cấu
 * hình notificationRules" (vẫn là 1 object, chỉ field con undefined). */
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
  // Đề xuất TRỰC TIẾP (không nhóm) không có công tắc nào để cấu hình riêng —
  // Sếp chốt 06/10/2026: mặc định BẬT, khác hẳn "nhóm thật nhưng chưa bật
  // emailNotify" (vẫn TẮT như trước, giữ đúng hành vi nhóm cũ không tự nhiên
  // bắt đầu gửi mail). 2 trường hợp phân biệt được vì `group` chỉ là `null`
  // khi route gọi hàm KHÔNG có groupId nào cả (xem từng nơi gọi).
  if (group == null) return true;
  return group.notificationRules?.emailNotify === true;
}

function currentlyActionableUids(request: RequestInstance): string[] {
  return request.approvers
    .filter((a) => canApproverAct(request.approvalFlow, request.approvers, a.id))
    .map((a) => a.id);
}

/** "tên đề xuất (mã)" đã escape HTML — dùng chung cho cả 4 hàm gửi mail bên
 * dưới, tránh escape rời rạc/lỡ quên 1 chỗ. `groupNameSnapshot` của đề xuất
 * TRỰC TIẾP (không groupId) do người dùng tự đặt (`title`) — KHÔNG được tin
 * thẳng khi chèn vào HTML email (vá lỗ hổng CodeRabbit phát hiện, xem
 * escapeHtml() ở lib/server/mailer.ts). */
function escapedRequestLabel(request: Pick<RequestInstance, "groupNameSnapshot" | "code" | "id">): string {
  const name = escapeHtml(request.groupNameSnapshot);
  const code = escapeHtml(request.code ?? request.id);
  return `<b>"${name}"</b> (mã ${code})`;
}

async function sendToUid(
  uid: string,
  subject: string,
  html: string,
  emailCategory: { groupId: string | null; category: EmailNotifyCategory },
) {
  try {
    const email = await resolveUserEmail(uid, emailCategory);
    if (!email) {
      // 2 lý do có thể (không phân biệt được ở đây, resolveUserEmail() gộp
      // chung để chỉ đọc 1 lần users/{uid}): (a) danh bạ App Tổng không có
      // email, hoặc (b) chính người này đã tự tắt loại thông báo này cho
      // đúng nhóm này (công tắc riêng, Sếp chốt 21/09/2026) — trường hợp (b)
      // là CHỦ Ý của người dùng, không phải lỗi, nhưng vẫn log ở mức thông
      // tin để không lặp lại bài học "im lặng khó dò" của lỗi thiếu email cũ.
      console.warn(`[mailer] BỎ QUA gửi email cho uid ${uid}: thiếu email trong danh bạ, hoặc người này đã tự tắt loại thông báo này cho nhóm hiện tại.`);
      return;
    }
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
    body: `Đề xuất ${escapedRequestLabel(request)} đang chờ bạn xét duyệt.`,
    requestId: request.id,
    ctaLabel: "Xem đề xuất",
  });
  await Promise.all(
    targetUids.map((uid) => sendToUid(uid, subject, html, { groupId: request.groupId, category: "approver_pending" })),
  );
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
    body: `Đề xuất ${escapedRequestLabel(request)} bạn đã gửi ${
      request.status === "approved" ? "đã được <b>chấp thuận</b>" : "đã <b>bị từ chối</b>"
    }.`,
    requestId: request.id,
    ctaLabel: "Xem đề xuất",
  });
  await sendToUid(request.submittedBy.uid, subject, html, { groupId: request.groupId, category: "own_decided" });
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
    body: `Đề xuất ${escapedRequestLabel(request)} mà bạn đang theo dõi vừa được gửi.`,
    requestId: request.id,
    ctaLabel: "Xem đề xuất",
  });
  await Promise.all(
    followers.map((f) => sendToUid(f.id, subject, html, { groupId: request.groupId, category: "following" })),
  );
}

/** Gọi khi đề xuất vừa được chấp thuận HOÀN TOÀN — báo người theo dõi. */
export async function notifyFollowersFullyApproved(request: RequestInstance, group: GroupNotificationSource) {
  if (!emailNotifyEnabled(group)) return;
  if (request.status !== "approved" || request.followers.length === 0) return;

  const subject = `[App Đề xuất] Đề xuất bạn đang theo dõi "${request.groupNameSnapshot}" đã được chấp thuận`;
  const html = buildRequestEmailHtml({
    greeting: "Xin chào,",
    body: `Đề xuất ${escapedRequestLabel(request)} mà bạn đang theo dõi đã được <b>chấp thuận hoàn toàn</b>.`,
    requestId: request.id,
    ctaLabel: "Xem đề xuất",
  });
  await Promise.all(
    request.followers.map((f) => sendToUid(f.id, subject, html, { groupId: request.groupId, category: "following" })),
  );
}

/** "Điều chỉnh đề nghị sau duyệt" (06/10/2026): báo đúng những người VỪA được
 * giao duyệt điều chỉnh — lúc gửi điều chỉnh (2 người được chọn) hoặc lúc 1
 * người chuyển tiếp cho người khác (chỉ người nhận). Theo công tắc email của
 * nhóm (`emailNotify`) và công tắc riêng "approver_pending" của từng người,
 * giống email "đang chờ bạn duyệt". Chuông thông báo trong app thì LUÔN có
 * (scope `adjustment-inbox`), không phụ thuộc email. */
export async function notifyAdjustmentApprovers(
  uids: string[],
  request: Pick<RequestInstance, "id" | "groupId" | "groupNameSnapshot" | "code">,
  requestedByName: string,
  group: GroupNotificationSource,
) {
  if (!emailNotifyEnabled(group) || uids.length === 0) return;
  const subject = `[App Đề xuất] Điều chỉnh "${request.groupNameSnapshot}" đang chờ bạn duyệt`;
  const html = buildRequestEmailHtml({
    greeting: "Xin chào,",
    body: `${escapeHtml(requestedByName)} đề nghị điều chỉnh đề xuất ${escapedRequestLabel(request)} (đã duyệt) và chọn bạn duyệt điều chỉnh này. Điều chỉnh chỉ có hiệu lực khi đủ người được chọn duyệt.`,
    requestId: request.id,
    ctaLabel: "Xem điều chỉnh",
  });
  await Promise.all(
    uids.map((uid) => sendToUid(uid, subject, html, { groupId: request.groupId, category: "approver_pending" })),
  );
}

/** Gọi khi quyết định "Trả lại" (effect "none" của applyDecisionToRequest) —
 * trước đây luồng này KHÔNG gửi email nào cả (chỉ có chuông trong app). Báo
 * người tạo đề xuất kèm lý do trả lại — Đợt 3 Email, Sếp chốt 06/10/2026.
 * Dùng chung category "own_decided" với kết quả duyệt/từ chối (cùng ý nghĩa
 * "kết quả cho người tạo", người dùng chỉ cần 1 công tắc bật/tắt cho cả 3). */
export async function notifySubmitterReturned(
  request: RequestInstance,
  group: GroupNotificationSource,
  reason: string | undefined,
) {
  if (!emailNotifyEnabled(group)) return;

  const subject = `[App Đề xuất] "${request.groupNameSnapshot}" đã bị trả lại`;
  const html = buildRequestEmailHtml({
    greeting: "Xin chào,",
    body: `Đề xuất ${escapedRequestLabel(request)} bạn đã gửi đã <b>bị trả lại</b>${
      reason ? ` với lý do: ${escapeHtml(reason)}` : ""
    }.`,
    requestId: request.id,
    ctaLabel: "Xem đề xuất",
  });
  await sendToUid(request.submittedBy.uid, subject, html, { groupId: request.groupId, category: "own_decided" });
}

/** Gọi khi "Điều chỉnh sau duyệt" đã có kết quả cuối (đủ người duyệt → áp
 * dụng thật vào history, HOẶC 1 người từ chối → huỷ hẳn) — báo người đã đề
 * nghị điều chỉnh đó (`pendingAdjustment.requestedByUid`, cần truyền vào
 * TRƯỚC khi field này bị xoá khỏi đề xuất). Trước đây luồng này KHÔNG gửi
 * email nào cả (chỉ có `notifyAdjustmentApprovers` ở trên báo NGƯỜI DUYỆT lúc
 * đang chờ — hàm này báo NGƯỜI ĐỀ NGHỊ lúc đã xong). Đợt 3 Email, Sếp chốt
 * 06/10/2026. */
export async function notifyAdjustmentRequesterResult(
  request: RequestInstance,
  group: GroupNotificationSource,
  outcome: "approved" | "rejected",
  requesterUid: string,
) {
  if (!emailNotifyEnabled(group)) return;

  const subject = `[App Đề xuất] Điều chỉnh sau duyệt của "${request.groupNameSnapshot}" đã ${
    outcome === "approved" ? "được chấp thuận" : "bị từ chối"
  }`;
  const html = buildRequestEmailHtml({
    greeting: "Xin chào,",
    body: `Điều chỉnh sau duyệt bạn đã đề nghị cho đề xuất ${escapedRequestLabel(request)} ${
      outcome === "approved" ? "đã được <b>chấp thuận</b> và áp dụng" : "đã <b>bị từ chối</b>"
    }.`,
    requestId: request.id,
    ctaLabel: "Xem đề xuất",
  });
  await sendToUid(requesterUid, subject, html, { groupId: request.groupId, category: "own_decided" });
}
