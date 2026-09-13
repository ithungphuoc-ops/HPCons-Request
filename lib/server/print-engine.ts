// Không "server-only": file này không đụng credential/Firestore, chỉ xử lý
// buffer .docx thuần (docxtemplater/pizzip) — để trống marker cho phép test
// bằng vitest (import "server-only" chỉ resolve được qua webpack của Next).
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { buildPrintTemplateData, isKnownSystemKey } from "@/lib/print-template";
import {
  deserializeTableRows,
  formatCellForDisplay,
  resolveTableColumnTypes,
} from "@/lib/table-field";
import type { ProposalGroup, RequestInstance } from "@/lib/types";

const TAG_REGEX = /\$\{([^}]*)\}/g;

/**
 * Word thường tự tách 1 đoạn văn bản liên tục thành nhiều <w:r> (run) khác
 * nhau — do gõ ngắt quãng, tự động lưu, kiểm tra chính tả, hoặc đơn giản là
 * mỗi run có <w:rPr> (định dạng) hơi khác nhau — khiến 1 thẻ ${...} bị chia
 * làm 2-3+ mảnh XML, không còn là 1 chuỗi liền mạch để regex tìm thấy. Thay
 * vì đoán 1 kiểu tách cố định, quét TRỰC TIẾP từng <w:r>, phát hiện run nào
 * có <w:t> chứa "${" chưa đóng "}", rồi gộp dần các run NGAY SAU đó (bất kể
 * <w:rPr> của chúng khác nhau thế nào) cho tới khi gặp "}" — chỉ gộp ĐÚNG
 * khoảng run chứa thẻ bị chia, giữ nguyên mọi run khác trong tài liệu (không
 * ảnh hưởng định dạng phần văn bản còn lại).
 */
const RUN_REGEX = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
const RUN_TEXT_REGEX = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/;

function hasUnclosedTag(text: string): boolean {
  const lastOpen = text.lastIndexOf("${");
  if (lastOpen === -1) return false;
  return !text.slice(lastOpen).includes("}");
}

function normalizeRuns(xml: string): string {
  const runs: { start: number; end: number; raw: string; text: string | null }[] = [];
  let m: RegExpExecArray | null;
  const runRe = new RegExp(RUN_REGEX);
  while ((m = runRe.exec(xml))) {
    const tMatch = RUN_TEXT_REGEX.exec(m[0]);
    runs.push({ start: m.index, end: m.index + m[0].length, raw: m[0], text: tMatch ? tMatch[2] : null });
  }

  const replacements: { start: number; end: number; xml: string }[] = [];
  let i = 0;
  while (i < runs.length) {
    const run = runs[i];
    if (run.text !== null && hasUnclosedTag(run.text)) {
      let combined = run.text;
      let closedAt = -1;
      let j = i + 1;
      while (j < runs.length && runs[j].text !== null) {
        combined += runs[j].text;
        if (!hasUnclosedTag(combined)) {
          closedAt = j;
          break;
        }
        j += 1;
      }
      if (closedAt !== -1) {
        const merged = run.raw.replace(RUN_TEXT_REGEX, (_all, open: string, _mid: string, close: string) =>
          `${open}${combined}${close}`,
        );
        replacements.push({ start: run.start, end: runs[closedAt].end, xml: merged });
        i = closedAt + 1;
        continue;
      }
    }
    i += 1;
  }

  let result = xml;
  for (let k = replacements.length - 1; k >= 0; k -= 1) {
    const r = replacements[k];
    result = result.slice(0, r.start) + r.xml + result.slice(r.end);
  }
  return result;
}

function stripXmlTags(xml: string): string {
  return xml.replace(/<[^>]+>/g, "");
}

function findTagNames(text: string): string[] {
  const names: string[] = [];
  const re = new RegExp(TAG_REGEX);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    names.push(m[1]);
  }
  return names;
}

type TagClassification =
  | { kind: "valid" }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

/** Phân loại 1 tên biến đã phát hiện trong mẫu, đối chiếu với thẻ hệ thống + mã trường/mã bảng của nhóm. */
function classifyTag(tagName: string, group: ProposalGroup): TagClassification {
  const trimmed = tagName.trim();
  if (trimmed === "" || trimmed !== tagName) {
    return {
      kind: "error",
      message: `Thẻ "\${${tagName}}" viết sai cú pháp (rỗng hoặc có khoảng trắng thừa ở đầu/cuối).`,
    };
  }
  if (isKnownSystemKey(trimmed)) return { kind: "valid" };

  const columnMatch = /^column\.([^.]+)\.(\d+)$/.exec(trimmed);
  if (columnMatch) {
    const [, code, idxStr] = columnMatch;
    const idx = Number(idxStr);
    const field = group.fields.find(
      (f) => f.code === code && (f.dataType === "table" || f.dataType === "base_table"),
    );
    if (!field) {
      return {
        kind: "error",
        message: `Mã bảng "${code}" trong thẻ "\${${trimmed}}" không tồn tại trong nhóm này.`,
      };
    }
    const maxIdx = (field.tableColumns ?? []).length;
    if (idx > maxIdx) {
      return {
        kind: "error",
        message: `Thẻ "\${${trimmed}}" tham chiếu cột số ${idx}, nhưng bảng "${field.name}" chỉ có ${maxIdx} cột.`,
      };
    }
    return { kind: "valid" };
  }

  if (group.fields.some((f) => f.code === trimmed)) return { kind: "valid" };

  return {
    kind: "warning",
    message: `Biến "\${${trimmed}}" không khớp thẻ hệ thống, mã trường hay mã bảng nào trong nhóm này — khi in sẽ để trống.`,
  };
}

