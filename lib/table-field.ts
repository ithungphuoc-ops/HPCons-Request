import type { FieldDataType, TableColumnType } from "@/lib/types";

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

/**
 * Cột LUÔN bắt buộc, admin KHÔNG bỏ tick được (Sếp chốt 05/10/2026, review
 * PR #69): đồng bộ sang Thu mua/Kho lọc bỏ dòng thiếu tên hàng hoặc số lượng
 * (`.filter(v => v.tenVatTu && v.soLuong > 0)`), nên cho bỏ trống sẽ lặng lẽ
 * mất dòng vật tư — khoá luôn để tránh quên.
 */
export const LOCKED_REQUIRED_TABLE_COLUMN_NAMES = ["Tên hàng", QUANTITY_COLUMN_NAME];

export function isLockedRequiredTableColumn(name: string): boolean {
  const normalized = normalizeColumnName(name);
  return LOCKED_REQUIRED_TABLE_COLUMN_NAMES.some((n) => normalizeColumnName(n) === normalized);
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
  date: "Ngày",
  datetime: "Ngày giờ",
  single_choice: "Danh sách (một lựa chọn)",
  multiple_choice: "Danh sách (nhiều lựa chọn)",
};

export const TABLE_COLUMN_TYPES = Object.keys(TABLE_COLUMN_TYPE_LABELS) as TableColumnType[];

/**
 * Nhóm hiển thị trong ô chọn kiểu cột có "Lọc nhanh" (Sếp duyệt demo
 * 07/10/2026, theo mẫu Base): Chữ / Số / Ngày / Danh sách.
 */
export const TABLE_COLUMN_TYPE_GROUPS: { label: string; types: TableColumnType[] }[] = [
  { label: "Chữ", types: ["text"] },
  { label: "Số", types: ["int", "decimal", "money", "percent"] },
  { label: "Ngày", types: ["date", "datetime"] },
  { label: "Danh sách", types: ["single_choice", "multiple_choice"] },
];

/**
 * Bỏ dấu tiếng Việt + chữ thường — để ô "Lọc nhanh" gõ "ngay" vẫn ra "Ngày".
 */
export function foldVietnamese(text: string): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/** Lọc danh sách nhóm kiểu cột theo từ khoá (không phân biệt dấu/hoa thường); nhóm rỗng bị bỏ. */
export function filterTableColumnTypeGroups(query: string): { label: string; types: TableColumnType[] }[] {
  const q = foldVietnamese(query);
  if (!q) return TABLE_COLUMN_TYPE_GROUPS;
  return TABLE_COLUMN_TYPE_GROUPS.map((g) => ({
    label: g.label,
    types: g.types.filter(
      (t) => foldVietnamese(TABLE_COLUMN_TYPE_LABELS[t]).includes(q) || foldVietnamese(g.label).includes(q),
    ),
  })).filter((g) => g.types.length > 0);
}

/**
 * Kiểu CỘT tương ứng với kiểu TRƯỜNG đứng riêng — `null` nghĩa là trường đó
 * không phải trường số.
 *
 * Lý do có hàm này (Sếp hỏi 14/09/2026): 13/09 mới chỉ làm định dạng tiền tệ
 * cho CỘT TRONG BẢNG. Trường "Tiền tệ" đứng riêng thì vẫn dùng chung nhánh với
 * "Số thập phân" — chỉ là một ô nhập số trơn, hiện ra màn hình là `74610000`
 * không dấu phẩy không VNĐ. Tức là chọn "Tiền tệ" hay "Số thập phân" cho ra
 * kết quả y hệt nhau, cái nhãn đó chưa có tác dụng gì.
 *
 * Thay vì viết bộ định dạng thứ hai, nối thẳng vào bộ đã có của cột bảng để
 * hai nơi KHÔNG BAO GIỜ lệch nhau: cùng dấu phẩy ngăn hàng nghìn, cùng dấu
 * chấm thập phân, cùng đuôi VNĐ.
 */
export function numericTypeForFieldDataType(dataType: FieldDataType): TableColumnType | null {
  switch (dataType) {
    case "currency":
      return "money";
    case "integer":
      return "int";
    case "decimal":
      return "decimal";
    default:
      return null;
  }
}

const NUMERIC_COLUMN_TYPES: ReadonlySet<TableColumnType> = new Set<TableColumnType>([
  "int",
  "decimal",
  "money",
  "percent",
]);

