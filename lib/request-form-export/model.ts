import { STATUS_LABEL } from "@/components/request/RequestStatusBadge";
import { getIsoWeekInfo } from "@/lib/iso-week";
import { printFileBaseName } from "@/lib/letterhead";
import { formatCountdown } from "@/lib/approver-progress";
import { formatFieldValue, formatValue } from "@/lib/request-field-format";
import { ADJUSTMENT_HISTORY_PREFIX, ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX } from "@/lib/request-history-labels";
import { resolveRequestTitle } from "@/lib/request-title";
import {
  deserializeTableRows,
  formatCellForDisplay,
  isNumericColumnType,
  numericTypeForFieldDataType,
  resolveTableColumnSum,
  resolveTableColumnTypes,
  sumColumn,
} from "@/lib/table-field";
import { loggedSupplementRows } from "@/lib/table-supplement-log";
import type {
  ApprovalTimeField,
  ProposalField,
  RequestAttachment,
  RequestHistoryEntry,
  RequestInstance,
  TableColumnType,
  TaggedUser,
} from "@/lib/types";

/**
 * Nội dung 1 đề xuất theo ĐÚNG thứ tự/bố cục bản "In đề xuất" (PDF) — dựng 1 lần rồi
 * đưa cho bộ ghi Word (./docx.ts) và Excel (./xlsx.ts), để 2 file luôn khớp nhau và
 * khớp trang chi tiết (dùng chung bộ định dạng lib/request-field-format + lib/table-field).
 * KHÔNG in kiểu dữ liệu của trường ("Văn bản ngắn", "Ngày"…) — Sếp chốt 05/10/2026.
 * Hàm thuần, không đụng DOM — để test được.
 */

export interface FormCell {
  text: string;
  /** Có giá trị số thật → Excel ghi SỐ (tính toán được), kèm định dạng hiển thị. */
  num?: number;
  numFmt?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
}

export interface FormTable {
  columns: string[];
  /** Cột "#" (số thứ tự) ở đầu như trên web — đã nằm sẵn trong `columns`/`rows`. */
  rows: FormCell[][];
  sumRow: FormCell[] | null;
}

export interface FormField {
  label: string;
  value?: string;
  /** Trường số đứng riêng (Tiền tệ/Số…) có giá trị số thật → Excel ghi SỐ. */
  num?: number;
  numFmt?: string;
  /** Danh sách (vd tên tệp đính kèm) — mỗi mục 1 dòng. */
  lines?: string[];
  table?: FormTable;
}

export interface FormInfoItem {
  label: string;
  value: string;
  accent?: boolean;
}

export interface FormAdjustmentEntry {
  note: string;
  meta: string;
  file?: string;
}

export interface FormAdjustment {
  description: string;
  /** Dòng đã bổ sung bằng khối bảng cũ (trước 15/09/2026). */
  supplementTables: { title: string; table: FormTable }[];
  pending: FormAdjustmentEntry | null;
  entries: FormAdjustmentEntry[];
  attachments: { name: string; meta?: string }[];
}

export interface RequestFormModel {
  title: string;
  code: string;
  status: string;
  /** Màu chữ trạng thái (hex không dấu #). */
  statusColor: string;
  info: FormInfoItem[];
  fields: FormField[];
  approvalFields: FormField[];
  adjustment: FormAdjustment | null;
  /** Chân trang (không gồm số trang) — "" khi Admin để trống "Tên hiển thị". */
  footerLabel: string;
  fileBaseName: string;
}

export interface RequestFormInput {
  request: RequestInstance;
  /** State SỐNG trên trang (có thể mới hơn `request` sau khi vừa điều chỉnh). */
  history: RequestHistoryEntry[];
  attachments: RequestAttachment[];
  approvalTimeFields: ApprovalTimeField[];
  /** Tên hiển thị của công ty (resolvePrintBrand) — "" = ẩn. */
  brand: string;
  now?: number;
}

export const ADJUSTMENT_DESCRIPTION =
  "Dùng khi phiếu đã duyệt nhưng cần sửa đổi số lượng hoặc quy cách hàng đã đề xuất. Không áp dụng cho việc đề nghị hàng khác.";

const STATUS_COLOR: Record<RequestInstance["status"], string> = {
  draft: "6B7280",
  pending: "D97706",
  approved: "16A34A",
  rejected: "DC2626",
  returned: "EA580C",
};

const vnDateTime = (iso: string) => new Date(iso).toLocaleString("vi-VN");

