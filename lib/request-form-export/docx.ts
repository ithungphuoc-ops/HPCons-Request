import type * as Docx from "docx";
import type { FormCell, FormField, FormTable, RequestFormModel } from "@/lib/request-form-export/model";

/** Ảnh tiêu đề công văn (logo + tên công ty) đã tải về, kèm kích thước gốc để giữ tỉ lệ. */
export interface FormLogo {
  bytes: Uint8Array;
  base64: string;
  type: "png" | "jpg";
  width: number;
  height: number;
}

const FONT = "Arial";
const GREY = "6B7280";
const BORDER = "D1D5DB";
const HEAD_FILL = "F3F4F6";
const BLUE = "2563EB";
const BLUE_LINE = "3B82F6";
const AMBER = "D97706";

/**
 * Ghi đề xuất ra Word (.docx) theo bố cục bản "In đề xuất" (Sếp duyệt demo 05/10/2026):
 * logo công ty · tiêu đề + mã · trạng thái · khung THÔNG TIN ĐỀ XUẤT (lưới 2 cột) ·
 * khung THÔNG TIN KHÁC (tên trường + giá trị, bảng chi tiết) · THÔNG TIN PHÊ DUYỆT ·
 * ĐIỀU CHỈNH ĐỀ NGHỊ SAU DUYỆT · chân trang "<Tên hiển thị>-<mã> · Trang x / y".
 * `D` = module `docx` (tải lười lúc bấm, không nằm trong bundle trang).
 */