/**
 * 🔴 Trước 07/10/2026 hàm này là `type !== "text"` — chỉ đúng khi mới có 1
 * kiểu chữ. Nay có thêm Ngày/Danh sách (không phải số) nên phải liệt kê đúng
 * 4 kiểu số, nếu không cột Ngày sẽ bị lọc mất chữ khi gõ và bật được "Tổng".
 */
export function isNumericColumnType(type: TableColumnType): boolean {
  return NUMERIC_COLUMN_TYPES.has(type);
}

export function isDateColumnType(type: TableColumnType | undefined): type is "date" | "datetime" {
  return type === "date" || type === "datetime";
}

export function isChoiceColumnType(
  type: TableColumnType | undefined,
): type is "single_choice" | "multiple_choice" {
  return type === "single_choice" || type === "multiple_choice";
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

// =========================================================================
// CỘT DANH SÁCH (Sếp duyệt demo 07/10/2026)
// -------------------------------------------------------------------------
// Admin gõ phương án cách nhau bằng dấu phẩy, y như Base: "Có,Không".
// Lưu ở `ProposalField.tableColumnOptions` dạng CHUỖI cho từng cột (Firestore
// không cho mảng lồng mảng). Ô "nhiều lựa chọn" lưu các phương án nối bằng
// ", " — KHÔNG mơ hồ vì phương án không chứa được dấu phẩy, và mọi nơi đọc
// cũ (in Word, xuất Excel, đồng bộ Thu mua/Kho, tìm kiếm) vẫn thấy đúng một
// chuỗi người đọc được "Base, NAS" mà không cần biết kiểu cột. Ô vẫn là
// string như mọi ô khác → không phải đổi `string[][]` / `WireTableRow`.
// =========================================================================

/**
 * "Có, Không,,có " → ["Có", "Không"]: bỏ khoảng trắng 2 đầu, bỏ phương án
 * rỗng, gộp phương án trùng (không phân biệt hoa/thường — giữ cách viết lần
 * đầu) vì lúc nhập Excel phương án được so khớp không phân biệt hoa thường,
 * để "Có" và "có" cùng tồn tại là không biết khớp vào đâu.
 */
export function parseChoiceOptionsText(text: string | undefined | null): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of String(text ?? "").split(",")) {
    const option = part.trim().replace(/\s+/g, " ");
    if (!option) continue;
    const key = option.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(option);
  }
  return result;
}

/**
 * Phương án của TỪNG cột (cùng mẫu `resolveTableColumnTypes`): cột không phải
 * danh sách → `[]`; thiếu/lệch độ dài → `[]` (không đoán). `types` nên là kết
 * quả đã resolve, nhận cả mảng thô cho tiện — tự resolve lại.
 */
export function resolveTableColumnOptions(
  columns: string[],
  types?: TableColumnType[],
  saved?: string[],
): string[][] {
  const resolvedTypes = resolveTableColumnTypes(columns, types);
  return columns.map((_, i) => {
    if (!isChoiceColumnType(resolvedTypes[i])) return [];
    const declared = saved?.[i];
    return typeof declared === "string" ? parseChoiceOptionsText(declared) : [];
  });
}

/** Chuẩn hoá `tableColumnOptions` trước khi ghi DB: đúng độ dài `columns`, cột không phải danh sách để "". */
export function normalizeTableColumnOptionsForStorage(
  columns: string[],
  types?: TableColumnType[],
  saved?: string[],
): string[] {
  return resolveTableColumnOptions(columns, types, saved).map((options) => options.join(","));
}

/** Tách ô "nhiều lựa chọn" đã lưu ("Base, NAS") thành từng phương án. */
export function splitMultiChoiceCell(raw: string | undefined | null): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Ghép các phương án đã chọn thành giá trị ô — theo THỨ TỰ admin khai (không
 * theo thứ tự bấm) để cùng một tập chọn luôn ra cùng một chuỗi; phương án lạ
 * (không còn trong danh sách) giữ ở cuối để không lặng lẽ mất dữ liệu.
 */
export function joinMultiChoiceCell(selected: string[], options: string[]): string {
  const picked = new Set(selected);
  const ordered = options.filter((o) => picked.has(o));
  const extras = selected.filter((s, i) => !options.includes(s) && selected.indexOf(s) === i);
  return [...ordered, ...extras].join(", ");
}

