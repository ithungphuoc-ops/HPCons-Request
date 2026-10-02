import type JSZipType from "jszip";
import type * as XLSXType from "xlsx";
import { dibToBmp, type CellAnchorFrac, type CellAnchorPx, type PictureAnchor } from "@/lib/office-preview/excel-geometry";

/**
 * Lấy ẢNH chèn trong tệp Excel (logo, ảnh hiện trường…) kèm neo ô để bản xem nhanh đặt đúng
 * chỗ như Excel (Sếp chốt 02/10/2026). SheetJS bản cộng đồng chỉ đọc dữ liệu ô, không đọc ảnh,
 * nên phải tự đọc:
 *  - .xlsx: gói zip → xl/drawings/drawingN.xml (neo) + xl/media/* (ảnh).
 *  - .xls (BIFF8, Excel 97-2003): kho ảnh chung MSODRAWINGGROUP ở luồng Workbook + MSODRAWING
 *    từng sheet (số thứ tự ảnh `pib` + ClientAnchor). Đã chạy thử với 24 tệp Excel đính kèm thật
 *    (02/10/2026): .xls 15/15 ảnh, .xlsx 97 ảnh, 0 lỗi.
 * Trả BYTES (không tạo URL) để test được ngoài trình duyệt; nơi hiển thị tự tạo object URL.
 * Biểu đồ (chart) và ảnh dạng hình vẽ EMF/WMF trình duyệt không hiện được → `unsupported`.
 */

export type ExcelPicture = PictureAnchor & { bytes: Uint8Array; mime: string };
export type ExcelPictureEntry = ExcelPicture | { unsupported: true };
export interface ExcelPictures {
  /** Theo tên sheet. */
  bySheet: Record<string, ExcelPictureEntry[]>;
  /** Theo thứ tự sheet trong tệp — dự phòng khi tên sheet giải mã lệch. */
  byIndex: ExcelPictureEntry[][];
}

const EMU_PER_PX = 9525;

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
};
const mimeFromPath = (p: string) => IMAGE_MIME[p.split(".").pop()?.toLowerCase() ?? ""] ?? null;

const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export async function readXlsxPictures(data: ArrayBuffer | Uint8Array, JSZip: typeof JSZipType): Promise<ExcelPictures> {
  const zip = await JSZip.loadAsync(data);
  const xml = async (p: string | undefined) => {
    const f = p ? zip.file(p) : null;
    return f ? new DOMParser().parseFromString(await f.async("string"), "application/xml") : null;
  };
  const all = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagNameNS("*", tag));
  const first = (node: Element, tag: string) => node.getElementsByTagNameNS("*", tag)[0] ?? null;
  const child = (node: Element, tag: string) => Array.from(node.children).find((ch) => ch.localName === tag) ?? null;
  const num = (node: Element | null, tag: string) => {
    const n = node ? first(node, tag) : null;
    return n ? Number(n.textContent) || 0 : 0;
  };
  const rid = (el: Element, name: string) => el.getAttributeNS(R_NS, name) || el.getAttribute(`r:${name}`) || "";
  const resolve = (base: string, target: string) => {
    if (target.startsWith("/")) return target.slice(1);
    const parts = base.split("/").slice(0, -1);
    for (const s of target.split("/")) {
      if (s === "..") parts.pop();
      else if (s && s !== ".") parts.push(s);
    }
    return parts.join("/");
  };
  const rels = async (part: string) => {
    const i = part.lastIndexOf("/");
    const doc = await xml(`${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`);
    const map: Record<string, string> = {};
    if (doc) {
      for (const r of all(doc, "Relationship")) {
        const id = r.getAttribute("Id");
        const target = r.getAttribute("Target");
        if (id && target && r.getAttribute("TargetMode") !== "External") map[id] = resolve(part, target);
      }
    }
    return map;
  };

  const result: ExcelPictures = { bySheet: {}, byIndex: [] };
  const workbook = await xml("xl/workbook.xml");
  if (!workbook) return result;
  const workbookRels = await rels("xl/workbook.xml");

  for (const sheet of all(workbook, "sheet")) {
    const list: ExcelPictureEntry[] = [];
    const sheetPath = workbookRels[rid(sheet, "id")];
    const sheetDoc = await xml(sheetPath);
    if (sheetDoc && sheetPath) {
      const sheetRels = await rels(sheetPath);
      for (const drawingRef of all(sheetDoc, "drawing")) {
        const drawingPath = sheetRels[rid(drawingRef, "id")];
        const drawing = await xml(drawingPath);
        if (!drawing || !drawingPath) continue;
        const drawingRels = await rels(drawingPath);
        const anchors = Array.from(drawing.documentElement.children).filter((a) => /Anchor$/.test(a.localName));
        for (const anchor of anchors) {
          // Ảnh trong nhóm hình: lấy ảnh đầu, dùng neo của cả nhóm.
          const pic = first(anchor, "pic");
          const blip = pic ? first(pic, "blip") : null;
          if (!blip) continue; // biểu đồ / hình vẽ — không phải ảnh
          const mediaPath = drawingRels[rid(blip, "embed")];
          const file = mediaPath ? zip.file(mediaPath) : null;
          if (!file || !mediaPath) continue;
          const mime = mimeFromPath(mediaPath);
          if (!mime) {
            list.push({ unsupported: true });
            continue;
          }
          const cell = (n: Element | null): CellAnchorPx | null =>
            n ? { c: num(n, "col"), r: num(n, "row"), ox: num(n, "colOff") / EMU_PER_PX, oy: num(n, "rowOff") / EMU_PER_PX } : null;
          const extEl = child(anchor, "ext");
          const posEl = child(anchor, "pos");
          list.push({
            bytes: await file.async("uint8array"),
            mime,
            from: cell(child(anchor, "from")),
            to: cell(child(anchor, "to")),
            ext: extEl ? { w: Number(extEl.getAttribute("cx")) / EMU_PER_PX, h: Number(extEl.getAttribute("cy")) / EMU_PER_PX } : null,
            pos: posEl ? { x: Number(posEl.getAttribute("x")) / EMU_PER_PX, y: Number(posEl.getAttribute("y")) / EMU_PER_PX } : null,
          });
        }
      }
    }
    const name = sheet.getAttribute("name");
    if (name) result.bySheet[name] = list;
    result.byIndex.push(list);
  }
  return result;
}

