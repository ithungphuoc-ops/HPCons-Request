/**
 * Hình học bảng Excel cho bản xem nhanh tệp đính kèm (components/request/office/ExcelPreview.tsx):
 * đổi neo ảnh của Excel (ô + lề) thành vị trí trên bảng đang hiển thị. Hàm thuần, không
 * đụng DOM — để test được. Sếp chốt 02/10/2026: xem nhanh Excel phải hiện cả ảnh chèn
 * trong file (logo, ảnh hiện trường) đúng ô như Excel.
 */

/** Neo ảnh của .xlsx: ô + lề tính bằng px (EMU / 9525). */
export interface CellAnchorPx {
  c: number;
  r: number;
  ox: number;
  oy: number;
}

/** Neo ảnh của .xls (BIFF8): ô + phần lẻ của ô (0..1). */
export interface CellAnchorFrac {
  c: number;
  r: number;
  fx: number;
  fy: number;
}

export interface PictureAnchor {
  from?: CellAnchorPx | CellAnchorFrac | null;
  to?: CellAnchorPx | CellAnchorFrac | null;
  /** Kích thước px gốc — khi ảnh chỉ neo 1 góc (oneCellAnchor/absoluteAnchor). */
  ext?: { w: number; h: number } | null;
  /** Vị trí px tuyệt đối từ góc A1 (absoluteAnchor). */
  pos?: { x: number; y: number } | null;
}

/** Hộp ảnh theo ô + phần lẻ: góc trên-trái `a`, góc dưới-phải `b`. */
export interface AnchorBox {
  a: CellAnchorFrac;
  b: CellAnchorFrac;
}

export interface ExcelGeometry {
  colW: (c: number) => number;
  rowH: (r: number) => number;
}

interface SheetColInfo {
  width?: number;
  wch?: number;
  hidden?: boolean;
}
interface SheetRowInfo {
  hpt?: number;
  hidden?: boolean;
}

/** Tên cột kiểu Excel: 0 → A, 25 → Z, 26 → AA. */
export function colName(c: number): string {
  let s = "";
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Kích thước ô GỐC của Excel (px, 96 DPI, font mặc định Calibri 11 → 1 ký tự = 7px).
 * Cố ý KHÔNG dùng `wpx`/`hpx` của SheetJS: bản này quy đổi theo cỡ ký tự 9px và để
 * hpx = hpt, lệch rõ so với Excel (đo 02/10/2026 trên file tạo bằng Excel thật).
 */
export function excelGeometry(sheet: { "!cols"?: (SheetColInfo | undefined)[]; "!rows"?: (SheetRowInfo | undefined)[] }): ExcelGeometry {
  const cols = sheet["!cols"] ?? [];
  const rows = sheet["!rows"] ?? [];
  return {
    colW: (c) => {
      const x = cols[c];
      if (x?.hidden) return 0;
      if (x?.width) return Math.round(x.width * 7);
      if (x?.wch) return Math.round(x.wch * 7 + 5);
      return 64; // cột mặc định 8.43 ký tự
    },
    rowH: (r) => {
      const x = rows[r];
      if (x?.hidden) return 0;
      if (x?.hpt) return (x.hpt * 4) / 3;
      return 20; // dòng mặc định 15pt
    },
  };
}

/** Đi tiếp `px` điểm ảnh từ đầu ô `start` → ô dừng + phần lẻ trong ô đó. */
export function walkPx(start: number, px: number, sizeOf: (i: number) => number): { i: number; f: number } {
  let i = start;
  let rest = Math.max(0, px);
  for (let guard = 0; guard < 20000 && sizeOf(i) > 0 && rest >= sizeOf(i); guard++) {
    rest -= sizeOf(i);
    i++;
  }
  const s = sizeOf(i);
  return { i, f: s ? Math.min(rest / s, 1) : 0 };
}

const isFrac = (x: CellAnchorPx | CellAnchorFrac): x is CellAnchorFrac => "fx" in x;

/** Đổi neo ảnh (mọi kiểu) thành hộp theo ô + phần lẻ; null nếu thiếu dữ liệu neo. */
export function anchorBox(p: PictureAnchor, g: ExcelGeometry): AnchorBox | null {
  let a: CellAnchorFrac | null = null;
  if (p.from && isFrac(p.from)) a = { ...p.from };
  else if (p.from) {
    const x = walkPx(p.from.c, p.from.ox, g.colW);
    const y = walkPx(p.from.r, p.from.oy, g.rowH);
    a = { c: x.i, fx: x.f, r: y.i, fy: y.f };
  } else if (p.pos) {
    const x = walkPx(0, p.pos.x, g.colW);
    const y = walkPx(0, p.pos.y, g.rowH);
    a = { c: x.i, fx: x.f, r: y.i, fy: y.f };
  }
  if (!a) return null;

  let b: CellAnchorFrac | null = null;
  if (p.to && isFrac(p.to)) b = { ...p.to };
  else if (p.to) {
    const x = walkPx(p.to.c, p.to.ox, g.colW);
    const y = walkPx(p.to.r, p.to.oy, g.rowH);
    b = { c: x.i, fx: x.f, r: y.i, fy: y.f };
  } else if (p.ext) {
    const x = walkPx(a.c, a.fx * g.colW(a.c) + p.ext.w, g.colW);
    const y = walkPx(a.r, a.fy * g.rowH(a.r) + p.ext.h, g.rowH);
    b = { c: x.i, fx: x.f, r: y.i, fy: y.f };
  }
  return b ? { a, b } : null;
}

/** Ảnh DIB (bitmap thiếu phần đầu tệp, hay gặp trong .xls) → .bmp trình duyệt hiện được.
 * null nếu không phải dạng hỗ trợ. */
export function dibToBmp(dib: Uint8Array): Uint8Array | null {
  if (dib.length < 40) return null;
  const v = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const headerSize = v.getUint32(0, true);
  if (headerSize < 40) return null;
  const bits = v.getUint16(14, true);
  const compression = v.getUint32(16, true);
  let colors = v.getUint32(32, true);
  if (!colors && bits <= 8) colors = 1 << bits;
  const pixelOffset = 14 + headerSize + (compression === 3 && headerSize === 40 ? 12 : 0) + colors * 4;
  const out = new Uint8Array(14 + dib.length);
  const ov = new DataView(out.buffer);
  out[0] = 0x42; // "B"
  out[1] = 0x4d; // "M"
  ov.setUint32(2, out.length, true);
  ov.setUint32(10, pixelOffset, true);
  out.set(dib, 14);
  return out;
}