/**
 * Khớp chữ người dùng gõ/dán (file Excel) vào phương án: bỏ khoảng trắng 2
 * đầu, không phân biệt hoa/thường → trả ĐÚNG chữ của phương án. Không khớp
 * → `null`.
 */
export function matchChoiceOption(input: string, options: string[]): string | null {
  const key = String(input ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!key) return null;
  return options.find((o) => o.toLowerCase() === key) ?? null;
}

/**
 * Chuẩn hoá ô danh sách lúc NHẬP FILE: khớp được hết thì trả chữ đúng của
 * phương án (nhiều lựa chọn: nối ", " theo thứ tự admin khai); có phương án
 * không khớp thì trả nguyên chữ (đã trim) để ô hiện đỏ + bị chặn lúc gửi, y
 * như ô số gõ sai. Cột chưa có phương án nào → giữ nguyên (không có gì để khớp).
 */
export function normalizeChoiceCell(input: string, type: TableColumnType, options: string[]): string {
  const text = String(input ?? "").trim();
  if (!text || options.length === 0) return text;
  if (type === "single_choice") return matchChoiceOption(text, options) ?? text;
  // Nhiều lựa chọn trong file Excel hay được ngăn bằng phẩy, chấm phẩy hoặc xuống dòng.
  const parts = text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const matched = parts.map((p) => matchChoiceOption(p, options));
  if (matched.some((m) => m === null)) return text;
  return joinMultiChoiceCell(matched as string[], options);
}

// =========================================================================
// CỘT NGÀY / NGÀY GIỜ (Sếp duyệt demo 07/10/2026)
// -------------------------------------------------------------------------
// Lưu "YYYY-MM-DD" / "YYYY-MM-DDTHH:mm" — đúng giá trị của <input type="date">
// / <input type="datetime-local">, giờ VN đúng như người gõ, KHÔNG qua
// new Date(chuỗi) để khỏi lệch múi giờ (máy chủ Vercel chạy UTC — xem sự cố
// SLA 05/10/2026).
// =========================================================================

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function isRealDate(y: number, m: number, d: number): boolean {
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function isoDate(y: number, m: number, d: number): string | null {
  return isRealDate(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
}

function isoTime(h: number, min: number): string | null {
  return h >= 0 && h <= 23 && min >= 0 && min <= 59 ? `${pad2(h)}:${pad2(min)}` : null;
}

/** Ô ngày / ngày giờ đã lưu có đúng định dạng + là ngày có thật không. */
export function isValidDateCellValue(raw: string, type: "date" | "datetime"): boolean {
  const value = String(raw ?? "").trim();
  const m = (type === "date" ? ISO_DATE_RE : ISO_DATETIME_RE).exec(value);
  if (!m) return false;
  if (!isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) return false;
  if (type === "datetime") return isoTime(Number(m[4]), Number(m[5])) !== null;
  return true;
}

/**
 * Số ngày kiểu Excel (ô định dạng ngày trong file .xlsx đọc ra là số, vd
 * 46302 = 07/10/2026; phần lẻ là giờ trong ngày) → ngày/giờ. Mốc 30/12/1899
 * đã tính sẵn lỗi năm nhuận 1900 của Excel. Tính bằng UTC thuần để không
 * dính múi giờ máy chạy.
 */
function excelSerialToParts(serial: number): { y: number; m: number; d: number; h: number; min: number } | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const totalMinutes = Math.round(serial * 24 * 60);
  const dt = new Date(Date.UTC(1899, 11, 30) + totalMinutes * 60 * 1000);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    h: dt.getUTCHours(),
    min: dt.getUTCMinutes(),
  };
}

/**
 * Chữ người dùng gõ/dán/nhập file → giá trị lưu của ô ngày. Nhận:
 *   - đã đúng chuẩn lưu ("2026-10-07", "2026-10-07T08:30"; có giây thì bỏ giây),
 *   - kiểu Việt "07/10/2026", "7/10/2026", "07-10-2026", "07.10.2026"
 *     (ngày giờ thêm " 08:30"),
 *   - số ngày kiểu Excel (chỉ khi `allowExcelSerial` — lúc nhập file).
 * Không hiểu được → trả nguyên chữ đã trim (để ô hiện đỏ + bị chặn lúc gửi,
 * không lặng lẽ xoá chữ người dùng gõ).
 */
