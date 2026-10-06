/**
 * "Đính kèm tệp khi duyệt" — cài đặt theo nhóm cho 4 hành động quyết định: có
 * hiện ô chọn tệp không (`decisionAttachmentEnabled`) và có bắt buộc không
 * (`requireDecisionAttachment`). Sếp duyệt demo
 * tong-quan-demo/base-request-app/dinh-kem-khi-duyet-2026-10-06 (06/10/2026):
 * (1) làm như demo; (2) nhóm cũ mặc định KHÔNG có ô đính kèm; (3) "Trả lại"
 * CÓ ô đính kèm, KHÔNG bắt buộc, không cấu hình được.
 *
 * Hàm THUẦN, dùng chung client (hộp xác nhận, trang cài đặt nhóm) và server
 * (route decision) — cùng mẫu với lib/decision-note.ts.
 *
 * Khác "Ý kiến khi phê duyệt": thiếu field/thiếu key = KHÔNG có ô (tính năng
 * mới, nhóm cũ giữ y hộp duyệt như hiện tại). Không thể bắt buộc 1 ô đang tắt.
 */
import {
  DECISION_NOTE_ACTIONS,
  DECISION_TO_NOTE_ACTION,
  type DecisionNoteAction,
  type DecisionNoteMode,
  type DecisionNoteRule,
  type DecisionNoteRules,
} from "./decision-note";
import type { ProposalGroup, RequestAttachment } from "./types";

export type DecisionAttachmentGroupSettings = Pick<
  ProposalGroup,
  "decisionAttachmentEnabled" | "requireDecisionAttachment"
>;

export type DecisionKind = "approved" | "rejected" | "approve_and_forward" | "forward_then_approve" | "returned";

/** Tối đa số tệp mỗi lần quyết định — bằng trần 1 lần xin link ký sẵn
 * (`MAX_FILES` ở app/api/uploads/sign/route.ts) để tải 1 lượt là xong. */
export const DECISION_ATTACHMENT_MAX_FILES = 6;

/** "Trả lại": luôn có ô, không bắt buộc (Sếp chốt 06/10/2026). */
export const RETURNED_ATTACHMENT_RULE: DecisionNoteRule = { enabled: true, required: false };

/** Quy tắc hiệu lực cho 4 hành động. `group` null/undefined (đề xuất trực
 * tiếp, không tìm thấy nhóm) → không có ô nào. */
export function resolveDecisionAttachmentRules(
  group: Partial<DecisionAttachmentGroupSettings> | null | undefined,
): DecisionNoteRules {
  const enabledFlags = group?.decisionAttachmentEnabled ?? {};
  const req = group?.requireDecisionAttachment ?? {};
  const out = {} as DecisionNoteRules;
  for (const action of DECISION_NOTE_ACTIONS) {
    const enabled = enabledFlags[action] === true;
    out[action] = { enabled, required: enabled && req[action] === true };
  }
  return out;
}

/** Quy tắc cho 1 quyết định thật gửi lên route decision (gồm cả "returned"). */
export function decisionAttachmentRuleFor(
  decision: DecisionKind,
  group: Partial<DecisionAttachmentGroupSettings> | null | undefined,
): DecisionNoteRule {
  if (decision === "returned") return RETURNED_ATTACHMENT_RULE;
  const action: DecisionNoteAction | undefined = DECISION_TO_NOTE_ACTION[decision];
  if (!action) return { enabled: false, required: false };
  return resolveDecisionAttachmentRules(group)[action];
}

/** Cách hộp xác nhận hiển thị ô chọn tệp (cùng kiểu với ô ghi chú). */
export function decisionAttachmentMode(rule: DecisionNoteRule): DecisionNoteMode {
  if (!rule.enabled) return "hidden";
  return rule.required ? "required" : "optional";
}

/** Mô tả 1 hành động trong chế độ xem cài đặt nhóm. */
export function describeDecisionAttachmentRule(rule: DecisionNoteRule): string {
  if (!rule.enabled) return "Không có ô đính kèm";
  return rule.required ? "Có đính kèm · bắt buộc" : "Có đính kèm · không bắt buộc";
}

/** Tệp đính kèm khi duyệt có phải do quyết định ghi vào không. */
export function isDecisionAttachment(att: Pick<RequestAttachment, "source"> | null | undefined): boolean {
  return att?.source === "decision";
}
