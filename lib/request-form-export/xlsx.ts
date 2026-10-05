import type * as ExcelNS from "exceljs";
import type { FormLogo } from "@/lib/request-form-export/docx";
import type { FormCell, FormField, FormTable, RequestFormModel } from "@/lib/request-form-export/model";

type ExcelJSModule = typeof ExcelNS;

const FONT = "Arial";
const GREY = "6B7280";
const BORDER = "D1D5DB";
const HEAD_FILL = "F3F4F6";
const BLUE = "2563EB";
const BLUE_LINE = "3B82F6";
const AMBER = "D97706";

/** Độ rộng (ký tự Excel) gợi ý cho từng cột của 1 bảng theo nội dung dài nhất. */
function tableWidths(table: FormTable): number[] {
  return table.columns.map((c, i) => {
    if (i === 0) return 5;
    const longest = Math.max(c.length, ...table.rows.map((r) => Math.max(...r[i].text.split("\n").map((s) => s.length))));
    return Math.max(8, Math.min(longest + 3, 36));
  });
}

/**
 * Ghi đề xuất ra Excel (.xlsx) theo bố cục bản "In đề xuất" (Sếp duyệt demo 05/10/2026):
 * 1 sheet, lưới cột = đúng các cột bảng chi tiết, số là SỐ THẬT (tính toán được), dòng
 * Tổng cộng bằng công thức SUM, in vừa 1 khổ A4 dọc theo chiều ngang. Logo NEO 2 GÓC vào
 * mép trái cột A và mép phải cột cuối vùng in → luôn vừa khổ giấy (Sếp báo 05/10/2026:
 * neo kích thước cố định thì logo tràn ra ngoài, in ra mất logo).
 * `ExcelJS` = module `exceljs` (tải lười lúc bấm).
 */
