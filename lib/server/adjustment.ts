import "server-only";
import { ADJUSTMENT_ATTACHMENT_MAX_FILES } from "@/lib/adjustment-settings";
import { ADJUSTMENT_HISTORY_PREFIX } from "@/lib/request-history-labels";
import { isFreshOwnUploadPath } from "@/lib/server/decision-attachments";
import type { RequestAttachment, RequestInstance } from "@/lib/types";

/**
 * Tính `{history, attachments, updatedAt}` mới khi 1 điều chỉnh sau duyệt CÓ
 * HIỆU LỰC (đủ người duyệt) — hàm THUẦN, không đụng Firestore, để route
 * `adjustment/decision/route.ts` gọi ngay BÊN TRONG transaction của nó.
 *
 * Từ 06/10/2026 mọi điều chỉnh đều phải qua duyệt (không còn nhánh "lưu thẳng
 * ngay"), nên đây là nơi DUY NHẤT ghi dòng "Điều chỉnh sau duyệt (lần N)".
 *
 * Tệp: nhận nhiều tệp (`files`); mỗi tệp vào `attachments` của đề xuất với
 * `source: "adjustment"` + người/giờ. Dòng lịch sử ghi `attachmentNames` (đủ
 * các tệp) và `attachmentName` (tệp ĐẦU — giữ cho nơi đọc cũ chỉ biết 1 tệp).
 * Điều chỉnh CŨ đang chờ (1 tệp, không có `source`) vẫn đi qua đây bình
 * thường — nơi gọi đọc tệp qua `pendingAdjustmentFiles()`.
 */
export function buildAdjustmentHistoryPatch(
  moiNhat: Pick<RequestInstance, "history" | "attachments">,
  input: {
    noiDung: string;
    files: RequestAttachment[];
    actorName: string;
    actorUid?: string;
  },
): Pick<RequestInstance, "history" | "attachments" | "updatedAt"> {
  const nowIso = new Date().toISOString();
  const lichSuCu = moiNhat.history ?? [];
  const soLan = lichSuCu.filter((h) => h.action.startsWith(ADJUSTMENT_HISTORY_PREFIX)).length + 1;
  const names = input.files.map((f) => f.name);
  const entry = {
    at: nowIso,
    actor: input.actorName,
    action: `${ADJUSTMENT_HISTORY_PREFIX} (lần ${soLan})`,
    note: input.noiDung || "(chỉ đính tệp)",
    ...(names.length > 0 ? { attachmentName: names[0], attachmentNames: names } : {}),
  };
  const existingPaths = new Set((moiNhat.attachments ?? []).map((a) => a.path));
  const added: RequestAttachment[] = input.files
    .filter((f) => !existingPaths.has(f.path))
    .map((f) => ({
      name: f.name,
      path: f.path,
      size: f.size,
      source: "adjustment" as const,
      addedBy: input.actorName,
      addedAt: nowIso,
      ...(input.actorUid ? { addedByUid: input.actorUid } : {}),
    }));
  return {
    history: [...lichSuCu, entry],
    attachments: [...(moiNhat.attachments ?? []), ...added],
    updatedAt: nowIso,
  };
}

/**
 * Kiểm danh sách tệp người điều chỉnh gửi kèm — phần THUẦN (đo kích thước
 * thật trên R2 do route làm sau, bằng `verifyUploadedAttachment`). Cùng luật
 * với "Đính kèm tệp khi duyệt" (lib/server/decision-attachments.ts): chỉ tệp
 * CHÍNH người gọi vừa tải lên (≤ 24 giờ), không trùng tệp đã có trong đề
 * xuất, tối đa `ADJUSTMENT_ATTACHMENT_MAX_FILES`.
 *
 * Nhận cả `attachment` (1 tệp — client bản cũ còn cache) lẫn `attachments`.
 */
export function sanitizeAdjustmentFilesInput(params: {
  attachments: unknown;
  legacyAttachment: unknown;
  uid: string;
  existingPaths: Iterable<string>;
  nowMs: number;
}): { ok: true; files: RequestAttachment[] } | { ok: false; error: string } {
  let list: unknown[] = [];
  if (params.attachments !== undefined && params.attachments !== null) {
    if (!Array.isArray(params.attachments)) return { ok: false, error: "Danh sách tệp đính kèm không hợp lệ." };
    list = [...params.attachments];
  }
  if (params.legacyAttachment !== undefined && params.legacyAttachment !== null) list.push(params.legacyAttachment);
  if (list.length > ADJUSTMENT_ATTACHMENT_MAX_FILES) {
    return { ok: false, error: `Chỉ được đính kèm tối đa ${ADJUSTMENT_ATTACHMENT_MAX_FILES} tệp mỗi lần.` };
  }
  const existing = new Set(params.existingPaths);
  const seen = new Set<string>();
  const out: RequestAttachment[] = [];
  for (const item of list) {
    const att = item as Partial<RequestAttachment> | null;
    if (!att || typeof att !== "object" || typeof att.path !== "string" || !att.path || typeof att.name !== "string" || !att.name.trim()) {
      return { ok: false, error: "Tệp đính kèm không hợp lệ." };
    }
    if (!isFreshOwnUploadPath(att.path, params.uid, params.nowMs)) {
      return { ok: false, error: "Tệp không hợp lệ — chỉ chấp nhận tệp bạn vừa tải lên." };
    }
    if (existing.has(att.path) || seen.has(att.path)) {
      return { ok: false, error: `Tệp "${att.name}" đã có trong đề xuất.` };
    }
    seen.add(att.path);
    out.push({ name: att.name.trim().slice(0, 255), path: att.path, size: typeof att.size === "number" && att.size >= 0 ? att.size : 0 });
  }
  return { ok: true, files: out };
}
