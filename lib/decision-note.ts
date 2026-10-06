/**
 * "Ý kiến khi phê duyệt" — cài đặt theo nhóm cho 4 hành động quyết định: có
 * hiện ô ghi chú không (`decisionNoteEnabled`) và có bắt buộc nhập không
 * (`requireDecisionNote`). Sếp duyệt demo
 * tong-quan-demo/base-request-app/y-kien-nguoi-duyet-2026-10-06 (06/10/2026).
 *
 * Hàm THUẦN, dùng chung cho client (hộp xác nhận, trang cài đặt nhóm) lẫn
 * server (route decision) — để 2 phía không thể hiểu lệch nhau.
 *
 * Giữ nguyên hành vi cũ cho nhóm chưa từng đụng cài đặt mới:
 * - Thiếu `decisionNoteEnabled` hoặc thiếu key → CÓ ô ghi chú.
 * - "Từ chối": trước đây LUÔN bắt buộc lý do (không đọc cờ nhóm) → thiếu key
 *   `reject` vẫn coi là bắt buộc.
 * - "Chấp thuận và chuyển tiếp": trước đây server đọc chung cờ `forward` →
 *   thiếu key `approveAndForward` thì theo `forward`.
 * - Không thể bắt buộc 1 ô đang bị ẩn: `enabled === false` ⇒ `required = false`.
 * "Trả lại" KHÔNG thuộc cài đặt này — luôn bắt buộc lý do như cũ.
 */
import type { ProposalGroup } from "./types";

export type DecisionNoteAction = "approve" | "reject" | "forward" | "approveAndForward";

export type DecisionNoteFlags = Partial<Record<DecisionNoteAction, boolean>>;

export const DECISION_NOTE_ACTIONS: readonly DecisionNoteAction[] = [
  "approve",
  "reject",
  "forward",
  "approveAndForward",
];

export const DECISION_NOTE_ACTION_LABELS: Record<DecisionNoteAction, string> = {
  approve: "Chấp thuận",
  reject: "Từ chối",
  forward: "Chuyển tiếp",
  approveAndForward: "Chấp thuận và chuyển tiếp",
};

export interface DecisionNoteRule {
  /** Có hiện ô ghi chú trong hộp xác nhận không. */
  enabled: boolean;
  /** Có chặn để trống không (luôn false khi `enabled` false). */
  required: boolean;
}

export type DecisionNoteRules = Record<DecisionNoteAction, DecisionNoteRule>;

export type DecisionNoteGroupSettings = Pick<ProposalGroup, "requireDecisionNote" | "decisionNoteEnabled">;

/** Quyết định thật gửi lên route decision → hành động trong cài đặt nhóm.
 * "returned" (Trả lại) không thuộc cài đặt → undefined. Khớp
 * `DECISION_TO_APPROVAL_TIME_ACTION` ở lib/approval-logic.ts. */
export const DECISION_TO_NOTE_ACTION: Partial<
  Record<"approved" | "rejected" | "approve_and_forward" | "forward_then_approve" | "returned", DecisionNoteAction>
> = {
  approved: "approve",
  rejected: "reject",
  approve_and_forward: "approveAndForward",
  forward_then_approve: "forward",
};

/** Tính quy tắc hiệu lực cho cả 4 hành động. `group` null/undefined (đề xuất
 * trực tiếp, không tìm thấy nhóm) → mặc định có ô, chỉ "Từ chối" bắt buộc. */
export function resolveDecisionNoteRules(
  group: Partial<DecisionNoteGroupSettings> | null | undefined,
): DecisionNoteRules {
  const req = group?.requireDecisionNote ?? {};
  const enabledFlags = group?.decisionNoteEnabled ?? {};
  const rawRequired: Record<DecisionNoteAction, boolean> = {
    approve: req.approve === true,
    reject: req.reject ?? true,
    forward: req.forward === true,
    approveAndForward: req.approveAndForward ?? req.forward === true,
  };
  const out = {} as DecisionNoteRules;
  for (const action of DECISION_NOTE_ACTIONS) {
    const enabled = enabledFlags[action] !== false;
    out[action] = { enabled, required: enabled && rawRequired[action] === true };
  }
  return out;
}

/** Chuẩn hoá 1 object cờ do client gửi lên: chỉ giữ 4 key hợp lệ, giá trị ép
 * về boolean. Trả `null` nếu không phải object (để route trả lỗi 400). */
export function sanitizeDecisionNoteFlags(value: unknown): DecisionNoteFlags | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const out: DecisionNoteFlags = {};
  for (const action of DECISION_NOTE_ACTIONS) {
    if (action in source) out[action] = source[action] === true;
  }
  return out;
}

/** "Chấp thuận: Có, Từ chối: Không, …" — dùng cho lịch sử chỉnh sửa nhóm. */
export function describeDecisionNoteFlags(value: unknown): string {
  if (!value || typeof value !== "object") return "—";
  const source = value as Record<string, unknown>;
  const parts = DECISION_NOTE_ACTIONS.filter((a) => a in source).map(
    (a) => `${DECISION_NOTE_ACTION_LABELS[a]}: ${source[a] === true ? "Có" : "Không"}`,
  );
  return parts.length ? parts.join(", ") : "—";
}

/** Cách hộp xác nhận hiển thị ô ghi chú cho 1 hành động. */
export type DecisionNoteMode = "hidden" | "optional" | "required";

export function decisionNoteMode(rule: DecisionNoteRule): DecisionNoteMode {
  if (!rule.enabled) return "hidden";
  return rule.required ? "required" : "optional";
}

/**
 * Chuẩn hoá `note` client gửi lên route decision TRƯỚC khi kiểm/ghi lịch sử:
 * - Không phải chuỗi (và không rỗng) → lỗi (route trả 400, tránh `.trim()` ném 500).
 * - Hành động có ô ghi chú đã TẮT trong nhóm → bỏ `note` (không lưu ý kiến
 *   admin đã tắt). "returned" (Trả lại) luôn giữ — luôn bắt buộc lý do.
 */
export function sanitizeDecisionNoteInput(
  decision: "approved" | "rejected" | "approve_and_forward" | "forward_then_approve" | "returned",
  note: unknown,
  group: Partial<DecisionNoteGroupSettings> | null | undefined,
): { ok: true; note: string | undefined } | { ok: false; error: string } {
  if (note === undefined || note === null) return { ok: true, note: undefined };
  if (typeof note !== "string") return { ok: false, error: "Ghi chú không hợp lệ." };
  const action = DECISION_TO_NOTE_ACTION[decision];
  if (action && !resolveDecisionNoteRules(group)[action].enabled) return { ok: true, note: undefined };
  return { ok: true, note };
}
