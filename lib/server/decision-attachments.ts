/**
 * Kiểm danh sách tệp người duyệt gửi kèm quyết định ("Đính kèm tệp khi
 * duyệt", Sếp duyệt demo 06/10/2026) — phần THUẦN (không gọi R2/Firestore)
 * để test được; route decision gọi hàm này TRƯỚC, rồi mới đo kích thước thật
 * trên R2 bằng `verifyUploadedAttachment()` (lib/server/verify-upload.ts),
 * cùng cách route attachments / adjustment đang làm.
 *
 * Luật path: chỉ nhận đúng dạng `buildUploadPath()` sinh ra cho CHÍNH người
 * gọi (`requests/{uid}/{mốc ms}-{tên an toàn}`), và mốc tải lên còn MỚI
 * (≤ 24 giờ) — tệp được tải ngay lúc bấm xác nhận, nên tệp cũ hơn chỉ có thể
 * là tệp đã đính vào chỗ khác (vd đề xuất khác) đem dùng lại → chặn. Tệp đã
 * có sẵn trong đề xuất này cũng bị chặn (không ghi trùng).
 */
import {
  DECISION_ATTACHMENT_MAX_FILES,
  decisionAttachmentRuleFor,
  type DecisionAttachmentGroupSettings,
  type DecisionKind,
} from "@/lib/decision-attachment";
import { isOwnUploadPath } from "@/lib/server/uploads";

/** Tệp phải được tải lên trong khoảng này trước lúc quyết định. */
export const DECISION_ATTACHMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface DecisionAttachmentInput {
  name: string;
  path: string;
  size: number;
}

/** Path đúng dạng do `buildUploadPath(uid, …)` sinh ra và còn mới. */
export function isFreshOwnUploadPath(path: string, uid: string, nowMs: number): boolean {
  if (!isOwnUploadPath(path, uid)) return false;
  const rest = path.slice(`requests/${uid}/`.length);
  const match = /^(\d{10,16})-[A-Za-z0-9._-]+$/.exec(rest);
  if (!match || rest.includes("..")) return false;
  const uploadedAt = Number(match[1]);
  // Cho lệch đồng hồ nhỏ (5 phút) về phía tương lai.
  return uploadedAt <= nowMs + 5 * 60 * 1000 && nowMs - uploadedAt <= DECISION_ATTACHMENT_MAX_AGE_MS;
}

export type SanitizeDecisionAttachmentsResult =
  | { ok: true; attachments: DecisionAttachmentInput[] }
  | { ok: false; error: string };

/**
 * - `raw` undefined/null/[] → không có tệp.
 * - Không phải mảng / phần tử sai kiểu / quá số tệp / path không hợp lệ → lỗi
 *   (route trả 400).
 * - Ô của hành động này đang TẮT trong nhóm → bỏ hết tệp (không lưu).
 * - Bắt buộc mà không có tệp → lỗi.
 */
export function sanitizeDecisionAttachmentsInput(params: {
  decision: DecisionKind;
  raw: unknown;
  group: Partial<DecisionAttachmentGroupSettings> | null | undefined;
  uid: string;
  existingPaths: Iterable<string>;
  nowMs: number;
}): SanitizeDecisionAttachmentsResult {
  const { decision, raw, group, uid, nowMs } = params;
  const rule = decisionAttachmentRuleFor(decision, group);

  let list: unknown[] = [];
  if (raw !== undefined && raw !== null) {
    if (!Array.isArray(raw)) return { ok: false, error: "Danh sách tệp đính kèm không hợp lệ." };
    list = raw;
  }

  if (!rule.enabled) return { ok: true, attachments: [] };

  if (list.length > DECISION_ATTACHMENT_MAX_FILES) {
    return { ok: false, error: `Chỉ được đính kèm tối đa ${DECISION_ATTACHMENT_MAX_FILES} tệp mỗi lần.` };
  }

  const existing = new Set(params.existingPaths);
  const seen = new Set<string>();
  const out: DecisionAttachmentInput[] = [];
  for (const item of list) {
    const att = item as Partial<DecisionAttachmentInput> | null;
    if (
      !att ||
      typeof att !== "object" ||
      typeof att.path !== "string" ||
      !att.path ||
      typeof att.name !== "string" ||
      !att.name.trim()
    ) {
      return { ok: false, error: "Tệp đính kèm không hợp lệ." };
    }
    if (!isFreshOwnUploadPath(att.path, uid, nowMs)) {
      return { ok: false, error: "Tệp không hợp lệ — chỉ chấp nhận tệp bạn vừa tải lên." };
    }
    if (existing.has(att.path) || seen.has(att.path)) {
      return { ok: false, error: `Tệp "${att.name}" đã có trong đề xuất.` };
    }
    seen.add(att.path);
    out.push({
      name: att.name.trim().slice(0, 255),
      path: att.path,
      size: typeof att.size === "number" && att.size >= 0 ? att.size : 0,
    });
  }

  if (rule.required && out.length === 0) {
    return { ok: false, error: "Nhóm này yêu cầu đính kèm tệp cho hành động này." };
  }
  return { ok: true, attachments: out };
}
