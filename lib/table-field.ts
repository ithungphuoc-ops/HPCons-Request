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

    const newRows = filledDataRows.map((r) =>
      finalColumns.map((col) => {
        const fileColIndex = fileHeaders.findIndex((h) => normalizeColumnName(h) === normalizeColumnName(col));
        return fileColIndex >= 0 ? String(r[fileColIndex] ?? "") : "";
      }),
    );

    return { ok: true, newHeaders, finalColumns, newRows };
  } catch {
    return { ok: false, error: "Không đọc được file — kiểm tra lại định dạng .xlsx/.csv." };
  }
}