/** Định dạng số cho Excel theo kiểu cột — số nguyên không hiện phần lẻ thừa ("1,900", không "1,900."). */
export function excelNumFmt(type: TableColumnType, value: number): string {
  // "Nguyên" tính SAU khi làm tròn theo số chữ số lẻ hiển thị (như web) — tránh "0." khi phần lẻ
  // quá nhỏ bị làm tròn mất (QA 05/10/2026: 0.0004 hiện "0.").
  const digits = type === "percent" ? 2 : 3;
  const whole = Number.isInteger(Math.round(value * 10 ** digits) / 10 ** digits);
  switch (type) {
    case "money":
      return '#,##0" VNĐ"';
    case "percent":
      return whole ? '#,##0"%"' : '#,##0.##"%"';
    case "int":
      return "#,##0";
    default:
      return whole ? "#,##0" : "#,##0.###";
  }
}

function numericCell(raw: string, type: TableColumnType, bold: boolean): FormCell {
  const text = formatCellForDisplay(raw ?? "", type) || "—";
  const trimmed = String(raw ?? "").trim();
  const value = Number(trimmed);
  if (trimmed !== "" && Number.isFinite(value)) {
    return { text, num: value, numFmt: excelNumFmt(type, value), align: "right", bold };
  }
  return { text, align: "right", bold };
}

/** Bảng giống TableValueView trên web: bỏ dòng trống, cột số canh phải + đậm, dòng TỔNG theo tick "Tổng". */
export function buildFormTable(
  field: Pick<ProposalField, "tableColumns" | "tableColumnTypes" | "tableColumnSum">,
  rawRows: string[][],
  lastColumnNote?: (rowIndex: number) => string | null,
): FormTable | null {
  const columns = field.tableColumns ?? [];
  if (columns.length === 0) return null;
  const filled = rawRows.filter((row) => row.some((cell) => cell?.trim()));
  if (filled.length === 0) return null;
  const types = resolveTableColumnTypes(columns, field.tableColumnTypes);
  const sumFlags = resolveTableColumnSum(columns, types, field.tableColumnSum);

  const rows: FormCell[][] = filled.map((row, r) => [
    { text: String(r + 1), align: "center" },
    ...columns.map((_, c): FormCell => {
      const raw = row[c] ?? "";
      if (isNumericColumnType(types[c])) return numericCell(raw, types[c], true);
      let text = raw || "—";
      const note = c === columns.length - 1 ? lastColumnNote?.(r) : null;
      if (note) text = `${text}\n${note}`;
      return { text };
    }),
  ]);

  let sumRow: FormCell[] | null = null;
  if (sumFlags.includes(true)) {
    sumRow = [
      { text: "" },
      ...columns.map((_, c): FormCell => {
        const total = sumFlags[c] ? sumColumn(filled, c) : null;
        if (total === null) return { text: c === 0 ? "Tổng cộng" : "", bold: true };
        return {
          text: formatCellForDisplay(String(total), types[c]),
          num: total,
          numFmt: excelNumFmt(types[c], total),
          align: "right",
          bold: true,
        };
      }),
    ];
  }
  return { columns: ["#", ...columns], rows, sumRow };
}

function fieldEntry(field: ProposalField, index: number, value: unknown): FormField {
  const label = `${String(index + 1).padStart(2, "0")}. ${field.name}`;
  if (field.dataType === "table" || field.dataType === "base_table") {
    const table = buildFormTable(field, deserializeTableRows(value));
    return table ? { label, table } : { label, value: "—" };
  }
  if (field.dataType === "file") {
    const files = (Array.isArray(value) ? (value as RequestAttachment[]) : []).filter((f) => f?.name);
    return files.length ? { label, lines: files.map((f) => f.name) } : { label, value: "Chưa có tệp nào" };
  }
  if (field.dataType === "user_select") {
    return { label, value: (value as TaggedUser | null)?.name || "—" };
  }
  const text = formatFieldValue(value, field.dataType);
  const numericType = numericTypeForFieldDataType(field.dataType);
  const raw = String(value ?? "").trim();
  if (numericType && raw !== "" && Number.isFinite(Number(raw))) {
    const num = Number(raw);
    return { label, value: text, num, numFmt: excelNumFmt(numericType, num) };
  }
  return { label, value: text };
}

/** Bỏ ký tự điều khiển (trừ tab/xuống dòng) — dán từ Word/PowerPoint có thể lọt U+000B,
 * U+0001… làm file Word hỏng cấu trúc, Word báo lỗi không mở được (QA 05/10/2026). */
export function stripControlChars(text: string): string {
  // U+000B (ngắt dòng mềm của Word) / U+000C (ngắt trang) → xuống dòng, không làm dính chữ.
  return text.replace(/[\u000B\u000C]/g, "\n").replace(/[\u0000-\u0008\u000E-\u001F\u007F\uFFFE\uFFFF]/g, "");
}

/** Làm sạch MỌI chuỗi trong model trước khi ghi file. */
function sanitizeModel<T>(value: T): T {
  if (typeof value === "string") return stripControlChars(value) as T;
  if (Array.isArray(value)) return value.map(sanitizeModel) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeModel(v)])) as T;
  }
  return value;
}

