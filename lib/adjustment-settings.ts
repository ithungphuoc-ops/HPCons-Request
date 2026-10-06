/**
 * "Điều chỉnh đề nghị sau duyệt" — cách mới Sếp duyệt demo
 * tong-quan-demo/base-request-app/dieu-chinh-tu-chon-nguoi-duyet-2026-10-06
 * (06/10/2026), thay bảng "nhánh theo phòng ban" của PR #68:
 *
 * - Hộp Điều chỉnh hiện cảnh báo vàng = "Hướng dẫn điều chỉnh sau duyệt" —
 *   từ 06/10/2026 (Sếp chốt) MỖI NHÓM 1 nội dung riêng (`adjustmentGuide`),
 *   soạn ngay trong tab "Điều chỉnh sau duyệt" của nhóm (bỏ trang "Cài đặt
 *   chung"); xem `resolveAdjustmentGuide`.
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
import type { AdjustmentApprovalRules, ProposalGroup, RequestAttachment, RequestInstance, TaggedUser } from "./types";

/** Số người duyệt điều chỉnh người điều chỉnh PHẢI chọn (Sếp chốt: đúng 2). */
export const ADJUSTMENT_APPROVER_COUNT = 2;

/** Tối đa số tệp mỗi lần điều chỉnh — bằng trần 1 lần xin link ký sẵn, cùng
 * con số với "Đính kèm tệp khi duyệt". */
export const ADJUSTMENT_ATTACHMENT_MAX_FILES = 6;

/** Độ dài tối đa nội dung hướng dẫn điều chỉnh của 1 nhóm. */
export const ADJUSTMENT_GUIDE_MAX_LENGTH = 2000;

/** Nội dung mặc định khi Owner/Admin chưa từng soạn (giống demo). */
export const DEFAULT_ADJUSTMENT_GUIDE = [
  "• NV Thu mua điều chỉnh: chọn NGƯỜI DUYỆT CUỐI của đề nghị này duyệt lại.",
  "• Người khác điều chỉnh: chọn TRƯỞNG PHÒNG THU MUA + NGƯỜI DUYỆT CUỐI.",
  "• Điều chỉnh chỉ có hiệu lực khi đủ người đã chọn duyệt.",
].join("\n");

/**
 * Nội dung hướng dẫn hiện trong hộp Điều chỉnh của 1 đề xuất — thứ tự ưu tiên:
 * 1. `groupGuide` là chuỗi (nhóm đã soạn riêng) → dùng đúng chuỗi đó. Chuỗi
 *    RỖNG "" = Admin cố ý xoá trắng → KHÔNG hiện cảnh báo.
 * 2. Nhóm chưa soạn (`undefined`) / đã bấm "Dùng nội dung mặc định" (`null`)
 *    → nội dung mặc định: `appDefault` = hướng dẫn CHUNG cũ ở
 *    `appSettings/adjustment.guide` nếu từng được lưu (PR #85 — giữ để không
 *    mất nội dung Admin đã soạn), kể cả khi đó là chuỗi rỗng.
 * 3. Không có gì → `DEFAULT_ADJUSTMENT_GUIDE` trong code.
 */
export function resolveAdjustmentGuide(
  groupGuide: string | null | undefined,
  appDefault: string | null | undefined,
): string {
  if (typeof groupGuide === "string") return groupGuide;
  return resolveDefaultAdjustmentGuide(appDefault);
}

/** Nội dung "mặc định" khi nhóm chưa soạn riêng (bước 2–3 ở trên). */
export function resolveDefaultAdjustmentGuide(appDefault: string | null | undefined): string {
  return typeof appDefault === "string" ? appDefault : DEFAULT_ADJUSTMENT_GUIDE;
}

/**
 * Chuẩn hoá `adjustmentGuide` client gửi lên route PATCH nhóm: `null` = dùng
 * nội dung mặc định; chuỗi → đổi xuống dòng kiểu Windows về "\n", bỏ khoảng
 * trắng 2 đầu, tối đa `ADJUSTMENT_GUIDE_MAX_LENGTH` ký tự (đếm SAU khi trim).
 * Sai kiểu → lỗi tiếng Việt (route trả 400).
 */
export function sanitizeAdjustmentGuide(
  value: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "Nội dung hướng dẫn điều chỉnh không hợp lệ." };
  const guide = value.replace(/\r\n?/g, "\n").trim();
  if (guide.length > ADJUSTMENT_GUIDE_MAX_LENGTH) {
    return { ok: false, error: `Hướng dẫn điều chỉnh tối đa ${ADJUSTMENT_GUIDE_MAX_LENGTH} ký tự.` };
  }
  return { ok: true, value: guide };
}

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