/**
 * Tìm khoảng [bắt đầu, kết thúc) của mọi khối <tagName>...</tagName> trong
 * chuỗi XML — có đếm độ sâu nên chịu được lồng nhau (vd bảng trong bảng);
 * dùng chung cho cả <w:tbl> (kiểm tra chứa) và <w:tr> (tìm dòng cần nhân bản).
 */
function findTagRanges(xml: string, tagName: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const stack: number[] = [];
  const tagRe = new RegExp(`<\\/?${tagName}(?:[ >])`, "g");
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml))) {
    const isClose = xml[m.index + 1] === "/";
    if (!isClose) {
      stack.push(m.index);
    } else {
      const start = stack.pop();
      const closeEnd = xml.indexOf(">", m.index) + 1;
      if (start !== undefined && closeEnd > 0) ranges.push([start, closeEnd]);
    }
  }
  return ranges;
}

function findTblRanges(xml: string): Array<[number, number]> {
  return findTagRanges(xml, "w:tbl");
}

function isInsideAnyRange(offset: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([s, e]) => offset >= s && offset < e);
}

/** Cảnh báo các thẻ ${column...} nằm NGOÀI mọi bảng trong word/document.xml — nhân dòng sẽ không có tác dụng. */
function checkColumnTagsInsideTables(documentXml: string): string[] {
  const warnings: string[] = [];
  const tblRanges = findTblRanges(documentXml);
  const re = /\$\{(column\.[^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(documentXml))) {
    if (!isInsideAnyRange(m.index, tblRanges)) {
      warnings.push(
        `Biến "\${${m[1]}}" nằm NGOÀI bảng trong file Word — cần đặt thẻ này vào trong 1 ô của bảng thì mới nhân dòng đúng.`,
      );
    }
  }
  return warnings;
}

/** Mở docx, gộp run bị tách (normalizeRuns) trên document + header/footer, trả lại buffer đã "vá" sẵn sàng quét/render. */
function normalizeDocxBuffer(buffer: Buffer): Buffer {
  const zip = new PizZip(buffer);
  const parts = zip.file(/word\/(document|header\d*|footer\d*)\.xml$/) ?? [];
  for (const part of parts) {
    zip.file(part.name, normalizeRuns(part.asText()));
  }
  return zip.generate({ type: "nodebuffer" });
}

/**
 * Thử biên dịch mẫu bằng chính docxtemplater (nullGetter cho phép thiếu dữ
 * liệu) — đây là nguồn xác thực nhất để phát hiện cú pháp thẻ ${...} bị hỏng
 * thật sự (sau khi đã gộp run ở normalizeDocxBuffer).
 */
function detectTemplateCompileErrors(buffer: Buffer): string[] {
  try {
    const zip = new PizZip(buffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: "${", end: "}" },
      nullGetter: () => "",
    });
    doc.render({});
    return [];
  } catch (err) {
    const anyErr = err as {
      properties?: {
        errors?: Array<{ properties?: { explanation?: string; xtag?: string; id?: string } }>;
      };
    };
    const details = anyErr.properties?.errors;
    if (details && details.length > 0) {
      return details.map((e) => {
        const tag = e.properties?.xtag ? ` (gần thẻ "\${${e.properties.xtag}}")` : "";
        return `Mẫu có lỗi cú pháp thẻ${tag}: ${e.properties?.explanation ?? e.properties?.id ?? "không rõ nguyên nhân"}. Có thể do thẻ bị chỉnh sửa cách quãng (theo dõi thay đổi, đánh dấu...) — gõ lại liền mạch trong 1 lần, tắt "Theo dõi thay đổi" trước khi gõ thẻ.`;
      });
    }
    return [
      `Không đọc được cấu trúc file mẫu: ${err instanceof Error ? err.message : String(err)}.`,
    ];
  }
}

export interface ScanResult {
  detectedVariables: string[];
  errors: string[];
  warnings: string[];
}

