import type { TableColumnType } from "@/lib/types";

/**
 * Firestore không cho phép một mảng chứa trực tiếp mảng khác bên trong
 * ("Property values contains an invalid nested entity") — trường kiểu Bảng
 * dùng string[][] để hiển thị/sửa, nhưng phải bọc mỗi dòng vào 1 object
 * trước khi ghi xuống Firestore, và mở lại khi đọc ra.
 */
export type WireTableRow = { cells: string[] };

export function serializeTableRows(rows: string[][]): WireTableRow[] {
  return rows.map((cells) => ({ cells }));
}

export function deserializeTableRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => {
    if (Array.isArray(row)) return row as string[];
    if (row && typeof row === "object" && Array.isArray((row as WireTableRow).cells)) {
      return (row as WireTableRow).cells;
    }
    return [];
  });
}

/** Chuẩn hoá giá trị bất kỳ (string[][] cũ hoặc WireTableRow[] đã lưu) về đúng dạng lưu Firestore. */
export function toWireTableRows(value: unknown): WireTableRow[] {
  return serializeTableRows(deserializeTableRows(value));
}

/**
 * Chuẩn hoá tên cột để so khớp (không phân biệt hoa/thường, bỏ khoảng trắng
 * thừa) — dùng chung giữa trang soạn đề xuất và khu vực "Bổ sung sau duyệt"
 * để 2 nơi luôn hiểu "cùng 1 cột" theo đúng 1 quy tắc (nguyên tắc "một luật,
 * mọi nơi dùng chung").
 */
export function normalizeColumnName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Tên cột "then chốt" theo đúng quy ước công ty đang dùng chung cho mọi mẫu
 * "Chi tiết" — bắt buộc (dấu *) + validate riêng cho "Số lượng" (phải là
 * số) lúc gửi chính thức. Export dùng chung giữa hiển thị (submit/page.tsx)
 * và validate server (lib/server/requests.ts findInvalidTableRows) để không
 * lệch nhau. Xem yêu cầu Sếp 13/09/2026.
 */
export const REQUIRED_TABLE_COLUMN_NAMES = ["Tên hàng", "Quy cách/chủng loại", "ĐVT", "Mục đích sử dụng"];
export const QUANTITY_COLUMN_NAME = "Số lượng";

export function isRequiredTableColumn(name: string): boolean {
  const normalized = normalizeColumnName(name);
  return (
    REQUIRED_TABLE_COLUMN_NAMES.some((n) => normalizeColumnName(n) === normalized) ||
    normalizeColumnName(QUANTITY_COLUMN_NAME) === normalized
  );
}

export function isQuantityColumn(name: string): boolean {
  return normalizeColumnName(name) === normalizeColumnName(QUANTITY_COLUMN_NAME);
}

const QUANTITY_CELL_RE = /^\d+([.,]\d+)?$/;

/** "Số lượng" chỉ nhận số nguyên/thập phân — ô trống không tính là hợp lệ ở
 * đây (kiểm tra "bắt buộc" là việc riêng, xem findInvalidTableRows). */
export function isValidQuantityCellValue(value: string): boolean {
  return QUANTITY_CELL_RE.test(value.trim());
}

// =========================================================================
// KIỂU DỮ LIỆU CỘT BẢNG (Sếp chốt 13/09/2026)
// -------------------------------------------------------------------------
// Nguyên tắc xuyên suốt: ô LƯU SỐ THÔ, chỉ ĐỊNH DẠNG lúc hiển thị.
//   người dùng thấy  1,234,567 VNĐ
//   Firestore lưu    1234567
//   Thu mua đọc      Number("1234567") = 1234567 ✓
// Lưu chuỗi đã định dạng là tái hiện đúng sự cố đề nghị 000000072/073/074.
// =========================================================================

export const TABLE_COLUMN_TYPE_LABELS: Record<TableColumnType, string> = {
  text: "Văn bản ngắn",
  int: "Số nguyên",
  decimal: "Số thập phân",
  money: "Tiền tệ (VNĐ)",
  percent: "Phần trăm",
};

export const TABLE_COLUMN_TYPES = Object.keys(TABLE_COLUMN_TYPE_LABELS) as TableColumnType[];

