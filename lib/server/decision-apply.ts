/**
 * Áp 1 quyết định duyệt lên ẢNH CHỤP đề xuất — phần THUẦN (không đọc/ghi
 * Firestore, không gọi R2, không gửi email) của route
 * `app/api/requests/[id]/decision/route.ts`.
 *
 * Vì sao tách (06/10/2026, Sếp duyệt "sửa luôn"): route cũ đọc đề xuất NGOÀI
 * transaction rồi ghi đè cả mảng `approvers` + `history` → 2 thao tác cùng
 * lúc (2 người duyệt song song ở luồng "đồng thời", hoặc thay tệp + duyệt)
 * có thể đè mất lượt/dòng lịch sử của nhau. Nay route gọi hàm này BÊN TRONG
 * `adminDb.runTransaction` với ảnh chụp đọc bằng `tx.get` — Firestore tự chạy
 * lại callback nếu đề xuất bị đổi giữa chừng, nên hàm phải:
 *   · không có tác dụng phụ (chạy lại bao nhiêu lần cũng được),
 *   · tự kiểm lại mọi điều kiện phụ thuộc dữ liệu (tới lượt chưa, tệp đã có
 *     trong đề xuất chưa, field "Mẫu form phê duyệt" theo bước…).
 *
 * Các điều kiện CHỈ phụ thuộc cài đặt nhóm (ghi chú bắt buộc, cờ cho chuyển
 * tiếp duyệt trước, hợp lệ của tệp) vẫn kiểm ở route trước transaction.
 */
import {
  ApprovalActionError,
  applyApproverDecision,
  approveAndForward,
  canApproverAct,
  DECISION_TO_APPROVAL_TIME_ACTION,
  forwardThenApprove,
  getRequestStatus,
  isApprovalTimeValueMissing,
} from "@/lib/approval-logic";
import { recomputeDeadlineForNextStep } from "@/lib/server/requests";
import type {
  ApprovalTimeField,
  RequestAttachment,
  RequestHistoryEntry,
  RequestInstance,
  RequestStatus,
  TaggedUser,
} from "@/lib/types";

export type DecisionKind = "approved" | "rejected" | "approve_and_forward" | "forward_then_approve" | "returned";

export const DECISION_ACTION_LABEL: Record<DecisionKind, string> = {
  approved: "Đã chấp thuận",
  rejected: "Đã từ chối",
  approve_and_forward: "Đã chấp thuận và chuyển tiếp",
  forward_then_approve: "Đã chuyển tiếp cho duyệt trước",
  returned: "Đã trả lại",
};

/** Cài đặt nhóm cần cho phần áp quyết định (đọc trước transaction). */
export interface DecisionGroupSettings {
  approvalTimeFields: ApprovalTimeField[];
  approverSlaEnabled: boolean | undefined;
  slaByWorkCalendar: boolean | undefined;
  groupSlaHours: number | null;
}

export interface DecisionApplyInput {
  decision: DecisionKind;
  target?: TaggedUser;
  /** Ghi chú ĐÃ chuẩn hoá (sanitizeDecisionNoteInput) ở route. */
  note: string | undefined;
  approvalTimeValue: unknown;
  actor: { uid: string; name: string };
  group: DecisionGroupSettings;
  /** Tệp đã kiểm/đo trên R2 ở route (trước transaction). */
  decisionAttachments: RequestAttachment[];
  nowIso: string;
}

/** Loại tác dụng phụ route phải chạy SAU khi transaction ghi xong. */
export type DecisionEffectKind = "none" | "forward" | "decision";

export type DecisionApplyResult =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      /** Các field ghi bằng tx.update (CHƯA gồm `attachments` — route nối
       * thêm bằng arrayUnion). */
      patch: Partial<RequestInstance>;
      /** Đề xuất sau khi ghi (gồm cả `attachments` đã nối) — trả về client +
       * dùng cho email. */
      updated: RequestInstance;
      effect: DecisionEffectKind;
      /** Trạng thái mới (chỉ có nghĩa với effect "decision"). */
      status: RequestStatus;
    };

