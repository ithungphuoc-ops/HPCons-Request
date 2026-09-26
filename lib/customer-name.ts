/**
 * Rút gọn tên CĐT kiểu "CÔNG TY TNHH CÔNG NGHIỆP CHÍNH XÁC CHENKAI" ->
 * "CHENKAI" — bỏ CHỈ các từ tiếng Việt chỉ loại hình pháp nhân/mô tả ngành
 * nghề chung chung + hậu tố "VIỆT NAM", giữ nguyên mọi từ còn lại (kể cả
 * từ tiếng Anh là 1 phần thật của tên thương hiệu, ví dụ "GIANT
 * MANUFACTURING", "GOLDEN VIETNAMTEX" — 2 tên này KHÔNG được rút gọn thêm
 * nữa vì "MANUFACTURING"/"VIETNAMTEX" là thương hiệu, không phải từ mô tả
 * chung chung). Không đoán/không cắt theo số từ cố định — chỉ lọc đúng
 * danh sách từ dưới đây, so khớp NGUYÊN TỪ (không so khớp theo tiền tố),
 * nên "VIETNAMTEX" không bị ăn theo "VIỆT"/"NAM".
 *
 * File riêng (không import "server-only"/Firestore) để test được như 1 hàm
 * thuần, không cần mock gì — lib/congno.ts (có "server-only") chỉ import lại.
 */
const CUSTOMER_NAME_STOPWORDS = new Set([
  // Loại hình pháp nhân
  "CÔNG", "TY", "CTY", "TNHH", "MTV", "MỘT", "THÀNH", "VIÊN", "CỔ", "PHẦN", "CP",
  "TRÁCH", "NHIỆM", "HỮU", "HẠN",
  // Mô tả ngành nghề chung chung (tiếng Việt) — KHÔNG thêm từ tiếng Anh vào
  // đây (bài học từ `tenNganCDT` cũ ở app Công nợ: thêm "MANUFACTURING"/
  // "VIETNAMTEX"/"PRECISION"/"INDUSTRIAL" vào stopword đã cắt nhầm thương hiệu).
  "NGHIỆP", "CHÍNH", "XÁC", "CƠ", "KHÍ", "THƯƠNG", "MẠI", "SẢN", "XUẤT",
  "DỊCH", "VỤ", "XÂY", "DỰNG", "KỸ", "THUẬT", "CHẾ", "TẠO", "ĐẦU", "TƯ",
  "PHÁT", "TRIỂN",
  // Hậu tố quốc gia
  "VIỆT", "NAM",
]);

export function shortenCustomerName(raw: string): string {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !CUSTOMER_NAME_STOPWORDS.has(w.toUpperCase()));
  return kept.length > 0 ? kept.join(" ") : raw.trim();
}