export function isNumericColumnType(type: TableColumnType): boolean {
  return type !== "text";
}

/**
 * Suy ra kiểu cho TỪNG cột. Nhóm tạo trước 13/09/2026 không có
 * `tableColumnTypes` → cột = văn bản, riêng cột tên "Số lượng" = số thập phân
 * để GIỮ NGUYÊN hành vi cũ (trước đây chỉ cột này bị bắt phải là số).
 * Cũng dùng khi 2 mảng lệch độ dài (admin vừa thêm cột).
 */
export function resolveTableColumnTypes(
  columns: string[],
  types?: TableColumnType[],
): TableColumnType[] {
  return columns.map((name, i) => {
    const declared = types?.[i];
    if (declared && declared in TABLE_COLUMN_TYPE_LABELS) return declared;
    return isQuantityColumn(name) ? "decimal" : "text";
  });
}

/**
 * Bóc mọi thứ người dùng gõ/dán về SỐ THÔ: bỏ khoảng trắng, bỏ đuôi VNĐ/₫/%,
 * bỏ dấu phẩy ngăn nghìn. Cột văn bản trả nguyên si.
 *
 * 🔴 Dấu phẩy có 2 nghĩa tuỳ ngữ cảnh: "1,234,567" là ngăn nghìn (bỏ đi),
 * nhưng "2,5" trong DỮ LIỆU CŨ là 2.5 kiểu Việt (đổi thành dấu chấm) — quy
 * tắc cũ `isValidQuantityCellValue` vốn nhận cả 2 dấu. Không tách 2 trường
 * hợp này là làm hỏng số liệu cũ (2,5 tấn thành 25 tấn).
 */
export function parseCellToRaw(input: string, type: TableColumnType): string {
  if (!isNumericColumnType(type)) return input;
  const cleaned = String(input ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/(vnđ|vnd|₫|đ|%)$/i, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) return cleaned.replace(/,/g, "");
  if (/^\d+,\d+$/.test(cleaned)) return cleaned.replace(",", ".");
  return cleaned.replace(/,/g, "");
}

/** Ô rỗng là hợp lệ ở đây — "bắt buộc" là luật riêng (findInvalidTableRows). */
export function isValidCellValue(raw: string, type: TableColumnType): boolean {
  if (!isNumericColumnType(type)) return true;
  const value = raw.trim();
  if (value === "") return true;
  if (!/^\d+(\.\d+)?$/.test(value)) return false;
  if (type === "int" && value.includes(".")) return false;
  return true;
}

const MAX_FRACTION_DIGITS: Record<TableColumnType, number> = {
  text: 0,
  int: 0,
  decimal: 3,
  money: 0,
  percent: 2,
};

/**
 * Số thô → chuỗi cho người đọc: dấu phẩy sau mỗi 3 chữ số, dấu chấm ngăn phần
 * thập phân (đúng quy ước Sếp chốt), tiền tệ thêm đuôi " VNĐ".
 * Giá trị không phải số (dữ liệu cũ gõ tay, vd "file đính kèm") trả nguyên si
 * để không nuốt mất thông tin.
 */
export function formatCellForDisplay(raw: string, type: TableColumnType): string {
  if (!isNumericColumnType(type)) return raw;
  const value = String(raw ?? "").trim();
  if (value === "") return "";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  const text = parsed.toLocaleString("en-US", { maximumFractionDigits: MAX_FRACTION_DIGITS[type] });
  if (type === "money") return `${text} VNĐ`;
  if (type === "percent") return `${text}%`;
  return text;
}

/** Tổng 1 cột số — bỏ qua ô rỗng/không phải số. `null` = không có ô nào cộng được. */
export function sumColumn(rows: string[][], columnIndex: number): number | null {
  let total = 0;
  let counted = 0;
  for (const row of rows) {
    const value = Number(String(row[columnIndex] ?? "").trim());
    if (Number.isFinite(value) && String(row[columnIndex] ?? "").trim() !== "") {
      total += value;
      counted += 1;
    }
  }
  return counted > 0 ? total : null;
}