/** Quét toàn bộ biến ${...} trong file .docx (document + header/footer), đối chiếu hệ thống thẻ + mã trường/mã bảng của nhóm. */
export function scanTemplateVariables(buffer: Buffer, group: ProposalGroup): ScanResult {
  let normalizedBuffer: Buffer;
  let zip: PizZip;
  try {
    normalizedBuffer = normalizeDocxBuffer(buffer);
    zip = new PizZip(normalizedBuffer);
  } catch {
    return {
      detectedVariables: [],
      errors: ["Không đọc được file — có thể file bị hỏng hoặc không phải định dạng .docx hợp lệ."],
      warnings: [],
    };
  }

  const parts = zip.file(/word\/(document|header\d*|footer\d*)\.xml$/) ?? [];
  if (parts.length === 0) {
    return {
      detectedVariables: [],
      errors: ["File không có word/document.xml — không phải file .docx hợp lệ."],
      warnings: [],
    };
  }

  const detected = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const part of parts) {
    const xml = part.asText();
    const flattened = stripXmlTags(xml);
    for (const tag of findTagNames(flattened)) {
      const trimmed = tag.trim();
      if (detected.has(trimmed)) continue;
      detected.add(trimmed);
      const classification = classifyTag(trimmed, group);
      if (classification.kind === "error") errors.push(classification.message);
      else if (classification.kind === "warning") warnings.push(classification.message);
    }

    if (/document\.xml$/.test(part.name)) {
      warnings.push(...checkColumnTagsInsideTables(xml));
    }
  }

  errors.push(...detectTemplateCompileErrors(normalizedBuffer));

  return { detectedVariables: Array.from(detected), errors, warnings };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Nhân dòng bảng THẬT trong XML — với mỗi field kiểu Bảng có thẻ
 * ${column.<code>.<n>} xuất hiện trong 1 dòng <w:tr>, nhân dòng đó đúng bằng
 * số bản ghi thật (tối thiểu 1, bảng rỗng vẫn giữ 1 dòng trống), cột 0 = STT
 * tự chạy 1..N, cột k≥1 = ô thứ (k-1) của dòng đó. Nhân bản NGUYÊN VẸN cùng
 * 1 khối XML gốc nên viền/độ rộng cột/font/màu nền giữ nguyên tuyệt đối.
 */
export function duplicateTableRows(
  documentXml: string,
  group: ProposalGroup,
  request: RequestInstance,
): string {
  let result = normalizeRuns(documentXml);
  const tableFields = group.fields.filter(
    (f) => f.code && (f.dataType === "table" || f.dataType === "base_table"),
  );

  for (const field of tableFields) {
    const code = field.code as string;
    const marker = `\${column.${code}.`;
    const trRanges = findTagRanges(result, "w:tr");
    const templateRange = trRanges.find(([s, e]) => result.slice(s, e).includes(marker));
    if (!templateRange) continue;

    const [start, end] = templateRange;
    const templateRow = result.slice(start, end);

    const rawRows = deserializeTableRows(request.values[field.id]);
    const rows = rawRows.length > 0 ? rawRows : [[]];

    // Ô lưu SỐ THÔ, in ra giấy thì phải là bản đã chấm phẩy + đuôi VNĐ, đúng
    // như người dùng thấy trên màn hình (Sếp chốt 13/09/2026).
    const columnTypes = resolveTableColumnTypes(field.tableColumns ?? [], field.tableColumnTypes);
    const columnTagRe = /\$\{column\.([^.]+)\.(\d+)\}/g;
    const renderedRows = rows.map((row, rowIndex) =>
      templateRow.replace(columnTagRe, (full: string, tagCode: string, idxStr: string) => {
        if (tagCode !== code) return full; // thẻ của field Bảng khác — xử lý ở vòng lặp của field đó
        const idx = Number(idxStr);
        if (idx === 0) return String(rowIndex + 1);
        const cellType = columnTypes[idx - 1] ?? "text";
        return escapeXml(formatCellForDisplay(row[idx - 1] ?? "", cellType));
      }),
    );

    result = result.slice(0, start) + renderedRows.join("") + result.slice(end);
  }

  return result;
}

/**
 * Điền dữ liệu THẬT của 1 đề xuất vào mẫu .docx — nhân dòng bảng trước (thao
 * tác trực tiếp trên XML), sau đó chạy 1 lượt docxtemplater bình thường cho
 * mọi thẻ phẳng còn lại (hệ thống + mã trường tuỳ chỉnh).
 */
export function renderPrintTemplate(
  templateBuffer: Buffer,
  group: ProposalGroup,
  request: RequestInstance,
): Buffer {
  // Gộp run bị Word tách trước tiên (document + header/footer) — nếu không,
  // thẻ bị tách vẫn còn nguyên khi tới bước nhân dòng/điền dữ liệu bên dưới.
  const zip = new PizZip(normalizeDocxBuffer(templateBuffer));
  const documentPath = "word/document.xml";
  const documentFile = zip.file(documentPath);
  if (documentFile) {
    const expanded = duplicateTableRows(documentFile.asText(), group, request);
    zip.file(documentPath, expanded);
  }

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "${", end: "}" },
    nullGetter: () => "",
  });
  doc.render(buildPrintTemplateData(request));
  return doc.getZip().generate({ type: "nodebuffer" });
}