export function parseDateCellInput(input: string, type: "date" | "datetime", allowExcelSerial = false): string {
  const text = String(input ?? "").trim();
  if (!text) return "";

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(text);
  const vn = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T,]+(\d{1,2})[:h](\d{2})(?::\d{2})?)?$/.exec(text);
  let y: number;
  let m: number;
  let d: number;
  let h = 0;
  let min = 0;
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (iso[4] !== undefined) [h, min] = [Number(iso[4]), Number(iso[5])];
  } else if (vn) {
    [d, m, y] = [Number(vn[1]), Number(vn[2]), Number(vn[3])];
    if (vn[4] !== undefined) [h, min] = [Number(vn[4]), Number(vn[5])];
  } else if (allowExcelSerial && /^\d+(\.\d+)?$/.test(text)) {
    const parts = excelSerialToParts(Number(text));
    if (!parts) return text;
    ({ y, m, d, h, min } = parts);
  } else {
    return text;
  }

  const datePart = isoDate(y, m, d);
  if (!datePart) return text;
  if (type === "date") return datePart;
  // Ngày giờ mà chỉ có ngày → 00:00 (giống ô chọn ngày giờ chưa chọn giờ).
  const timePart = isoTime(h, min);
  return timePart ? `${datePart}T${timePart}` : text;
}

/** "2026-10-07" → "07/10/2026"; "2026-10-07T08:30" → "07/10/2026 08:30". Sai định dạng → trả nguyên. */
function formatDateCell(raw: string, type: "date" | "datetime"): string {
  const value = String(raw ?? "").trim();
  if (!isValidDateCellValue(value, type)) return value;
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = datePart.split("-");
  const vn = `${d}/${m}/${y}`;
  return type === "datetime" ? `${vn} ${timePart}` : vn;
}

/** 3 mức gợi ý nhanh khi chọn độ rộng cột — bấm để áp nhanh, KHÔNG khoá cứng
 * (Admin vẫn tự gõ số px bất kỳ, xem `ProposalField.tableColumnWidths`). */
export const TABLE_COLUMN_WIDTH_PRESETS = [
  { label: "Nhỏ", px: 100 },
  { label: "Vừa", px: 160 },
  { label: "Lớn", px: 240 },
] as const;

export const DEFAULT_TABLE_COLUMN_WIDTH_PX = 160;

/** Cột cũ/thiếu `tableColumnWidths` (tạo trước 01/10/2026) → mặc định "Vừa"
 * (160px) — cùng mẫu với `resolveTableColumnTypes`. */
export function resolveTableColumnWidths(columns: string[], widths?: number[]): number[] {
  return columns.map((_, i) => {
    const declared = widths?.[i];
    return typeof declared === "number" && Number.isFinite(declared) && declared > 0
      ? Math.round(declared)
      : DEFAULT_TABLE_COLUMN_WIDTH_PX;
  });
}

/**
 * Cột nào BẮT BUỘC nhập (dòng đã có dữ liệu thì ô cột này không được trống)
 * — Sếp duyệt demo 05/10/2026: Admin tự tick từng cột, song song index với
 * `tableColumns` (cùng mẫu `resolveTableColumnTypes`/`resolveTableColumnWidths`).
 * Trường cũ chưa có `tableColumnRequired` (hoặc lệch độ dài — vd cột vừa được
 * thêm qua nhập file) → cột đó suy theo LUẬT CŨ: tên khớp
 * `REQUIRED_TABLE_COLUMN_NAMES` hoặc "Số lượng" (`isRequiredTableColumn`), để
 * không mẫu nào bị đổi hành vi khi chưa ai mở ra sửa. Riêng "Tên hàng" và
 * "Số lượng" LUÔN bắt buộc bất kể đã lưu gì (`isLockedRequiredTableColumn`).
 */
export function resolveTableColumnRequired(columns: string[], saved?: boolean[]): boolean[] {
  return columns.map((name, i) => {
    if (isLockedRequiredTableColumn(name)) return true;
    const declared = saved?.[i];
    return typeof declared === "boolean" ? declared : isRequiredTableColumn(name);
  });
}

/**
 * Cột nào có DÒNG TỔNG cuối bảng — chỉ cột kiểu số (int/decimal/money/
 * percent); cột văn bản luôn `false` kể cả khi dữ liệu lưu `true` (vd admin
 * đổi kiểu cột sang văn bản sau khi đã tick). Trường cũ chưa có
 * `tableColumnSum` (hoặc lệch độ dài) → LUẬT CŨ: mọi cột tiền tệ có tổng
 * (đúng hành vi trước 05/10/2026). `types` nên là kết quả đã resolve
 * (`resolveTableColumnTypes`), nhận cả mảng thô cho tiện — tự resolve lại.
 */
