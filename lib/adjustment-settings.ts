/**
 * "Điều chỉnh đề nghị sau duyệt" — cách mới Sếp duyệt demo
 * tong-quan-demo/base-request-app/dieu-chinh-tu-chon-nguoi-duyet-2026-10-06
 * (06/10/2026), thay bảng "nhánh theo phòng ban" của PR #68:
 *
 * - Hộp Điều chỉnh hiện cảnh báo vàng = "Hướng dẫn điều chỉnh sau duyệt"
 *   (1 nội dung CHUNG toàn app, Owner/Admin soạn ở "Cài đặt chung").
 * - Người điều chỉnh BẮT BUỘC chọn ĐÚNG 2 người duyệt (khác nhau, không phải
 *   chính mình, đang hoạt động ở App Tổng) — duyệt cùng lúc, đủ cả 2 mới có
 *   hiệu lực (AND, giữ cơ chế `pendingAdjustment` sẵn có).
 * - Ô Ghi chú / Đính kèm tệp cài theo NHÓM (cùng kiểu bảng "Ý kiến khi phê
 *   duyệt"); luôn phải có ít nhất 1 trong 2 thì mới gửi được.
 *
 * Hàm THUẦN — dùng chung client (hộp điều chỉnh, trang cài đặt) và server
 * (route adjustment) để 2 phía không hiểu lệch nhau.
 */
import { HISTORY_ACTION, sameName } from "./approver-progress";
import type { DecisionNoteMode, DecisionNoteRule } from "./decision-note";
import type { ProposalGroup, RequestAttachment, RequestInstance, TaggedUser } from "./types";

/** Số người duyệt điều chỉnh người điều chỉnh PHẢI chọn (Sếp chốt: đúng 2). */
export const ADJUSTMENT_APPROVER_COUNT = 2;

/** Tối đa số tệp mỗi lần điều chỉnh — bằng trần 1 lần xin link ký sẵn, cùng
 * con số với "Đính kèm tệp khi duyệt". */
export const ADJUSTMENT_ATTACHMENT_MAX_FILES = 6;

/** Độ dài tối đa nội dung hướng dẫn chung. */
export const ADJUSTMENT_GUIDE_MAX_LENGTH = 2000;

/** Nội dung mặc định khi Owner/Admin chưa từng soạn (giống demo). */
export const DEFAULT_ADJUSTMENT_GUIDE = [
  "• NV Thu mua điều chỉnh: chọn NGƯỜI DUYỆT CUỐI của đề nghị này duyệt lại.",
  "• Người khác điều chỉnh: chọn TRƯỞNG PHÒNG THU MUA + NGƯỜI DUYỆT CUỐI.",
  "• Điều chỉnh chỉ có hiệu lực khi đủ người đã chọn duyệt.",
].join("\n");

/* ------------------------- Ô Ghi chú / Đính kèm tệp ------------------------ */

export interface AdjustmentFieldRules {
  note: DecisionNoteRule;
  attachment: DecisionNoteRule;
}

export type AdjustmentFieldRulesSetting = NonNullable<ProposalGroup["adjustmentFieldRules"]>;

/**
 * Quy tắc hiệu lực theo nhóm. Thiếu cài đặt (nhóm cũ, đề xuất trực tiếp) =
 * Ghi chú CÓ (không bắt buộc) + Đính kèm CÓ (không bắt buộc) — đúng hộp điều
 * chỉnh cũ (ô chữ + kẹp tệp, cần ít nhất 1 trong 2).
 *
 * Không thể tắt CẢ 2 ô (điều chỉnh sẽ rỗng) — nếu dữ liệu lỡ tắt cả 2 thì
 * coi như Ghi chú vẫn CÓ. Ô tắt thì không thể bắt buộc.
 */
export function resolveAdjustmentFieldRules(
  group: Pick<ProposalGroup, "adjustmentFieldRules"> | null | undefined,
): AdjustmentFieldRules {
  const raw = group?.adjustmentFieldRules ?? {};
  let noteEnabled = raw.noteEnabled !== false;
  const attachmentEnabled = raw.attachmentEnabled !== false;
  if (!noteEnabled && !attachmentEnabled) noteEnabled = true;
  return {
    note: { enabled: noteEnabled, required: noteEnabled && raw.noteRequired === true },
    attachment: { enabled: attachmentEnabled, required: attachmentEnabled && raw.attachmentRequired === true },
  };
}