export function buildRequestDocx(D: typeof Docx, model: RequestFormModel, logo: FormLogo | null): Docx.Document {
  const { Document, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, ShadingType, Footer, PageNumber, VerticalAlign, TableLayoutType } = D;
  const PAGE_W = 11906;
  const MARGIN = 850;
  const CONTENT = PAGE_W - MARGIN * 2; // twip
  const INNER = CONTENT - 480; // trong khung (trừ lề 240 mỗi bên)
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
  const line = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
  const boxBorders = { top: line, bottom: line, left: line, right: line, insideHorizontal: none, insideVertical: none };

  type RunOpts = { size?: number; bold?: boolean; italic?: boolean; color?: string };
  const t = (text: string, o: RunOpts = {}) =>
    new TextRun({ text, font: FONT, size: Math.round((o.size ?? 10.5) * 2), bold: o.bold, italics: o.italic, color: o.color });
  /** Chuỗi nhiều dòng ("\n") → các run nối bằng ngắt dòng. */
  const multi = (text: string, o: RunOpts = {}) =>
    text.split("\n").map((part, i) => new TextRun({ text: part, break: i > 0 ? 1 : undefined, font: FONT, size: Math.round((o.size ?? 10.5) * 2), bold: o.bold, italics: o.italic, color: o.color }));
  type ParaOpts = { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; before?: number; after?: number; keepNext?: boolean; indent?: number; shading?: Docx.IShadingAttributesProperties; border?: Docx.IBordersOptions };
  /** Đoạn văn; "" = đoạn trống (khoảng cách). */
  const p = (runs: Docx.ParagraphChild | Docx.ParagraphChild[] | "", o: ParaOpts = {}) =>
    new Paragraph({
      children: runs === "" ? [] : Array.isArray(runs) ? runs : [runs],
      alignment: o.align,
      spacing: { before: o.before ?? 0, after: o.after ?? 80 },
      keepNext: o.keepNext,
      indent: o.indent ? { left: o.indent } : undefined,
      shading: o.shading,
      border: o.border,
    });
  // KHÔNG dùng keepNext bên trong khung (bảng 1 ô): Word dồn cả khung sang trang sau,
  // trang 1 trống ~70% (QA 05/10/2026).
  const sectionTitle = (text: string) => p(t(text.toUpperCase(), { bold: true, size: 11 }), { before: 60, after: 120 });
  const box = (children: (Docx.Paragraph | Docx.Table)[]) =>
    new Table({
      width: { size: CONTENT, type: WidthType.DXA },
      columnWidths: [CONTENT],
      borders: boxBorders,
      rows: [new TableRow({ children: [new TableCell({ children, margins: { top: 160, bottom: 120, left: 240, right: 240 } })] })],
    });

  const dataTable = (table: FormTable, width: number) => {
    const weights = table.columns.map((c, i) => {
      if (i === 0) return 3;
      const longest = Math.max(c.length, ...table.rows.map((r) => Math.max(...r[i].text.split("\n").map((s) => s.length))));
      return Math.max(5, Math.min(longest, 34));
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => Math.round((width * w) / sum));
    const cellBorders = { top: line, bottom: line, left: line, right: line };
    const alignOf = (c: FormCell) => (c.align === "right" ? AlignmentType.RIGHT : c.align === "center" ? AlignmentType.CENTER : AlignmentType.LEFT);
    const cell = (c: FormCell, i: number, head: boolean, fill?: string) =>
      new TableCell({
        width: { size: widths[i], type: WidthType.DXA },
        borders: cellBorders,
        shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
        margins: { top: 50, bottom: 50, left: 80, right: 80 },
        verticalAlign: VerticalAlign.CENTER,
        children: [p(multi(c.text, { size: 9.5, bold: head || c.bold }), { after: 0, align: head ? AlignmentType.LEFT : alignOf(c) })],
      });
    const rows = [
      new TableRow({ tableHeader: true, children: table.columns.map((name, i) => cell({ text: name }, i, true, HEAD_FILL)) }),
      ...table.rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, i, false)) })),
    ];
    if (table.sumRow) rows.push(new TableRow({ cantSplit: true, children: table.sumRow.map((c, i) => cell(c, i, false, "F9FAFB")) }));
    return new Table({ width: { size: width, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, rows });
  };

  const fieldBlocks = (fields: FormField[]) => {
    const out: (Docx.Paragraph | Docx.Table)[] = [];
    for (const f of fields) {
      // Chỉ tên trường — KHÔNG kèm kiểu dữ liệu ("Văn bản ngắn", "Ngày"…), Sếp chốt 05/10/2026.
      out.push(p(t(f.label, { size: 10.5, bold: true }), { after: 30 }));
      if (f.table) {
        out.push(dataTable(f.table, INNER));
        out.push(p("", { after: 120 }));
      } else if (f.lines) {
        f.lines.forEach((l, i) => out.push(p(t("📎 " + l, { size: 10, color: BLUE }), { after: i === f.lines!.length - 1 ? 160 : 40 })));
      } else {
        out.push(p(multi(f.value ?? "—", { size: 10.5 }), { after: 160, indent: 160 }));
      }
    }
    return out;
  };

  const children: (Docx.Paragraph | Docx.Table)[] = [];
  if (logo) {
    const w = CONTENT / 15; // twip → px
    const h = Math.round((w * logo.height) / logo.width);
    children.push(p(new ImageRun({ type: logo.type, data: logo.bytes, transformation: { width: w, height: h } }), { after: 200 }));
  }
  children.push(
    new Table({
      width: { size: CONTENT, type: WidthType.DXA },
      columnWidths: [CONTENT - 2600, 2600],
      borders: noBorders,
      rows: [
        new TableRow({
          children: [
            new TableCell({ children: [p(t(model.title, { bold: true, size: 16 }), { after: 40 })], verticalAlign: VerticalAlign.CENTER }),
            new TableCell({
              children: [p([t("Mã: ", { color: GREY, size: 9.5 }), t(model.code, { bold: true, size: 10.5 })], { align: AlignmentType.RIGHT, after: 40 })],
              verticalAlign: VerticalAlign.CENTER,
            }),
          ],
        }),
      ],
    }),
    p(t(model.status, { color: model.statusColor, size: 10 }), { after: 200 }),
  );

  // THÔNG TIN ĐỀ XUẤT — lưới 2 cột như bản in
  const half = INNER / 2;
  const infoCell = (it: RequestFormModel["info"][number] | undefined) =>
    new TableCell({
      width: { size: half, type: WidthType.DXA },
      children: it
        ? [p(t(it.label, { color: GREY, size: 9.5 }), { after: 20 }), p(t(it.value, { size: 10.5, color: it.accent ? "1D4ED8" : undefined }), { after: 120 })]
        : [p("")],
    });
  const infoRows: Docx.TableRow[] = [];
  for (let i = 0; i < model.info.length; i += 2) infoRows.push(new TableRow({ children: [infoCell(model.info[i]), infoCell(model.info[i + 1])] }));
  children.push(
    box([sectionTitle("Thông tin đề xuất"), new Table({ width: { size: INNER, type: WidthType.DXA }, columnWidths: [half, half], borders: noBorders, rows: infoRows })]),
    p("", { after: 160 }),
  );

  if (model.fields.length) {
    children.push(box([sectionTitle("Thông tin khác (mẫu đăng ký đề xuất)"), ...fieldBlocks(model.fields)]), p("", { after: 160 }));
  }
  if (model.approvalFields.length) {
    children.push(box([sectionTitle("Thông tin phê duyệt"), ...fieldBlocks(model.approvalFields)]), p("", { after: 160 }));
  }

  const adj = model.adjustment;
  if (adj) {
    const out: (Docx.Paragraph | Docx.Table)[] = [
      sectionTitle("Điều chỉnh đề nghị sau duyệt"),
      p(t(adj.description, { size: 10, color: "374151" }), {
        after: 160,
        indent: 160,
        shading: { type: ShadingType.CLEAR, color: "auto", fill: "F8FAFC" },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: BLUE_LINE, space: 6 } },
      }),
    ];
    for (const s of adj.supplementTables) {
      out.push(p(t(s.title, { size: 9.5, bold: true, color: "4B5563" }), { after: 40 }), dataTable(s.table, INNER), p("", { after: 120 }));
    }
    const entry = (e: { note: string; meta: string; file?: string }, metaColor: string) => {
      out.push(p(multi(e.note || "—", { size: 10.5 }), { after: 20 }));
      out.push(p(t(e.meta, { size: 9, color: metaColor }), { after: e.file ? 20 : 120 }));
      if (e.file) out.push(p(t("📎 " + e.file, { size: 9, color: BLUE }), { after: 120 }));
    };
    if (adj.pending) entry(adj.pending, AMBER);
    adj.entries.forEach((e) => entry(e, AMBER));
    out.push(p(t("Tài liệu đính kèm", { size: 9.5, color: "4B5563", bold: true }), { before: 80, after: 40 }));
    if (adj.attachments.length) {
      for (const a of adj.attachments) {
        out.push(p(t("📎 " + a.name, { size: 10, color: BLUE }), { after: a.meta ? 0 : 40 }));
        if (a.meta) out.push(p(t(a.meta, { size: 8.5, color: AMBER }), { after: 40, indent: 280 }));
      }
    } else {
      out.push(p(t("Chưa có tài liệu nào.", { size: 10, color: "9CA3AF" })));
    }
    children.push(box(out));
  }

  const footerText = model.footerLabel ? `${model.footerLabel}  ·  Trang ` : "Trang ";
  return new Document({
    creator: model.footerLabel || "Request",
    title: model.fileBaseName,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    sections: [
      {
        properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: 700, bottom: 900, left: MARGIN, right: MARGIN, footer: 400 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ font: FONT, size: 16, color: GREY, children: [footerText, PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES] })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
}
