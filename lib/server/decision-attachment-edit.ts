/**
 * "Sửa tệp đính kèm khi duyệt" (Sếp duyệt demo 06/10/2026) — phần THUẦN của
 * route app/api/requests/[id]/attachments/decision: nhận bản đề xuất ĐỌC
 * TRONG transaction + yêu cầu thay/gỡ, trả mảng `attachments` mới + dòng
 * lịch sử cần ghi (hoặc lỗi kèm mã HTTP). Không gọi R2/Firestore để test được;
 * route đo kích thước thật của tệp mới trên R2 TRƯỚC khi mở transaction.
 *
 * Không xoá phần tử nào: tệp cũ được đánh dấu `removedAt`/`removedBy` (+
 * `replacedByPath` khi thay), tệp mới nối vào cuối với `replacesPath`. Dòng
 * lịch sử quyết định gốc KHÔNG bị sửa — lib/approver-opinions.ts tự đi theo
 * chuỗi thay thế để ý kiến cũ trỏ đúng tệp hiện hành.
 */
import { extractApproverOpinions, type ApproverOpinionKind } from "@/lib/approver-opinions";
import {
  decisionAttachmentRuleFor,
  type DecisionAttachmentGroupSettings,
  type DecisionKind,
} from "@/lib/decision-attachment";
import { checkDecisionAttachmentEdit, type DecisionAttachmentEditDenied } from "@/lib/decision-attachment-edit";
import {
  DECISION_ATTACHMENT_REMOVED_ACTION,
  DECISION_ATTACHMENT_REPLACED_ACTION,
} from "@/lib/request-history-labels";
import { isFreshOwnUploadPath } from "@/lib/server/decision-attachments";
import { REQUEST_DELETED_MESSAGE } from "@/lib/server/request-write-guard";
import type { RequestAttachment, RequestHistoryEntry, RequestInstance } from "@/lib/types";

export type DecisionAttachmentEditInput =
  | { action: "remove"; path: string }
  | { action: "replace"; path: string; file: { name: string; path: string; size: number } };

/** Kiểm dạng body client gửi (chưa đụng dữ liệu đề xuất). */
export function parseDecisionAttachmentEditBody(
  raw: unknown,
): { ok: true; input: DecisionAttachmentEditInput } | DecisionAttachmentEditDenied {
  const body = raw as { action?: unknown; path?: unknown; file?: unknown } | null;
  if (!body || typeof body !== "object" || typeof body.path !== "string" || !body.path) {
    return { ok: false, status: 400, error: "Thiếu tệp cần sửa." };
  }
  if (body.action === "remove") return { ok: true, input: { action: "remove", path: body.path } };
  if (body.action === "replace") {
    const f = body.file as Partial<{ name: unknown; path: unknown; size: unknown }> | null;
    if (
      !f ||
      typeof f !== "object" ||
      typeof f.path !== "string" ||
      !f.path ||
      typeof f.name !== "string" ||
      !f.name.trim()
    ) {
      return { ok: false, status: 400, error: "Tệp thay thế không hợp lệ." };
    }
    return {
      ok: true,
      input: {
        action: "replace",
        path: body.path,
        file: {
          name: f.name.trim().slice(0, 255),
          path: f.path,
          size: typeof f.size === "number" && f.size >= 0 ? f.size : 0,
        },
      },
    };
  }
  return { ok: false, status: 400, error: "Thao tác không hợp lệ." };
}

const KIND_TO_DECISION: Record<ApproverOpinionKind, DecisionKind> = {
  approved: "approved",
  rejected: "rejected",
  approveAndForward: "approve_and_forward",
  forward: "forward_then_approve",
  returned: "returned",
};

export type PlanDecisionAttachmentEditResult =
  | { ok: true; attachments: RequestAttachment[]; historyEntry: RequestHistoryEntry; history: RequestHistoryEntry[] }
  | DecisionAttachmentEditDenied;

