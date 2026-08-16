import type { ApprovalFlowType, ApproverStepDef, TaggedUser } from "./types";

export type ApproverDecision = "pending" | "approved" | "rejected";

export interface ApproverState {
  id: string;
  decision: ApproverDecision;
}

/**
 * Xác định người duyệt có được phép thao tác ngay bây giờ hay không.
 * - Đồng thời / một người duyệt: ai cũng có thể thao tác bất kỳ lúc nào (miễn còn "pending").
 * - Lần lượt: chỉ người đầu tiên còn "pending" theo thứ tự được phép thao tác (§5.3 quy tắc 3).
 */
export function canApproverAct(
  flow: ApprovalFlowType,
  approvers: ApproverState[],
  approverId: string,
): boolean {
  const approver = approvers.find((a) => a.id === approverId);
  if (!approver || approver.decision !== "pending") return false;

  if (flow !== "sequential") return true;

  const firstPendingIndex = approvers.findIndex((a) => a.decision === "pending");
  return approvers[firstPendingIndex]?.id === approverId;
}

/**
 * Trạng thái tổng thể của đề xuất dựa theo kiểu quy trình xử lý.
 * - Đồng thời: hoàn tất khi TẤT CẢ đã "approved"; hỏng ngay khi có một "rejected".
 * - Lần lượt: giống đồng thời về điều kiện hoàn tất/từ chối, nhưng thứ tự thao tác bị khóa bởi canApproverAct.
 * - Một người duyệt: hoàn tất ngay khi có MỘT approved; chỉ "rejected" khi tất cả đều từ chối.
 */
export function getRequestStatus(
  flow: ApprovalFlowType,
  approvers: ApproverState[],
): "pending" | "approved" | "rejected" {
  if (approvers.length === 0) return "pending";

  if (flow === "single") {
    if (approvers.some((a) => a.decision === "approved")) return "approved";
    if (approvers.every((a) => a.decision === "rejected")) return "rejected";
    return "pending";
  }

  // concurrent & sequential dùng chung điều kiện hoàn tất/từ chối
  if (approvers.some((a) => a.decision === "rejected")) return "rejected";
  if (approvers.every((a) => a.decision === "approved")) return "approved";
  return "pending";
}

/**
 * Loại người trùng khi cùng 1 người được nhiều bước duyệt cùng chọn (vd vừa
 * là "Quản lý trực tiếp" vừa là "Trưởng phòng") — chỉ giữ 1 lần, ở VỊ TRÍ
 * CỦA LẦN XUẤT HIỆN SAU CÙNG (đúng tuỳ chọn "Ưu tiên vai trò của khối xuất
 * hiện sau cùng nhất" của Base.vn) để thứ tự duyệt "Lần lượt" phản ánh đúng
 * bước sau cùng thay vì bước đầu tiên trùng người. Áp dụng TRƯỚC khi build
 * approversSnapshot/approvers ban đầu — không đổi shape ApproverState.
 */
export function dedupeApprovers(users: TaggedUser[]): TaggedUser[] {
  const lastIndexById = new Map<string, number>();
  users.forEach((u, i) => lastIndexById.set(u.id, i));
  return users.filter((u, i) => lastIndexById.get(u.id) === i);
}

/**
 * Đủ danh sách người của 1 bước duyệt "fixed" — bước mới (từ 16/08/2026) lưu
 * mảng `users` (nhiều người/1 bước, tất cả phải duyệt), bước cũ chỉ có `user`
 * số ít. LUÔN đọc qua hàm này thay vì `step.user` trực tiếp, trừ khi cố ý chỉ
 * cần người đầu tiên (vd sinh mã bước từ tên).
 */
export function fixedStepUsers(step: Extract<ApproverStepDef, { kind: "fixed" }>): TaggedUser[] {
  return step.users?.length ? step.users : [step.user];
}

export class ApprovalActionError extends Error {}

/**
 * Xác định 1 hành động duyệt có đang THIẾU ghi chú bắt buộc hay không —
 * "rejected"/"returned" LUÔN bắt buộc (không phụ thuộc cấu hình nhóm, giữ
 * đúng hành vi cũ); "approved"/"forwarded" chỉ bắt buộc khi nhóm bật cờ
 * tương ứng trong `requireDecisionNote`. Trả về true = còn thiếu (chặn),
 * false = đủ điều kiện tiếp tục.
 */
export function missingRequiredNote(
  decision: "approved" | "rejected" | "approve_and_forward" | "forward_then_approve" | "returned",
  note: string | undefined,
  requireDecisionNote: { approve?: boolean; forward?: boolean } | undefined,
): boolean {
  const hasNote = Boolean(note?.trim());
  if (decision === "rejected" || decision === "returned") return !hasNote;
  if (decision === "approved") return Boolean(requireDecisionNote?.approve) && !hasNote;
  if (decision === "approve_and_forward" || decision === "forward_then_approve") {
    return Boolean(requireDecisionNote?.forward) && !hasNote;
  }
  return false;
}