/** Chuẩn hoá object client gửi lên trang cài đặt nhóm — `null` nếu sai kiểu. */
export function sanitizeAdjustmentFieldRules(value: unknown): AdjustmentFieldRulesSetting | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const src = value as Record<string, unknown>;
  const rules = resolveAdjustmentFieldRules({
    adjustmentFieldRules: {
      noteEnabled: src.noteEnabled !== false,
      noteRequired: src.noteRequired === true,
      attachmentEnabled: src.attachmentEnabled !== false,
      attachmentRequired: src.attachmentRequired === true,
    },
  });
  return {
    noteEnabled: rules.note.enabled,
    noteRequired: rules.note.required,
    attachmentEnabled: rules.attachment.enabled,
    attachmentRequired: rules.attachment.required,
  };
}

export function adjustmentFieldMode(rule: DecisionNoteRule): DecisionNoteMode {
  if (!rule.enabled) return "hidden";
  return rule.required ? "required" : "optional";
}

export function describeAdjustmentFieldRules(rules: AdjustmentFieldRules): string {
  const one = (r: DecisionNoteRule) => (!r.enabled ? "Không" : r.required ? "Có · bắt buộc" : "Có · không bắt buộc");
  return `Ghi chú: ${one(rules.note)}, Đính kèm tệp: ${one(rules.attachment)}`;
}

/**
 * Kiểm nội dung + số tệp theo quy tắc (đã sanitize tệp ở nơi gọi). Ô tắt →
 * nội dung/tệp của ô đó bị BỎ (không lưu thứ Admin đã tắt). Trả lỗi tiếng
 * Việt để route trả 400 / hộp điều chỉnh hiện ngay.
 */
export function checkAdjustmentContent(
  rules: AdjustmentFieldRules,
  input: { noiDung: string; fileCount: number },
): { ok: true; noiDung: string; keepFiles: boolean } | { ok: false; error: string } {
  const noiDung = rules.note.enabled ? input.noiDung.trim() : "";
  const fileCount = rules.attachment.enabled ? input.fileCount : 0;
  if (rules.note.required && !noiDung) return { ok: false, error: "Nhập nội dung điều chỉnh." };
  if (rules.attachment.required && fileCount === 0) {
    return { ok: false, error: "Nhóm này yêu cầu đính kèm tệp cho điều chỉnh." };
  }
  if (!noiDung && fileCount === 0) {
    return {
      ok: false,
      error: rules.note.enabled && rules.attachment.enabled
        ? "Nhập nội dung điều chỉnh hoặc đính kèm tệp."
        : rules.note.enabled
          ? "Nhập nội dung điều chỉnh."
          : "Đính kèm ít nhất 1 tệp cho điều chỉnh.",
    };
  }
  return { ok: true, noiDung, keepFiles: rules.attachment.enabled };
}

/* ------------------------------ Chọn 2 người ------------------------------ */

/**
 * Kiểm danh sách uid người duyệt client gửi lên — ĐÚNG 2 người, khác nhau,
 * không phải chính người điều chỉnh. (Người đó còn hoạt động ở App Tổng hay
 * không do máy chủ tra riêng — xem lib/server/adjustment-reviewers.ts.)
 */
export function validateAdjustmentApproverPick(
  raw: unknown,
  requesterUid: string,
): { ok: true; uids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: `Chọn đúng ${ADJUSTMENT_APPROVER_COUNT} người duyệt điều chỉnh.` };
  }
  const uids = raw.map((v) => (typeof v === "string" ? v.trim() : ""));
  if (uids.some((u) => !u)) return { ok: false, error: "Người duyệt điều chỉnh không hợp lệ." };
  if (uids.length !== ADJUSTMENT_APPROVER_COUNT) {
    return {
      ok: false,
      error: `Chọn đúng ${ADJUSTMENT_APPROVER_COUNT} người duyệt điều chỉnh (đang chọn ${uids.length}).`,
    };
  }
  if (new Set(uids).size !== uids.length) {
    return { ok: false, error: "2 người duyệt điều chỉnh phải là 2 người khác nhau." };
  }
  if (uids.includes(requesterUid)) {
    return { ok: false, error: "Không tự chọn chính mình làm người duyệt điều chỉnh." };
  }
  return { ok: true, uids };
}

