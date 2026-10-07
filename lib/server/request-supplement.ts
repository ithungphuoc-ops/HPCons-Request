/**
 * Phần THUẦN (không đọc/ghi Firestore, không gọi R2) của 2 route bổ sung vào
 * đề xuất — `attachments` (POST thêm tài liệu) và `table-supplement` (nối
 * dòng bảng sau duyệt).
 *
 * Vì sao tách (06/10/2026, Sếp duyệt — làm tiếp sau PR #82): 2 route cũ đọc
 * đề xuất NGOÀI transaction rồi ghi đè cả mảng `history` (table-supplement
 * còn ghi đè cả `values` + `fieldsSnapshot`) từ bản đọc đó → thao tác chạy
 * song song (quyết định duyệt, bổ sung khác, hàng chờ đồng bộ ghi "Đã đồng
 * bộ…") có thể bị xoá mất. Nay route gọi các hàm này BÊN TRONG
 * `adminDb.runTransaction` trên ảnh chụp `tx.get` mới nhất — hàm phải không có
 * tác dụng phụ và tự kiểm lại mọi điều kiện (xoá mềm, trạng thái, quyền).
 */
import { canManageGroupsAtAppScope, canSupplementAfterApproval, type Role } from "@/lib/permissions";
import { ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX, TABLE_SUPPLEMENT_HISTORY_PREFIX } from "@/lib/request-history-labels";
import { canView } from "@/lib/server/requests";
import { deletedGuard, type GuardFailure } from "@/lib/server/request-write-guard";
import {
  deserializeTableRows,
  invalidCellReason,
  isChoiceColumnType,
  isDateColumnType,
  normalizeColumnName,
  resolveTableColumnOptions,
  resolveTableColumnTypes,
  toWireTableRows,
} from "@/lib/table-field";
import type { RequestAttachment, RequestHistoryEntry, RequestInstance } from "@/lib/types";

/**
 * Quyền thêm tài liệu cấp đề xuất (giữ y hệt luật cũ của route attachments):
 * xem được đề xuất; đã duyệt → chỉ CHÍNH người làm đề xuất; trạng thái khác →
 * chủ đề xuất hoặc Owner/Admin. Thêm: đề xuất đã xoá mềm → 409.
 */
export function checkAddAttachmentAccess(req: RequestInstance, uid: string, role: Role): GuardFailure | null {
  const deleted = deletedGuard(req);
  if (deleted) return deleted;
  if (!canView(req, uid, role)) {
    return { status: 403, error: "Bạn không có quyền trên đề xuất này." };
  }
  if (req.status === "approved") {
    if (!canSupplementAfterApproval(req, uid)) {
      return { status: 403, error: "Đề xuất đã duyệt — chỉ chính người làm đề xuất mới thêm được tài liệu." };
    }
  } else if (req.submittedBy.uid !== uid && !canManageGroupsAtAppScope(role)) {
    return { status: 403, error: "Chỉ chủ đề xuất hoặc Owner/Admin mới thêm được tài liệu." };
  }
  return null;
}

export interface AddAttachmentPlan {
  /** Dòng lịch sử cần NỐI (arrayUnion) — chỉ có khi đề xuất đã duyệt. */
  historyEntry?: RequestHistoryEntry;
  /** Danh sách tệp sau khi thêm — trả về client. */
  attachments: RequestAttachment[];
  /** Lịch sử sau khi thêm (chỉ khi có dòng mới) — trả về client. */
  history?: RequestHistoryEntry[];
}

/**
 * Tính dòng lịch sử "Bổ sung tài liệu sau duyệt (lần N)" theo ảnh chụp MỚI
 * NHẤT (đếm N trên bản mới nhất, nên 2 lần bổ sung song song vẫn ra lần 1, 2).
 * Đính tệp lúc còn draft/pending/returned là hành vi cũ — không ghi lịch sử.
 */
export function planAddAttachment(
  latest: Pick<RequestInstance, "status" | "history" | "attachments">,
  attachment: RequestAttachment,
  actorName: string,
  nowIso: string,
): AddAttachmentPlan {
  const attachments = [...(latest.attachments ?? []), attachment];
  if (latest.status !== "approved") return { attachments };
  const history = latest.history ?? [];
  const priorCount = history.filter((h) => h.action.startsWith(ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX)).length;
  const historyEntry: RequestHistoryEntry = {
    at: nowIso,
    actor: actorName,
    action: `${ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX} (lần ${priorCount + 1}): ${attachment.name}`,
  };
  return { historyEntry, attachments, history: [...history, historyEntry] };
}

export interface TableSupplementInput {
  fieldId: unknown;
  newRows: unknown;
  newColumns: unknown;
}

export type TableSupplementPlan =
  | (GuardFailure & { ok: false })
  | {
      ok: true;
      /** Ghi bằng tx.update — `values` + `fieldsSnapshot` tính trên bản MỚI NHẤT. */
      patch: Pick<RequestInstance, "values" | "fieldsSnapshot">;
      /** NỐI vào `history` bằng arrayUnion. */
      historyEntry: RequestHistoryEntry;
      /** Đề xuất sau khi ghi — trả về client. */
      updated: RequestInstance;
    };