export function resolveTableColumnSum(
  columns: string[],
  types?: TableColumnType[],
  saved?: boolean[],
): boolean[] {
  const resolvedTypes = resolveTableColumnTypes(columns, types);
  return columns.map((_, i) => {
    const type = resolvedTypes[i];
    if (!isNumericColumnType(type)) return false;
    const declared = saved?.[i];
    return typeof declared === "boolean" ? declared : type === "money";
  });
}

/**
 * Lọc ký tự KHÔNG hợp lệ NGAY lúc gõ (Sếp phát hiện 01/10/2026: ô số/tiền tệ
 * trước đây cho gõ chữ tự do, chỉ lặng lẽ dọn dẹp lúc rời ô — dữ liệu không
 * phải số có thể lọt xuống nếu người dùng không để ý, giống lỗi đề nghị
 * 000000072/073/074 đã gặp). CHỈ chặn chữ cái/ký tự lạ và dấu trừ (mọi field
 * số trong app Đề xuất luôn dương, Sếp chốt 01/10/2026) — CỐ Ý giữ lại dấu
 * phẩy, KHÔNG tự diễn giải ở bước này: dấu phẩy có 2 nghĩa tuỳ ngữ cảnh (ngăn
 * nghìn "1,234,567" hay thập phân kiểu Việt "2,5"), việc phân biệt và chuẩn
 * hoá cuối cùng vẫn do `parseCellToRaw` đảm nhận lúc rời ô như trước giờ —
 * lọc bỏ dấu phẩy ngay ở bước gõ sẽ biến "2,5" thành "25" (CodeRabbit PR #62).
 */
export function filterNumericInput(input: string, type: TableColumnType): string {
  if (!isNumericColumnType(type)) return input;
  return input.replace(/[^0-9.,]/g, "");
}

/**
 * Đưa mọi kiểu xuống dòng về `\n`. Ô văn bản của bảng cho phép xuống dòng
 * trong ô (Sếp duyệt demo 07/10/2026 "o-bang-tu-xuong-dong"); file Excel/CSV
 * của Windows có thể mang `\r\n` hoặc `\r` lẻ — để nguyên thì bản xuất
 * Word/Excel dính ký tự `\r` lạ.
 */
export function normalizeLineBreaks(text: string): string {
  // Dữ liệu cũ có thể lưu số/null trong ô → đổi về chuỗi thay vì nuốt mất.
  if (text === null || text === undefined) return "";
  return String(text).replace(/\r\n?/g, "\n");
}

/**
 * Bỏ khoảng trắng/xuống dòng THỪA ở CUỐI ô văn bản (Sếp duyệt 07/10/2026) —
 * Enter lỡ tay ở cuối ô không sinh dòng trắng khi lưu/hiển thị/in/xuất.
 * Giữ nguyên xuống dòng ở giữa và khoảng trắng đầu dòng (thụt lề người gõ).
 */
export function trimCellTextEnd(text: string): string {
  return normalizeLineBreaks(text).trimEnd();
}

/**
 * Gộp xuống dòng thành 1 dấu cách + bỏ khoảng trắng 2 đầu — dùng khi GỬI
 * dữ liệu ô bảng sang app khác (Thu mua/Kho) vốn chỉ hiển thị 1 dòng và so
 * khớp tên vật tư theo chuỗi (Sếp chốt 07/10/2026). Dữ liệu gốc trong app Đề
 * xuất vẫn giữ nguyên xuống dòng.
 */
export function flattenLineBreaks(text: string): string {
  return normalizeLineBreaks(text).replace(/\s*\n+\s*/g, " ").trim();
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
  // Cột ngày: đưa "07/10/2026" về chuẩn lưu "2026-10-07" (07/10/2026).
  if (isDateColumnType(type)) return parseDateCellInput(input, type);
  // Cột danh sách: chỉ bỏ khoảng trắng 2 đầu — khớp phương án cần biết danh
  // sách phương án, xem `normalizeChoiceCell`.
  if (isChoiceColumnType(type)) return String(input ?? "").trim();
  // Cột văn bản: giữ nguyên chữ, chỉ đưa xuống dòng về "\n" (ô Excel gõ
  // Alt+Enter / file CSV Windows có thể mang "\r\n") — 07/10/2026.
  if (!isNumericColumnType(type)) return normalizeLineBreaks(input);
  const cleaned = String(input ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/(vnđ|vnd|₫|đ|%)$/i, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) return cleaned.replace(/,/g, "");
  if (/^\d+,\d+$/.test(cleaned)) return cleaned.replace(",", ".");
  return cleaned.replace(/,/g, "");
}