interface ArtRecord {
  ver: number;
  inst: number;
  type: number;
  b: number;
  e: number;
  children?: ArtRecord[];
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
};

/** Đọc cây bản ghi OfficeArt (định dạng hình vẽ chung của Office) trong khoảng [start, end). */
function artRecords(buf: Uint8Array, start: number, end: number, depth = 0): ArtRecord[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const list: ArtRecord[] = [];
  for (let p = start; p + 8 <= end; ) {
    const verInst = v.getUint16(p, true);
    const len = v.getUint32(p + 4, true);
    const rec: ArtRecord = { ver: verInst & 0xf, inst: verInst >> 4, type: v.getUint16(p + 2, true), b: p + 8, e: Math.min(p + 8 + len, end) };
    if (rec.ver === 0xf && depth < 32) rec.children = artRecords(buf, rec.b, rec.e, depth + 1);
    list.push(rec);
    p = p + 8 + len;
  }
  return list;
}

const findAll = (list: ArtRecord[], type: number, acc: ArtRecord[] = []): ArtRecord[] => {
  for (const r of list) {
    if (r.type === type) acc.push(r);
    if (r.children) findAll(r.children, type, acc);
  }
  return acc;
};

const BOF = 0x0809;
const EOF = 0x000a;
const BOUNDSHEET = 0x0085;
const MSODRAWINGGROUP = 0x00eb;
const MSODRAWING = 0x00ec;
const CONTINUE = 0x003c;

type Blip = { bytes: Uint8Array; mime: string } | { unsupported: true } | null;

