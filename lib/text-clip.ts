/**
 * Cắt chữ an toàn cho thông báo (Web Push + `meta` chuông App Tổng) — review PR #96:
 *  - Cắt theo UTF-16 (`slice`) làm vỡ emoji thành "�", tách đôi emoji ghép (gia đình 👨‍👩‍👧
 *    nối bằng ZWJ), và rơi dấu tiếng Việt nếu chữ được gõ dạng tổ hợp (NFD: "e" + dấu rời).
 *    → chuẩn hoá NFC rồi cắt theo "cụm ký tự người đọc thấy" (grapheme, Intl.Segmenter);
 *    trình chạy thiếu Segmenter thì cắt theo điểm mã (Array.from) — ít nhất không ra "�".
 *  - Bỏ ký tự điều khiển chiều chữ / vô hình (U+202A–202E, U+2066–2069, U+200B, U+200E,
 *    U+200F, U+FEFF): có thể bị lợi dụng đảo ngược chữ hiển thị trên màn hình khoá.
 *    CỐ Ý GIỮ U+200C/U+200D (ZWNJ/ZWJ) — ZWJ là "keo" của emoji ghép, bỏ đi thì 👨‍👩‍👧
 *    thành 3 người rời; chúng không đổi chiều chữ.
 */

const INVISIBLE_CONTROLS = /[‪-‮⁦-⁩​‎‏﻿]/g;

/** NFC + bỏ ký tự điều khiển + gộp mọi khoảng trắng/xuống dòng thành 1 dấu cách. */
export function cleanOneLine(text: string | null | undefined): string {
  return (text ?? "").normalize("NFC").replace(INVISIBLE_CONTROLS, "").replace(/\s+/g, " ").trim();
}

type SegmenterCtor = new (locale?: string, opts?: { granularity: "grapheme" }) => {
  segment(input: string): Iterable<{ segment: string }>;
};

function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (typeof Segmenter === "function") {
    return Array.from(new Segmenter("vi", { granularity: "grapheme" }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** 1 dòng, tối đa `max` cụm ký tự + "…". Rỗng → "". */
export function clipGraphemes(text: string | null | undefined, max: number): string {
  const t = cleanOneLine(text);
  if (!t) return "";
  // Nhanh: chuỗi ngắn hơn max đơn vị UTF-16 thì chắc chắn ngắn hơn max cụm.
  if (t.length <= max) return t;
  const parts = graphemes(t);
  return parts.length > max ? `${parts.slice(0, max).join("").trimEnd()}…` : t;
}