/**
 * "Người duyệt cuối" của đề nghị — người THỰC TẾ bấm duyệt cuối cùng: dòng
 * lịch sử "Đã chấp thuận" (hoặc "Đã chấp thuận và chuyển tiếp") gần nhất,
 * ghép tên với `approversSnapshot` (lịch sử chỉ ghi tên, không ghi uid —
 * cùng giới hạn với lib/approver-progress.ts; trùng tên thì ưu tiên người có
 * quyết định "approved", rồi người đứng sau). Không ghép được → người CUỐI
 * danh sách `approversSnapshot`. Không có ai → null.
 */
export function findLastApprover(
  request: Pick<RequestInstance, "history" | "approversSnapshot" | "approvers">,
): TaggedUser | null {
  const snapshot = request.approversSnapshot ?? [];
  if (snapshot.length === 0) return null;
  const decisionOf = new Map((request.approvers ?? []).map((a) => [a.id, a.decision]));
  const history = request.history ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.action !== HISTORY_ACTION.approved && h.action !== HISTORY_ACTION.approveAndForward) continue;
    const matches = snapshot.filter((s) => sameName(s.name, h.actor));
    if (matches.length === 0) continue;
    const approved = matches.filter((m) => decisionOf.get(m.id) === "approved");
    const pool = approved.length > 0 ? approved : matches;
    return pool[pool.length - 1];
  }
  return snapshot[snapshot.length - 1];
}

/** Bỏ dấu + chữ thường để so tên phòng ban ("Thu mua cung ứng" ↔ "thu mua"). */
export function normalizeVi(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Phòng Thu mua ở App Tổng — phòng đầu tiên có tên chứa "thu mua" (không phân
 * biệt hoa thường/dấu) VÀ đã có trưởng phòng. Không có → null (ẩn gợi ý).
 */
export function findPurchasingDepartment<T extends { name: string; leaderId: string | null }>(
  departments: readonly T[],
): T | null {
  return departments.find((d) => d.leaderId && normalizeVi(d.name).includes("thu mua")) ?? null;
}

/* --------------------------- Dữ liệu pendingAdjustment --------------------- */

type PendingAdjustment = NonNullable<RequestInstance["pendingAdjustment"]>;

/** Tệp của 1 điều chỉnh đang chờ — đọc được cả dạng CŨ (`attachment` 1 tệp,
 * trước 06/10/2026) lẫn dạng mới (`attachments` nhiều tệp). */
export function pendingAdjustmentFiles(
  pending: Pick<PendingAdjustment, "attachment" | "attachments"> | null | undefined,
): RequestAttachment[] {
  if (!pending) return [];
  if (Array.isArray(pending.attachments) && pending.attachments.length > 0) return pending.attachments;
  return pending.attachment ? [pending.attachment] : [];
}

/** `uid` đang có phần duyệt CHƯA xử lý trong điều chỉnh đang chờ. */
export function isAwaitingMyAdjustmentDecision(
  request: Pick<RequestInstance, "status" | "pendingAdjustment">,
  uid: string | null,
): boolean {
  if (!uid || request.status !== "approved") return false;
  return !!request.pendingAdjustment?.approvers.some((a) => a.uid === uid && a.approvedAt === null);
}

/**
 * `uid` là (hoặc từng là) người duyệt điều chỉnh của đề xuất — được XEM đề
 * xuất. Gồm người đang nằm trong `pendingAdjustment.approvers` (kể cả được
 * chuyển tiếp tới, kể cả điều chỉnh tạo theo cách cũ) và người từng được giao
 * (`adjustmentReviewerUids`, lưu lại để còn mở lại được sau khi điều chỉnh
 * xong/bị từ chối).
 */
export function isAdjustmentReviewer(
  request: Pick<RequestInstance, "pendingAdjustment" | "adjustmentReviewerUids">,
  uid: string,
): boolean {
  if (request.pendingAdjustment?.approvers.some((a) => a.uid === uid)) return true;
  return (request.adjustmentReviewerUids ?? []).includes(uid);
}