/** Ô rỗng là hợp lệ ở đây — "bắt buộc" là luật riêng (findInvalidTableRows). */
/**
 * Chuẩn hoá giá trị TRƯỚC KHI LƯU, để "số lưu xuống" luôn khớp "số hiện ra".
 *
 * Chỉ có tác dụng với kiểu tiền tệ (CodeRabbit bắt được trên PR #26,
 * 14/09/2026). Đồng Việt Nam không có đơn vị nhỏ hơn nên khi hiển thị,
 * `formatCellForDisplay` làm tròn về số nguyên. Nhưng phần kiểm tra lại CHẤP
 * NHẬN "1234.5", nên trước đây giá trị đó được lưu nguyên: màn hình và bản in
 * hiện "1,235 VNĐ" trong khi điều kiện hiển thị field, công thức và dòng tổng
 * cộng vẫn tính trên 1234.5. Hai con số cho cùng một ô — kiểu sai lệch rất khó
 * lần ra vì nhìn vào đâu cũng thấy hợp lý.
 *
 * Làm tròn ngay lúc lưu chứ không từ chối: người dùng dán số từ Excel có phần
 * lẻ là chuyện thường, và vì ô nhập hiện bản đã định dạng ngay khi rời ô nên
 * họ THẤY con số đã làm tròn — không có gì bị đổi lén.
 */
export function normalizeRawForStorage(raw: string, type: TableColumnType): string {
  if (type !== "money") return raw;
  const value = String(raw ?? "").trim();
  if (value === "") return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return String(Math.round(parsed));
}

/**
 * `options` = phương án của cột (chỉ dùng cho cột danh sách, xem
 * `resolveTableColumnOptions`). Cột danh sách chưa có phương án nào (dữ liệu
 * lệch) → nhận mọi giá trị, vì không có gì để đối chiếu.
 */
export function isValidCellValue(raw: string, type: TableColumnType, options?: string[]): boolean {
  const value = String(raw ?? "").trim();
  if (value === "") return true;
  if (isDateColumnType(type)) return isValidDateCellValue(value, type);
  if (isChoiceColumnType(type)) {
    if (!options || options.length === 0) return true;
    if (type === "single_choice") return options.includes(value);
    return splitMultiChoiceCell(value).every((part) => options.includes(part));
  }
  if (!isNumericColumnType(type)) return true;
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
  date: 0,
  datetime: 0,
  single_choice: 0,
  multiple_choice: 0,
};

/**
 * Câu báo lỗi cho 1 ô sai định dạng, dùng chung giữa trang gửi đề xuất và máy
 * chủ để 2 nơi nói cùng một câu. `null` = ô hợp lệ (ô rỗng luôn hợp lệ ở
 * đây — "bắt buộc" là luật riêng). Câu cho cột số giữ đúng như trước 07/10/2026.
 */
export function invalidCellReason(raw: string, type: TableColumnType, options?: string[]): string | null {
  if (isValidCellValue(raw, type, options)) return null;
  switch (type) {
    case "int":
      return "phải là số nguyên";
    case "date":
      return "phải là ngày hợp lệ (dd/mm/yyyy)";
    case "datetime":
      return "phải là ngày giờ hợp lệ (dd/mm/yyyy hh:mm)";
    case "single_choice":
      return "phải là một phương án trong danh sách";
    case "multiple_choice":
      return "chỉ được chọn các phương án trong danh sách";
    default:
      return "phải là số";
  }
}

/**
 * Số thô → chuỗi cho người đọc: dấu phẩy sau mỗi 3 chữ số, dấu chấm ngăn phần
 * thập phân (đúng quy ước Sếp chốt), tiền tệ thêm đuôi " VNĐ".
 * Giá trị không phải số (dữ liệu cũ gõ tay, vd "file đính kèm") trả nguyên si
 * để không nuốt mất thông tin.
 */