/**
 * @param verifiedSize kích thước THẬT của tệp mới đo trên R2 (route đo trước);
 *   bỏ qua với "remove".
 */
export function planDecisionAttachmentEdit(params: {
  request: Pick<RequestInstance, "status" | "attachments" | "history" | "approversSnapshot" | "approvers"> &
    Partial<Pick<RequestInstance, "deletedAt">>;
  input: DecisionAttachmentEditInput;
  actor: { uid: string; name: string; isAdmin: boolean };
  group: Partial<DecisionAttachmentGroupSettings> | null | undefined;
  nowIso: string;
  verifiedSize?: number;
}): PlanDecisionAttachmentEditResult {
  const { request, input, actor, group, nowIso } = params;
  // Đề xuất bị xoá mềm xen giữa lúc đọc trước và transaction → không ghi.
  if (request.deletedAt) return { ok: false, status: 409, error: REQUEST_DELETED_MESSAGE };
  const all = request.attachments ?? [];
  const idx = all.findIndex((a) => a.path === input.path);
  const target = idx >= 0 ? all[idx] : undefined;

  const allowed = checkDecisionAttachmentEdit({
    status: request.status,
    att: target,
    uid: actor.uid,
    isAdmin: actor.isAdmin,
  });
  if (!allowed.ok) return allowed;
  const old = target as RequestAttachment;

  const removedBy = { uid: actor.uid, name: actor.name };
  let attachments: RequestAttachment[];
  let historyEntry: RequestHistoryEntry;

  if (input.action === "remove") {
    // Hành động gốc đang BẮT BUỘC đính kèm và đây là tệp còn hiệu lực cuối
    // cùng của ý kiến đó → không cho gỡ, chỉ cho thay. Quy tắc đọc theo cài
    // đặt HIỆN TẠI của nhóm (giống route decision).
    const opinion = extractApproverOpinions({
      history: request.history ?? [],
      approversSnapshot: request.approversSnapshot ?? [],
      approvers: request.approvers ?? [],
      attachments: all,
    }).find((o) => o.attachments.some((a) => a.path === old.path));
    if (opinion) {
      const rule = decisionAttachmentRuleFor(KIND_TO_DECISION[opinion.kind], group);
      const stillActive = opinion.attachments.filter((a) => a.path && a.path !== old.path).length;
      if (rule.required && stillActive === 0) {
        return {
          ok: false,
          status: 400,
          error: "Hành động này bắt buộc đính kèm tệp — không gỡ được tệp cuối cùng, chỉ thay bằng tệp khác được.",
        };
      }
    }
    attachments = all.map((a, i) => (i === idx ? { ...a, removedAt: nowIso, removedBy } : a));
    historyEntry = { at: nowIso, actor: actor.name, action: DECISION_ATTACHMENT_REMOVED_ACTION, note: old.name };
  } else {
    const file = input.file;
    if (!isFreshOwnUploadPath(file.path, actor.uid, Date.parse(nowIso))) {
      return { ok: false, status: 400, error: "Tệp không hợp lệ — chỉ chấp nhận tệp bạn vừa tải lên." };
    }
    if (all.some((a) => a.path === file.path)) {
      return { ok: false, status: 400, error: `Tệp "${file.name}" đã có trong đề xuất.` };
    }
    const replacement: RequestAttachment = {
      name: file.name,
      path: file.path,
      size: params.verifiedSize ?? file.size,
      source: "decision",
      addedBy: actor.name,
      addedByUid: actor.uid,
      addedAt: nowIso,
      replacesPath: old.path,
    };
    attachments = [
      ...all.map((a, i) => (i === idx ? { ...a, removedAt: nowIso, removedBy, replacedByPath: file.path } : a)),
      replacement,
    ];
    historyEntry = {
      at: nowIso,
      actor: actor.name,
      action: DECISION_ATTACHMENT_REPLACED_ACTION,
      note: `${old.name} → ${file.name}`,
    };
  }

  return { ok: true, attachments, historyEntry, history: [...(request.history ?? []), historyEntry] };
}