export function readXlsPictures(data: Uint8Array, XLSX: typeof XLSXType): ExcelPictures {
  const result: ExcelPictures = { bySheet: {}, byIndex: [] };
  const cfb = XLSX.CFB.read(data, { type: "array" });
  const entry = XLSX.CFB.find(cfb, "Workbook") ?? XLSX.CFB.find(cfb, "Book");
  if (!entry?.content) return result;
  const d = entry.content instanceof Uint8Array ? entry.content : Uint8Array.from(entry.content as ArrayLike<number>);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);

  // 1. Chia luồng thành các phần (BOF…EOF): phần đầu là sổ (kho ảnh chung), sau đó từng sheet.
  //    Biểu đồ nhúng trong sheet có BOF…EOF riêng LỒNG bên trong sheet — dùng ngăn xếp để bản
  //    ghi sau biểu đồ vẫn thuộc đúng sheet, và bỏ qua phần lồng.
  type Stream = { pos: number; parts: Uint8Array[]; nested: boolean };
  const streams: Stream[] = [];
  const stack: Stream[] = [];
  const sheets: { pos: number; name: string }[] = [];
  let lastType = 0;
  for (let p = 0; p + 4 <= d.length; ) {
    const type = dv.getUint16(p, true);
    const len = dv.getUint16(p + 2, true);
    const s = p + 4;
    if (s + len > d.length) break;
    const current = stack[stack.length - 1];
    if (type === BOF) {
      const stream: Stream = { pos: p, parts: [], nested: stack.length > 0 };
      stack.push(stream);
      if (!stream.nested) streams.push(stream);
    } else if (type === EOF) {
      stack.pop();
    } else if (current) {
      if (type === BOUNDSHEET && streams.length === 1 && len >= 8) {
        const cch = d[s + 6];
        const highByte = d[s + 7] & 1;
        const nameStart = s + 8;
        const name = highByte
          ? new TextDecoder("utf-16le").decode(d.subarray(nameStart, nameStart + cch * 2))
          : new TextDecoder("windows-1252").decode(d.subarray(nameStart, nameStart + cch));
        sheets.push({ pos: dv.getUint32(s, true), name });
      }
      if (type === MSODRAWINGGROUP || type === MSODRAWING || (type === CONTINUE && (lastType === MSODRAWINGGROUP || lastType === MSODRAWING))) {
        current.parts.push(d.subarray(s, s + len));
      }
    }
    if (type !== CONTINUE) lastType = type;
    p = s + len;
  }
  if (!streams.length) return result;

  // 2. Kho ảnh chung: mỗi FBSE (0xF007) chứa 1 ảnh, số thứ tự ảnh (pib) tính từ 1.
  const blips: Blip[] = [];
  const group = concat(streams[0].parts);
  const gv = new DataView(group.buffer);
  for (const fbse of findAll(artRecords(group, 0, group.length), 0xf007)) {
    const nameLength = group[fbse.b + 33];
    const blipStart = fbse.b + 36 + nameLength;
    if (blipStart + 8 > fbse.e) {
      blips.push(null);
      continue;
    }
    const blipInst = gv.getUint16(blipStart, true) >> 4;
    const blipType = gv.getUint16(blipStart + 2, true);
    const blipLen = gv.getUint32(blipStart + 4, true);
    const body = group.subarray(blipStart + 8, Math.min(blipStart + 8 + blipLen, group.length));
    const skip = 16 + (blipInst & 1 ? 16 : 0) + 1; // mã ảnh (1–2 × 16 byte) + 1 byte đánh dấu
    if (blipType === 0xf01d) blips.push({ bytes: body.subarray(skip), mime: "image/jpeg" });
    else if (blipType === 0xf01e) blips.push({ bytes: body.subarray(skip), mime: "image/png" });
    else if (blipType === 0xf01f) {
      const bmp = dibToBmp(body.subarray(skip));
      blips.push(bmp ? { bytes: bmp, mime: "image/bmp" } : { unsupported: true });
    } else blips.push({ unsupported: true }); // EMF/WMF/PICT/TIFF
  }

  // 3. Từng sheet: hình (SpContainer 0xF004) có số ảnh (thuộc tính 0x0104) + neo ô (0xF010).
  for (const stream of streams.slice(1)) {
    const list: ExcelPictureEntry[] = [];
    if (stream.parts.length) {
      const buf = concat(stream.parts);
      const v = new DataView(buf.buffer);
      for (const shape of findAll(artRecords(buf, 0, buf.length), 0xf004)) {
        let pib = 0;
        let from: CellAnchorFrac | null = null;
        let to: CellAnchorFrac | null = null;
        for (const ch of shape.children ?? []) {
          if (ch.type === 0xf00b) {
            for (let k = 0; k < ch.inst && ch.b + 6 * k + 6 <= ch.e; k++) {
              if ((v.getUint16(ch.b + 6 * k, true) & 0x3fff) === 0x0104) pib = v.getUint32(ch.b + 6 * k + 2, true);
            }
          }
          if (ch.type === 0xf010 && ch.e - ch.b >= 18) {
            const u = (o: number) => v.getUint16(ch.b + o, true);
            from = { c: u(2), fx: Math.min(u(4), 1023) / 1024, r: u(6), fy: Math.min(u(8), 255) / 256 };
            to = { c: u(10), fx: Math.min(u(12), 1023) / 1024, r: u(14), fy: Math.min(u(16), 255) / 256 };
          }
        }
        const blip = pib ? blips[pib - 1] : null;
        if (!blip || !from || !to) continue;
        if ("unsupported" in blip) list.push({ unsupported: true });
        else list.push({ bytes: blip.bytes, mime: blip.mime, from, to });
      }
    }
    const sheet = sheets.find((s) => s.pos === stream.pos);
    if (sheet) result.bySheet[sheet.name] = list;
    result.byIndex.push(list);
  }
  return result;
}