export async function buildRequestXlsx(ExcelJS: ExcelJSModule, model: RequestFormModel, logo: FormLogo | null): Promise<ExcelNS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = model.footerLabel || "Request";
  const sheetName = `Đề nghị ${model.code}`.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
  // `&"Arial,Regular"` NGAY SAU mã cỡ chữ `&8` để chặn chữ số đầu tên dính vào mã cỡ chữ
  // (QA 05/10/2026: "2026 HP Request" thành "&82026" → chữ khổng lồ đè nửa trang in).
  const footerPrefix = `&C&8&"${FONT},Regular"`;
  const footer = model.footerLabel
    ? `${footerPrefix}${model.footerLabel.replace(/&/g, "&&")}  ·  Trang &P / &N`
    : `${footerPrefix}Trang &P / &N`;
  const ws = wb.addWorksheet(sheetName, {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
    },
    headerFooter: { oddFooter: footer },
  });

  // Lưới cột theo bảng có nhiều cột nhất (thường là "Chi tiết"); tối thiểu 7 cột.
  const tables: FormTable[] = [
    ...model.fields.map((f) => f.table).filter((t): t is FormTable => !!t),
    ...(model.adjustment?.supplementTables.map((s) => s.table) ?? []),
  ];
  const widest = tables.reduce<FormTable | null>((a, t) => (!a || t.columns.length > a.columns.length ? t : a), null);
  const N = Math.max(7, widest?.columns.length ?? 0);
  const widths = widest ? tableWidths(widest) : [];
  ws.columns = Array.from({ length: N }, (_, i) => ({ width: widths[i] ?? 14 }));
  const lastCol = N;

  type FontOpts = { size?: number; bold?: boolean; italic?: boolean; color?: string };
  const font = (o: FontOpts = {}): Partial<ExcelNS.Font> => ({
    name: FONT,
    size: o.size ?? 10.5,
    bold: o.bold,
    italic: o.italic,
    color: o.color ? { argb: "FF" + o.color } : undefined,
  });
  const thin: Partial<ExcelNS.Border> = { style: "thin", color: { argb: "FF" + BORDER } };
  const allThin: Partial<ExcelNS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
  const merge = (row: number, c1: number, c2: number) => {
    if (c2 > c1) ws.mergeCells(row, c1, row, c2);
  };
  type PutOpts = FontOpts & { align?: "left" | "center" | "right"; wrap?: boolean; fill?: string; numFmt?: string; indent?: number };
  const put = (row: number, col: number, value: ExcelNS.CellValue, o: PutOpts = {}) => {
    const cell = ws.getCell(row, col);
    cell.value = value;
    cell.font = font(o);
    cell.alignment = { vertical: "middle", horizontal: o.align ?? "left", wrapText: o.wrap ?? false, indent: o.indent };
    if (o.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + o.fill } };
    if (o.numFmt) cell.numFmt = o.numFmt;
    return cell;
  };
  const widthChars = (c1: number, c2: number) => ws.columns.slice(c1 - 1, c2).reduce((a, c) => a + (c.width || 10), 0);
  const estLines = (text: string, chars: number) =>
    text.split("\n").reduce((n, part) => n + Math.max(1, Math.ceil(part.length / Math.max(chars, 10))), 0);
  /** Ô gộp từ cột c1 tới c2, TỰ XUỐNG DÒNG, chiều cao hàng đủ cho số dòng chữ theo cỡ chữ
   * (QA 05/10/2026: tiêu đề cỡ 15, tên nhóm/tên tệp/danh sách người duyệt dài bị cắt chữ).
   * Hàng có nhiều ô → lấy chiều cao lớn nhất. Chữ 1 dòng cỡ thường giữ chiều cao mặc định. */
  const textCell = (row: number, c1: number, c2: number, text: string, o: PutOpts = {}) => {
    const cell = put(row, c1, text, { wrap: true, ...o });
    merge(row, c1, c2);
    const size = o.size ?? 10.5;
    const charsPerLine = ((widthChars(c1, c2) - (o.indent ?? 0) * 2) * 10.5) / size / (o.bold ? 1.15 : 1);
    const lines = estLines(text, charsPerLine);
    if (lines > 1 || size > 11) {
      const need = lines * size * 1.32 + 3;
      const current = ws.getRow(row).height ?? 0;
      if (need > current) ws.getRow(row).height = need;
    }
    return cell;
  };
  const fullRow = (row: number, text: string, o: PutOpts = {}) => textCell(row, 1, lastCol, text, o);

  let r = 1;
  if (logo) {
    const totalPx = ws.columns.reduce((a, c) => a + (c.width || 10) * 7 + 5, 0);
    const heightPx = (totalPx * logo.height) / logo.width;
    const logoRows = Math.max(2, Math.round(heightPx / 20));
    for (let i = 1; i <= logoRows; i++) ws.getRow(i).height = ((heightPx / logoRows) * 3) / 4; // px → pt
    const img = wb.addImage({ base64: logo.base64, extension: logo.type === "png" ? "png" : "jpeg" });
    ws.addImage(img, { tl: { col: 0, row: 0 }, br: { col: lastCol, row: logoRows }, editAs: "twoCell" } as unknown as ExcelNS.ImageRange);
    r = logoRows + 2;
  }

  // Tiêu đề trải hết chiều ngang; dòng dưới: trạng thái bên trái + mã bên phải.
  fullRow(r, model.title, { bold: true, size: 15 });
  r++;
  put(r, 1, model.status, { color: model.statusColor, size: 10 });
  merge(r, 1, lastCol - 2);
  put(r, lastCol - 1, { richText: [{ text: "Mã: ", font: font({ color: GREY, size: 9.5 }) }, { text: model.code, font: font({ bold: true }) }] }, { align: "right" });
  merge(r, lastCol - 1, lastCol);
  r += 2;

  const section = (title: string) => {
    put(r, 1, title.toUpperCase(), { bold: true, size: 11, fill: HEAD_FILL });
    merge(r, 1, lastCol);
    ws.getRow(r).height = 20;
    r++;
  };

  // THÔNG TIN ĐỀ XUẤT: nhãn (gộp đủ rộng cho nhãn dài nhất) + giá trị.
  section("Thông tin đề xuất");
  let labelEnd = 1;
  while (labelEnd < lastCol - 1 && widthChars(1, labelEnd) < 24) labelEnd++;
  for (const it of model.info) {
    textCell(r, 1, labelEnd, it.label, { color: GREY, size: 9.5 });
    textCell(r, labelEnd + 1, lastCol, it.value, { color: it.accent ? "1D4ED8" : undefined });
    r++;
  }
  r++;

  const writeTable = (table: FormTable) => {
    table.columns.forEach((c, i) => {
      put(r, i + 1, c, { bold: true, size: 9.5, fill: HEAD_FILL, wrap: true }).border = allThin;
    });
    ws.getRow(r).height = 20;
    r++;
    const first = r;
    const cellOut = (c: FormCell, i: number, fill?: string) => {
      const cell = put(r, i + 1, c.num ?? c.text, { size: 9.5, wrap: true, align: c.align ?? "left", bold: c.bold, numFmt: c.num !== undefined ? c.numFmt : undefined, fill });
      cell.border = allThin;
    };
    for (const row of table.rows) {
      row.forEach((c, i) => cellOut(c, i));
      const lines = Math.max(...row.map((c, i) => estLines(c.text, (ws.getColumn(i + 1).width ?? 10) - 1)));
      if (lines > 1) ws.getRow(r).height = 13 * lines + 3;
      r++;
    }
    if (table.sumRow) {
      table.sumRow.forEach((c, i) => {
        if (c.num !== undefined) {
          // Công thức SUM để sửa số trong Excel là tự cộng lại; kèm kết quả đã tính sẵn.
          const col = ws.getColumn(i + 1).letter;
          const cell = put(r, i + 1, { formula: `SUM(${col}${first}:${col}${r - 1})`, result: c.num }, { size: 9.5, bold: true, align: "right", numFmt: c.numFmt, fill: "F9FAFB" });
          cell.border = allThin;
        } else {
          cellOut(c, i, "F9FAFB");
        }
      });
      r++;
    }
    r++;
  };

  const writeFields = (fields: FormField[]) => {
    for (const f of fields) {
      fullRow(r, f.label, { bold: true });
      r++;
      if (f.table) writeTable(f.table);
      else if (f.lines) {
        for (const l of f.lines) {
          fullRow(r, "📎 " + l, { size: 10, color: BLUE, indent: 1 });
          r++;
        }
      } else if (f.num !== undefined) {
        // Trường số đứng riêng (Tiền tệ/Số…) → SỐ THẬT trong Excel, canh trái như chữ.
        put(r, 1, f.num, { numFmt: f.numFmt, indent: 1 });
        merge(r, 1, lastCol);
        r++;
      } else {
        fullRow(r, f.value ?? "—", { indent: 1 });
        r++;
      }
    }
    r++;
  };

  if (model.fields.length) {
    section("Thông tin khác (mẫu đăng ký đề xuất)");
    writeFields(model.fields);
  }
  if (model.approvalFields.length) {
    section("Thông tin phê duyệt");
    writeFields(model.approvalFields);
  }

  const adj = model.adjustment;
  if (adj) {
    section("Điều chỉnh đề nghị sau duyệt");
    const d = fullRow(r, adj.description, { size: 10, color: "374151", fill: "F8FAFC", indent: 1 });
    d.border = { left: { style: "thick", color: { argb: "FF" + BLUE_LINE } } };
    ws.getRow(r).height = Math.max(ws.getRow(r).height ?? 0, 20);
    r += 2;
    for (const s of adj.supplementTables) {
      fullRow(r, s.title, { bold: true, size: 9.5, color: "4B5563" });
      r++;
      writeTable(s.table);
    }
    const entry = (e: { note: string; meta: string; file?: string }) => {
      fullRow(r, e.note || "—");
      r++;
      fullRow(r, e.meta, { size: 9, color: AMBER });
      r++;
      if (e.file) {
        fullRow(r, "📎 " + e.file, { size: 9, color: BLUE });
        r++;
      }
      r++;
    };
    if (adj.pending) entry(adj.pending);
    adj.entries.forEach(entry);
    put(r, 1, "Tài liệu đính kèm", { bold: true, size: 9.5, color: "4B5563" });
    merge(r, 1, lastCol);
    r++;
    if (adj.attachments.length) {
      for (const a of adj.attachments) {
        fullRow(r, "📎 " + a.name, { size: 10, color: BLUE });
        r++;
        if (a.meta) {
          fullRow(r, a.meta, { size: 8.5, color: AMBER, indent: 2 });
          r++;
        }
      }
    } else {
      put(r, 1, "Chưa có tài liệu nào.", { size: 10, color: "9CA3AF" });
      merge(r, 1, lastCol);
      r++;
    }
  }

  ws.pageSetup.printArea = `A1:${ws.getColumn(lastCol).letter}${Math.max(r - 1, 1)}`;
  return wb;
}