/**
 * Nối thêm dòng vào field kiểu "table"/"base_table" của đề xuất ĐÃ DUYỆT —
 * logic giữ y hệt route cũ (chỉ nối dòng, cột mới dedupe theo tên chuẩn hoá,
 * dòng cũ chỉ bù ô trống, cột mới chỉ ghi vào snapshot của đề xuất). Thêm:
 * đề xuất đã xoá mềm → 409.
 */
export function planTableSupplement(
  latest: RequestInstance,
  body: TableSupplementInput,
  actor: { uid: string; name: string },
  nowIso: string,
): TableSupplementPlan {
  const deleted = deletedGuard(latest);
  if (deleted) return { ok: false, ...deleted };
  if (latest.status !== "approved") {
    return { ok: false, status: 400, error: "Chỉ bổ sung được dữ liệu bảng cho đề xuất đã duyệt." };
  }
  // Chỉ CHÍNH người làm đề xuất — Owner/Admin không được thao tác thay
  // (quyết định của Sếp, dùng chung hàm với route attachments + UI).
  if (!canSupplementAfterApproval(latest, actor.uid)) {
    return { ok: false, status: 403, error: "Chỉ chính người làm đề xuất mới bổ sung được dữ liệu bảng." };
  }

  const fieldId = body.fieldId;
  if (typeof fieldId !== "string" || !fieldId) {
    return { ok: false, status: 400, error: "Thiếu fieldId." };
  }
  const fieldIndex = latest.fieldsSnapshot.findIndex((f) => f.id === fieldId);
  const field = fieldIndex >= 0 ? latest.fieldsSnapshot[fieldIndex] : undefined;
  if (!field || (field.dataType !== "table" && field.dataType !== "base_table")) {
    return { ok: false, status: 400, error: "Field không hợp lệ hoặc không phải kiểu bảng." };
  }

  const rawNewRows = Array.isArray(body.newRows) ? body.newRows : [];
  const newRows: string[][] = rawNewRows
    .filter((r): r is unknown[] => Array.isArray(r))
    .map((r) => r.map((cell) => String(cell ?? "")));
  if (newRows.length === 0) {
    return { ok: false, status: 400, error: "Thiếu dữ liệu dòng cần bổ sung." };
  }

  // Cột mới — dedupe theo tên chuẩn hoá, đúng logic parseTableImportFile().
  const existingColumns = field.tableColumns ?? [];

  // Cột Ngày/Danh sách (07/10/2026): dòng nối thêm cũng phải đúng định dạng/
  // đúng phương án như lúc gửi (findInvalidTableRows). Cố ý CHỈ kiểm 2 nhóm
  // kiểu mới — cột số/chữ giữ nguyên hành vi cũ của route này.
  const existingTypes = resolveTableColumnTypes(existingColumns, field.tableColumnTypes);
  const existingOptions = resolveTableColumnOptions(existingColumns, existingTypes, field.tableColumnOptions);
  for (let r = 0; r < newRows.length; r++) {
    for (let c = 0; c < existingColumns.length; c++) {
      const type = existingTypes[c];
      if (!isDateColumnType(type) && !isChoiceColumnType(type)) continue;
      const raw = (newRows[r][c] ?? "").trim();
      if (!raw) continue;
      const reason = invalidCellReason(raw, type, existingOptions[c]);
      if (reason) {
        return {
          ok: false,
          status: 400,
          error: `Dòng ${r + 1}: "${existingColumns[c]}" ${reason} (đang nhập "${raw}").`,
        };
      }
    }
  }
  const existingByNormalized = new Set(existingColumns.map((c) => normalizeColumnName(c)));
  const rawNewColumns = Array.isArray(body.newColumns)
    ? body.newColumns.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : [];
  const seenNormalized = new Set<string>();
  const dedupedNewColumns = rawNewColumns.filter((c) => {
    const n = normalizeColumnName(c);
    if (existingByNormalized.has(n) || seenNormalized.has(n)) return false;
    seenNormalized.add(n);
    return true;
  });
  const finalColumns = [...existingColumns, ...dedupedNewColumns];

  // Dòng CŨ giữ nguyên nội dung — chỉ bù ô trống cho cột mới. Dòng MỚI nối cuối.
  const oldRows = deserializeTableRows(latest.values[fieldId]);
  const paddedOldRows = oldRows.map((r) => finalColumns.map((_, i) => r[i] ?? ""));
  const paddedNewRows = newRows.map((r) => finalColumns.map((_, i) => r[i] ?? ""));

  const values: Record<string, unknown> = {
    ...latest.values,
    [fieldId]: toWireTableRows([...paddedOldRows, ...paddedNewRows]),
  };
  const fieldsSnapshot = latest.fieldsSnapshot.map((f, i) =>
    i === fieldIndex ? { ...f, tableColumns: finalColumns } : f,
  );

  const history = latest.history ?? [];
  const priorCount = history.filter((h) => h.action.startsWith(TABLE_SUPPLEMENT_HISTORY_PREFIX)).length;
  const historyEntry: RequestHistoryEntry = {
    at: nowIso,
    actor: actor.name,
    action: `${TABLE_SUPPLEMENT_HISTORY_PREFIX} (lần ${priorCount + 1}): thêm ${newRows.length} dòng vào "${field.name}"`,
  };

  const patch = { values, fieldsSnapshot };
  return {
    ok: true,
    patch,
    historyEntry,
    updated: { ...latest, ...patch, history: [...history, historyEntry] },
  };
}