export function buildRequestFormModel(input: RequestFormInput): RequestFormModel {
  const { request, history, attachments, approvalTimeFields, brand } = input;
  const now = input.now ?? Date.now();
  const code = request.code ?? request.id;

  const week = getIsoWeekInfo(request.submittedAt);
  const info: FormInfoItem[] = [
    { label: "Người tạo", value: request.submittedBy.name },
    { label: "Nhóm đề xuất", value: request.groupNameSnapshot, accent: true },
    { label: "Thời gian tạo", value: `${vnDateTime(request.submittedAt)} (Tuần ${week.week} - ${week.isOdd ? "lẻ" : "chẵn"})` },
    { label: "Cập nhật gần nhất", value: vnDateTime(request.updatedAt ?? request.submittedAt) },
  ];
  if (request.deadlineAt) {
    info.push(
      { label: "Thời hạn của đề xuất", value: vnDateTime(request.deadlineAt) },
      { label: "Thời gian còn lại", value: request.status === "pending" ? formatCountdown(request.deadlineAt, now) : "—" },
    );
  }

  const fields = request.fieldsSnapshot
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((field, i) => fieldEntry(field, i, request.values[field.id]));

  const approvalFields: FormField[] = Object.entries(request.approvalTimeValues ?? {}).map(([fieldId, value]) => {
    const atf = approvalTimeFields.find((f) => f.id === fieldId);
    return { label: atf?.field.name ?? "Trường đã xoá", value: formatValue(value) };
  });

  let adjustment: FormAdjustment | null = null;
  if (request.status === "approved") {
    const supplementTables: FormAdjustment["supplementTables"] = [];
    for (const field of request.fieldsSnapshot) {
      if (field.dataType !== "table" && field.dataType !== "base_table") continue;
      const columns = field.tableColumns ?? [];
      if (!columns.length) continue;
      const logged = loggedSupplementRows(field.name, columns.length, deserializeTableRows(request.values[field.id]), history);
      if (!logged.length) continue;
      const table = buildFormTable(
        // Bảng cũ hiện mọi cột dạng chữ như trên web (không dòng tổng).
        { tableColumns: columns, tableColumnTypes: columns.map(() => "text"), tableColumnSum: columns.map(() => false) },
        logged.map((l) => l.row.map((cell) => cell || "—")),
        (r) => `Cập nhật lúc ${vnDateTime(logged[r].at)}`,
      );
      if (table) supplementTables.push({ title: `${field.name} — đã bổ sung trước đây`, table });
    }

    const pa = request.pendingAdjustment;
    const pending: FormAdjustmentEntry | null = pa
      ? {
          note: `${pa.requestedByName} đề nghị điều chỉnh: ${pa.noiDung || "(chỉ đính tệp)"}`,
          meta: `Đang chờ duyệt · ${pa.approvers.map((a) => `${a.name} ${a.approvedAt ? "đã duyệt" : "chưa duyệt"}`).join(" · ")}`,
          file: pa.attachment?.name,
        }
      : null;

    const entries = history
      .filter((h) => h.action.startsWith(ADJUSTMENT_HISTORY_PREFIX))
      .map((h, i) => ({ note: h.note ?? "", meta: `${h.actor} · ${vnDateTime(h.at)} · lần ${i + 1}`, file: h.attachmentName }));

    // Nhãn "Đính sau duyệt · lần N" cho K tệp CUỐI — cùng luật với trang chi tiết.
    const supplementEntries = history.filter((h) => h.action.startsWith(ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX));
    const firstPostApproval = attachments.length - supplementEntries.length;
    // Vị trí tính trên mảng ĐẦY ĐỦ, rồi mới bỏ tệp đã gỡ/đã thay (giữ dấu vết
    // trong dữ liệu, không in ra — "Sửa tệp đính kèm khi duyệt", 06/10/2026).
    const attachmentList = attachments
      .map((att, i) => {
        const entry = i >= firstPostApproval ? supplementEntries[i - firstPostApproval] : null;
        return {
          removed: !!att.removedAt,
          name: att.name,
          meta: entry ? `Đính sau duyệt · lần ${i - firstPostApproval + 1} · ${vnDateTime(entry.at)}` : undefined,
        };
      })
      .filter((a) => !a.removed)
      .map(({ name, meta }) => ({ name, meta }));

    adjustment = { description: ADJUSTMENT_DESCRIPTION, supplementTables, pending, entries, attachments: attachmentList };
  }

  const fileBaseName = printFileBaseName(brand, code);
  return sanitizeModel({
    title: resolveRequestTitle(request),
    code,
    status: STATUS_LABEL[request.status],
    statusColor: STATUS_COLOR[request.status],
    info,
    fields,
    approvalFields,
    adjustment,
    footerLabel: brand.trim() ? fileBaseName : "",
    fileBaseName,
  });
}