/** Kiểm tra chung cho cả 2 kiểu "chuyển tiếp" bên dưới — dùng lại 1 chỗ tránh
 * lệch thông báo lỗi. Ném lỗi nếu người chuyển chưa tới lượt/đã quyết định,
 * hoặc người nhận đã có mặt trong danh sách người duyệt. */
function assertCanForward(
  flow: ApprovalFlowType,
  approvers: ApproverState[],
  fromApproverId: string,
  toApproverId: string,
): void {
  if (!canApproverAct(flow, approvers, fromApproverId)) {
    throw new ApprovalActionError(
      `Người duyệt ${fromApproverId} chưa tới lượt hoặc đã xử lý đề xuất này.`,
    );
  }
  if (approvers.some((a) => a.id === toApproverId)) {
    throw new ApprovalActionError(
      `${toApproverId} đã có mặt trong danh sách người duyệt của đề xuất này.`,
    );
  }
}

/**
 * "Chấp nhận và chuyển tiếp" — người duyệt hiện tại CHẤP THUẬN ngay (được
 * ghi nhận đã duyệt, không mất quyền), đồng thời thêm 1 người duyệt mới vào
 * NGAY SAU vị trí của mình. Dùng khi 1 người duyệt xong rồi đẩy lên 1 người
 * khác (thường cấp trên hơn) duyệt tiếp — ví dụ Sếp: "nhân viên duyệt và
 * chuyển lên cho 1 người cấp trên hơn duyệt".
 */
export function approveAndForward(
  flow: ApprovalFlowType,
  approvers: ApproverState[],
  fromApproverId: string,
  toApproverId: string,
): ApproverState[] {
  assertCanForward(flow, approvers, fromApproverId, toApproverId);
  const index = approvers.findIndex((a) => a.id === fromApproverId);
  const next = [...approvers];
  next[index] = { ...next[index], decision: "approved" };
  next.splice(index + 1, 0, { id: toApproverId, decision: "pending" });
  return next;
}

/**
 * "Chuyển tiếp và Duyệt" — thêm 1 người duyệt mới vào NGAY TRƯỚC vị trí
 * người đang chuyển tiếp; người mới xử lý trước, xong mới TỚI LƯỢT người
 * chuyển tiếp (vẫn còn nguyên trong danh sách, "pending", KHÔNG mất quyền
 * duyệt) tự quyết định tiếp. Dùng khi cấp trên chưa hiểu rõ đề xuất, muốn
 * cấp dưới hiểu việc xem/duyệt trước rồi mới quay lại mình quyết định —
 * ví dụ Sếp: "cấp trên chưa hiểu đề nghị này mà cấp dưới hiểu thì đưa xuống
 * cấp dưới duyệt trước tiên rồi quay lại cấp trên duyệt".
 *
 * LƯU Ý: thứ tự chỉ thực sự chặn được người chuyển tiếp thao tác trước ở
 * quy trình "lần lượt" (sequential) — quy trình "đồng thời"/"một người duyệt"
 * không có khái niệm thứ tự nên người chuyển tiếp vẫn thao tác được ngay,
 * giống mọi người duyệt khác trong 2 quy trình đó (canApproverAct không xét
 * thứ tự khi flow !== "sequential").
 */
export function forwardThenApprove(
  flow: ApprovalFlowType,
  approvers: ApproverState[],
  fromApproverId: string,
  toApproverId: string,
): ApproverState[] {
  assertCanForward(flow, approvers, fromApproverId, toApproverId);
  const index = approvers.findIndex((a) => a.id === fromApproverId);
  const next = [...approvers];
  next.splice(index, 0, { id: toApproverId, decision: "pending" });
  return next;
}

/**
 * Áp dụng quyết định của một người duyệt, tôn trọng ràng buộc thứ tự của quy trình lần lượt.
 * Ném lỗi nếu người này chưa tới lượt hoặc đã quyết định rồi.
 */
export function applyApproverDecision(
  flow: ApprovalFlowType,
  approvers: ApproverState[],
  approverId: string,
  decision: "approved" | "rejected",
): ApproverState[] {
  if (!canApproverAct(flow, approvers, approverId)) {
    throw new ApprovalActionError(
      `Người duyệt ${approverId} chưa tới lượt hoặc đã xử lý đề xuất này.`,
    );
  }

  return approvers.map((a) => (a.id === approverId ? { ...a, decision } : a));
}