export function formatCellForDisplay(raw: string, type: TableColumnType): string {
  if (isDateColumnType(type)) return formatDateCell(raw, type);
  // Đã lưu sẵn dạng "A, B" — tách rồi nối lại cho chắc đúng 1 kiểu ngăn.
  if (type === "multiple_choice") return splitMultiChoiceCell(raw).join(", ");
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

/**
 * Ô bảng → chữ cho NGƯỜI ĐỌC (xem chi tiết, xuất Excel/Word): cột số/ngày/
 * nhiều lựa chọn định dạng theo kiểu; cột chữ và một lựa chọn chỉ bỏ dòng
 * trắng thừa cuối ô (07/10/2026). `type` vắng (ô thừa ngoài số cột) → như chữ.
 */
export function formatCellForReading(raw: string, type: TableColumnType | undefined): string {
  if (type && (isNumericColumnType(type) || isDateColumnType(type) || type === "multiple_choice")) {
    return formatCellForDisplay(raw ?? "", type);
  }
  return trimCellTextEnd(raw ?? "");
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
  | {
      ok: true;
      newHeaders: string[];
      finalColumns: string[];
      newRows: string[][];
      /** Ô cột Ngày/Danh sách trong file không hiểu được (07/10/2026) — vẫn
       * nhập nguyên chữ (ô hiện đỏ, bị chặn lúc gửi), mảng này để báo người
       * dùng biết dòng nào cần sửa (tối đa vài câu đầu, đếm đủ ở `invalidCellCount`). */
      invalidCells: string[];
      invalidCellCount: number;
    }
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
  existingColumnOptions?: string[],
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
    const finalOptions = resolveTableColumnOptions(finalColumns, finalTypes, existingColumnOptions);
    const newRows = filledDataRows.map((r) =>
      finalColumns.map((col, colIndex) => {
        const fileColIndex = fileHeaders.findIndex((h) => normalizeColumnName(h) === normalizeColumnName(col));
        const cell = fileColIndex >= 0 ? String(r[fileColIndex] ?? "") : "";
        return parseImportedCell(cell, finalTypes[colIndex], finalOptions[colIndex]);
      }),
    );
    const { messages: invalidCells, count: invalidCellCount } = describeInvalidImportedCells(
      newRows,
      finalColumns,
      finalTypes,
      finalOptions,
    );

    return { ok: true, newHeaders, finalColumns, newRows, invalidCells, invalidCellCount };
  } catch {
    return { ok: false, error: "Không đọc được file — kiểm tra lại định dạng .xlsx/.csv." };
  }
}

/**
 * 1 ô đọc từ file Excel/CSV → giá trị lưu. Cột ngày nhận thêm số ngày kiểu
 * Excel (ô định dạng ngày trong .xlsx đọc ra là số); cột danh sách khớp
 * phương án không phân biệt hoa thường (07/10/2026). Cột số/chữ: y như cũ.
 */
export function parseImportedCell(cell: string, type: TableColumnType, options: string[] = []): string {
  if (isDateColumnType(type)) return parseDateCellInput(cell, type, true);
  if (isChoiceColumnType(type)) return normalizeChoiceCell(cell, type, options);
  return parseCellToRaw(cell, type);
}

const MAX_IMPORT_INVALID_MESSAGES = 5;

/**
 * Liệt kê ô cột Ngày/Danh sách không hợp lệ sau khi nhập file. CHỈ xét 2 nhóm
 * kiểu mới — cột số sai vẫn chỉ hiện đỏ trong bảng như trước 07/10/2026,
 * không đổi hành vi nhập file của nhóm cũ.
 */
export function describeInvalidImportedCells(
  rows: string[][],
  columns: string[],
  types: TableColumnType[],
  options: string[][],
): { messages: string[]; count: number } {
  const messages: string[] = [];
  let count = 0;
  rows.forEach((row, rowIndex) => {
    columns.forEach((col, colIndex) => {
      const type = types[colIndex];
      if (!isDateColumnType(type) && !isChoiceColumnType(type)) return;
      const value = row[colIndex] ?? "";
      if (!value.trim()) return;
      const reason = invalidCellReason(value, type, options[colIndex]);
      if (!reason) return;
      count += 1;
      if (messages.length < MAX_IMPORT_INVALID_MESSAGES) {
        messages.push(`Dòng ${rowIndex + 1} trong file, cột "${col}": "${value}" ${reason}.`);
      }
    });
  });
  return { messages, count };
}