/**
 * Sinh file Excel mẫu (.xlsx) chỉ có dòng tiêu đề đúng các cột hiện có, để
 * điền offline — thuần thao tác trình duyệt, không có state. Tách ra từ
 * `app/request/groups/[groupId]/submit/page.tsx` (28/07/2026) để dùng lại y
 * hệt ở khu vực "Bổ sung sau duyệt" trên trang chi tiết đề xuất
 * (change add-post-approval-supplement, 04/09/2026).
 */
export async function downloadTableTemplateFile(columns: string[], filename: string): Promise<void> {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([columns]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Mẫu");
  XLSX.writeFile(wb, filename);
}

export type TableImportResult =
  | { ok: true; newHeaders: string[]; finalColumns: string[]; newRows: string[][] }
  // newHeaders/finalColumns có mặt CẢ KHI ok:false, đúng cho trường hợp file
  // đọc được tiêu đề (nên đã tính ra được cột mới) nhưng KHÔNG có dòng dữ
  // liệu nào — giữ đúng hành vi gốc ở submit/page.tsx (trước khi tách hàm
  // 04/09/2026): cột mới VẪN được thêm vào cấu hình bảng dù việc nhập dòng
  // báo lỗi, vì 2 việc "phát hiện cột mới" và "có dòng dữ liệu để nhập" độc
  // lập nhau trong code cũ. Vắng mặt (undefined) = chưa tính tới bước đó
  // (file không có dòng tiêu đề hợp lệ, hoặc lỗi đọc file).
  | { ok: false; error: string; newHeaders?: string[]; finalColumns?: string[] };

/**
 * Đọc 1 file Excel/CSV đã điền, đối chiếu với các cột hiện có (`existingColumns`):
 * cột khớp tên (qua `normalizeColumnName`) map thẳng vào đúng cột đó, cột LẠ
 * trong file được coi là cột mới. KHÔNG đụng gì tới dòng/cột đã có — hàm này
 * THUẦN đọc file và trả về kết quả, người gọi tự quyết định ghi vào đâu
 * (state cục bộ ở trang soạn, hay gọi API ở trang chi tiết) — tách bạch để
 * dùng lại được ở cả 2 nơi (xem `lib/table-field.ts`, Decision 4 của change
 * add-post-approval-supplement).
 */
export async function parseTableImportFile(
  file: File,
  existingColumns: string[],
  existingColumnTypes?: TableColumnType[],
): Promise<TableImportResult> {
  try {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rowsFromFile = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
    const [headerRow, ...dataRows] = rowsFromFile;
    if (!headerRow || headerRow.every((h) => !String(h).trim())) {
      return { ok: false, error: "File không có dòng tiêu đề hợp lệ." };
    }
    const fileHeaders = headerRow.map((h) => String(h).trim());
    const existingByNormalized = new Map(existingColumns.map((c) => [normalizeColumnName(c), c]));

    const newHeaders = fileHeaders.filter((h) => h && !existingByNormalized.has(normalizeColumnName(h)));
    const finalColumns = [...existingColumns, ...newHeaders];

    const filledDataRows = dataRows.filter((r) => r.some((cell) => String(cell ?? "").trim()));
    if (filledDataRows.length === 0) {
      return { ok: false, error: "File không có dòng dữ liệu nào để nhập.", newHeaders, finalColumns };
    }

    // Cột SỐ: bóc "1,234,567 VNĐ" trong file Excel về số thô trước khi ghi vào
    // đề xuất — người dùng hay định dạng sẵn trong Excel, lưu nguyên chuỗi đó
    // là làm `Number(ô)` bên Thu mua ra NaN (Sếp chốt 13/09/2026).
    const finalTypes = resolveTableColumnTypes(finalColumns, existingColumnTypes);
    const newRows = filledDataRows.map((r) =>
      finalColumns.map((col, colIndex) => {
        const fileColIndex = fileHeaders.findIndex((h) => normalizeColumnName(h) === normalizeColumnName(col));
        const cell = fileColIndex >= 0 ? String(r[fileColIndex] ?? "") : "";
        return parseCellToRaw(cell, finalTypes[colIndex]);
      }),
    );

    return { ok: true, newHeaders, finalColumns, newRows };
  } catch {
    return { ok: false, error: "Không đọc được file — kiểm tra lại định dạng .xlsx/.csv." };
  }
}