/* ------------------------------ Ai được bấm ------------------------------ */

/**
 * Ai được bấm "Điều chỉnh đề nghị sau duyệt".
 *
 * 06/10/2026 (Sếp duyệt demo dieu-chinh-tu-chon-nguoi-duyet): BỎ bảng "nhánh
 * theo phòng ban" của PR #68 — mọi điều chỉnh đều phải qua ĐÚNG 2 người duyệt
 * do người điều chỉnh tự chọn. Phần còn giữ là quyền BẤM, giữ như trước:
 * - Người gửi đề xuất: luôn được (đề xuất đã duyệt).
 * - Người theo dõi: chỉ khi nhóm đã bật `adjustmentApprovalRules` VÀ
 *   `allowFollowers === true` (ô "Cho phép người theo dõi cũng bấm Điều
 *   chỉnh" — vẫn cài THEO NHÓM như cũ, dữ liệu sẵn có giữ nguyên nghĩa).
 *
 * Khác duy nhất so với PR #68: trước đây người theo dõi còn phải "khớp 1
 * nhánh phòng ban hoặc có nhánh mặc định" mới bấm được; nay bỏ nhánh nên chỉ
 * còn xét `allowFollowers`. `branches`/`catchAllApprovers` cũ KHÔNG bị xoá
 * khỏi Firestore, chỉ không đọc nữa.
 *
 * Hàm THUẦN — dùng chung route ghi điều chỉnh, GET đề xuất và trang danh
 * sách (tự tính từ cài đặt nhóm đã tải sẵn, không tốn thêm lượt gọi).
 */
export function canAdjustAfterApproval(
  found: Pick<RequestInstance, "submittedBy" | "followers" | "status" | "deletedAt">,
  uid: string,
  rules: Pick<AdjustmentApprovalRules, "allowFollowers"> | null | undefined,
): boolean {
  if (found.status !== "approved" || found.deletedAt) return false;
  if (found.submittedBy.uid === uid) return true;
  const isFollower = found.followers.some((f) => f.id === uid);
  return isFollower && rules?.allowFollowers === true;
}

/* --------------------------- Huỷ điều chỉnh chờ duyệt --------------------- */

/** Lý do huỷ tối đa (kiểm ở CẢ ô nhập lẫn máy chủ). */
export const ADJUSTMENT_CANCEL_REASON_MAX_LENGTH = 500;

/**
 * Ai được bấm "Huỷ điều chỉnh" cho 1 điều chỉnh ĐANG CHỜ duyệt — Sếp đồng ý
 * 06/10/2026 (tránh treo khi người duyệt nghỉ/không xử lý):
 * - Người đã gửi điều chỉnh (`pendingAdjustment.requestedByUid`).
 * - Owner/Admin (vai trò toàn cục App Tổng — cùng chuẩn `canManageGroupsAtAppScope`).
 * Người duyệt điều chỉnh KHÔNG có quyền huỷ (họ đã có nút Từ chối).
 *
 * Hàm THUẦN — dùng chung route `adjustment/cancel` và nút ở trang chi tiết.
 */
export function canCancelPendingAdjustment(
  pending: Pick<PendingAdjustment, "requestedByUid"> | null | undefined,
  uid: string | null,
  isAdmin: boolean,
): boolean {
  if (!pending || !uid) return false;
  return isAdmin || pending.requestedByUid === uid;
}

/** Ghi chú cho dòng lịch sử "Đã huỷ điều chỉnh chờ duyệt": lý do (nếu có) +
 * tóm tắt nội dung điều chỉnh bị huỷ (ghi chú, tên tệp, người đề nghị). */
export function buildAdjustmentCancelNote(
  pending: Pick<PendingAdjustment, "noiDung" | "attachment" | "attachments" | "requestedByName">,
  reason: string,
): string {
  const parts: string[] = [];
  if (reason) parts.push(`Lý do: ${reason}`);
  parts.push(`Điều chỉnh bị huỷ (do ${pending.requestedByName} đề nghị): ${pending.noiDung || "(chỉ đính tệp)"}`);
  const names = pendingAdjustmentFiles(pending).map((f) => f.name);
  if (names.length > 0) parts.push(`Tệp kèm (không lưu vào đề xuất): ${names.join(", ")}`);
  // Dòng lịch sử hiện trên 1 dòng (không pre-line) → nối bằng " · ".
  return parts.join(" · ");
}