function fail(status: number, error: string): DecisionApplyResult {
  return { ok: false, status, error };
}

/**
 * Tính bản ghi mới cho 1 quyết định. Hành vi từng nhánh giữ y hệt route cũ
 * (trước 06/10/2026); lỗi "chưa tới lượt / đã xử lý / người nhận đã có mặt"
 * trả 409 (trước đây ApprovalActionError → apiErrorResponse → 409, cùng
 * thông báo).
 */
export function applyDecisionToRequest(current: RequestInstance, input: DecisionApplyInput): DecisionApplyResult {
  const { decision, actor, group, nowIso } = input;
  try {
    // Tệp đã kiểm hợp lệ trước transaction, nhưng đề xuất có thể vừa được
    // thêm đúng tệp đó bởi thao tác khác → kiểm lại trên ảnh chụp mới nhất
    // (cùng thông báo với sanitizeDecisionAttachmentsInput).
    const existingPaths = new Set((current.attachments ?? []).map((a) => a.path));
    const dup = input.decisionAttachments.find((a) => existingPaths.has(a.path));
    if (dup) return fail(400, `Tệp "${dup.name}" đã có trong đề xuất.`);

    // "Mẫu form phê duyệt" — server TỰ xác định field khớp (bước × hành động
    // của NGƯỜI ĐANG QUYẾT ĐỊNH). Chỉ tin `approverStepMeta` theo index khi độ
    // dài KHỚP ĐÚNG `approvers` (dữ liệu cũ từng lệch mảng — xem
    // recomputeDeadlineForNextStep()).
    let matchedApprovalTimeField: ApprovalTimeField | undefined;
    const decisionAction = DECISION_TO_APPROVAL_TIME_ACTION[decision];
    const alignedStepMeta =
      current.approverStepMeta?.length === current.approvers.length ? current.approverStepMeta : undefined;
    if (decisionAction) {
      const myIndex = current.approvers.findIndex((a) => a.id === actor.uid);
      const myStepCode = myIndex >= 0 ? alignedStepMeta?.[myIndex]?.code : undefined;
      if (myStepCode) {
        matchedApprovalTimeField = group.approvalTimeFields.find(
          (f) => f.approverStepCode === myStepCode && f.decisionAction === decisionAction,
        );
      }
    }
    if (matchedApprovalTimeField && isApprovalTimeValueMissing(matchedApprovalTimeField.field, input.approvalTimeValue)) {
      return fail(400, `Cần điền "${matchedApprovalTimeField.field.name}" trước khi tiếp tục.`);
    }
    // Lưu vào `approvalTimeValues` (TÁCH BIỆT `values`), key = id field server
    // đã xác nhận. Không có field khớp → giữ nguyên giá trị cũ.
    const approvalTimeValues = matchedApprovalTimeField
      ? { ...(current.approvalTimeValues ?? {}), [matchedApprovalTimeField.id]: input.approvalTimeValue }
      : current.approvalTimeValues;

    const attachmentNamesPart: Pick<RequestHistoryEntry, "attachmentNames"> = input.decisionAttachments.length
      ? { attachmentNames: input.decisionAttachments.map((a) => a.name) }
      : {};
    const attachmentsAfter = input.decisionAttachments.length
      ? { attachments: [...(current.attachments ?? []), ...input.decisionAttachments] }
      : {};
    const viewedAt = { ...current.viewedAt, [actor.uid]: nowIso };

    if (decision === "returned") {
      if (!canApproverAct(current.approvalFlow, current.approvers, actor.uid)) {
        return fail(409, "Bạn chưa tới lượt hoặc đã xử lý đề xuất này.");
      }
      // Trả lại reset toàn bộ người duyệt về "pending" — gửi lại thì quy trình
      // chạy lại từ đầu (§3.5).
      const approvers = current.approvers.map((a) => ({ ...a, decision: "pending" as const }));
      const history = [
        ...current.history,
        { at: nowIso, actor: actor.name, action: DECISION_ACTION_LABEL.returned, note: input.note, ...attachmentNamesPart },
      ];
      const patch: Partial<RequestInstance> = { approvers, status: "returned", history, updatedAt: nowIso, viewedAt };
      return {
        ok: true,
        patch,
        updated: { ...current, ...patch, ...attachmentsAfter },
        effect: "none",
        status: "returned",
      };
    }

    if (decision === "approve_and_forward" || decision === "forward_then_approve") {
      const target = input.target;
      if (!target) return fail(400, "Thiếu người nhận chuyển tiếp.");
      // Ném ApprovalActionError nếu chưa tới lượt / đã quyết định / người nhận
      // đã có mặt → 409. Người chuyển KHÔNG bị thay thế ở cả 2 kiểu nên
      // approversSnapshot phải CHÈN người mới.
      const approvers =
        decision === "approve_and_forward"
          ? approveAndForward(current.approvalFlow, current.approvers, actor.uid, target.id)
          : forwardThenApprove(current.approvalFlow, current.approvers, actor.uid, target.id);
      const selfIndex = current.approversSnapshot.findIndex((a) => a.id === actor.uid);
      const insertIndex = decision === "approve_and_forward" ? selfIndex + 1 : selfIndex;
      const approversSnapshot = [...current.approversSnapshot];
      approversSnapshot.splice(insertIndex, 0, target);
      // `approverStepMeta` PHẢI cùng độ dài/thứ tự với `approversSnapshot` —
      // người được chuyển tới là bổ sung tạm thời nên chèn 1 mục rỗng {}.
      const approverStepMeta = current.approverStepMeta ? [...current.approverStepMeta] : undefined;
      approverStepMeta?.splice(insertIndex, 0, {});
      const history = [
        ...current.history,
        {
          at: nowIso,
          actor: actor.name,
          action: DECISION_ACTION_LABEL[decision],
          target: target.name,
          note: input.note,
          ...attachmentNamesPart,
        },
      ];
      const deadlineAt = recomputeDeadlineForNextStep({
        approvalFlow: current.approvalFlow,
        status: current.status,
        approvers,
        approverStepMeta,
        approverSlaEnabled: group.approverSlaEnabled,
        groupSlaHours: group.groupSlaHours,
        slaByWorkCalendar: group.slaByWorkCalendar,
        now: new Date(nowIso),
      });
      const patch: Partial<RequestInstance> = {
        approvers,
        approversSnapshot,
        approverStepMeta,
        history,
        updatedAt: nowIso,
        approvalTimeValues,
        viewedAt,
      };
      if (deadlineAt !== undefined) patch.deadlineAt = deadlineAt;
      return {
        ok: true,
        patch,
        updated: { ...current, ...patch, ...attachmentsAfter },
        effect: "forward",
        status: current.status,
      };
    }

    if (decision !== "approved" && decision !== "rejected") {
      return fail(400, "Quyết định không hợp lệ.");
    }

    // Ném ApprovalActionError nếu chưa tới lượt hoặc đã quyết định → 409.
    const approvers = applyApproverDecision(current.approvalFlow, current.approvers, actor.uid, decision);
    const status = getRequestStatus(current.approvalFlow, approvers);
    const history = [
      ...current.history,
      { at: nowIso, actor: actor.name, action: DECISION_ACTION_LABEL[decision], note: input.note, ...attachmentNamesPart },
    ];
    const deadlineAt = recomputeDeadlineForNextStep({
      approvalFlow: current.approvalFlow,
      status,
      approvers,
      approverStepMeta: current.approverStepMeta,
      approverSlaEnabled: group.approverSlaEnabled,
      groupSlaHours: group.groupSlaHours,
      slaByWorkCalendar: group.slaByWorkCalendar,
      now: new Date(nowIso),
    });
    const patch: Partial<RequestInstance> = { approvers, status, history, updatedAt: nowIso, approvalTimeValues, viewedAt };
    if (deadlineAt !== undefined) patch.deadlineAt = deadlineAt;
    return {
      ok: true,
      patch,
      updated: { ...current, ...patch, ...attachmentsAfter },
      effect: "decision",
      status,
    };
  } catch (error) {
    if (error instanceof ApprovalActionError) return fail(409, error.message);
    throw error;
  }
}
