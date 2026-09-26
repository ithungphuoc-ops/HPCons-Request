/**
 * Rút gọn tên CĐT kiểu "CÔNG TY TNHH CÔNG NGHIỆP CHÍNH XÁC CHENKAI" ->
 * "CHENKAI" — bỏ CHỈ các từ tiếng Việt chỉ loại hình pháp nhân/mô tả ngành
 * nghề chung chung + hậu tố quốc gia (đứng riêng "VIỆT NAM" hoặc trong
 * ngoặc "(VIETNAM)"/"(VIET NAM)"/"(VIỆT NAM)" — cả 3 cách viết đều có thật
 * trong dữ liệu, xác nhận qua đọc trực tiếp Firestore project "hpcons-congno"
 * 26/09/2026, 11 tên CĐT khác nhau/20 hợp đồng), giữ nguyên mọi từ còn lại
 * (kể cả từ tiếng Anh là 1 phần thật của tên thương hiệu, ví dụ "GIANT
 * MANUFACTURING", "GOLDEN VIETNAMTEX", "HOWELL TECHNOLOGY" — các từ này
 * KHÔNG được rút gọn thêm nữa vì là thương hiệu, không phải mô tả chung
 * chung). Không đoán/không cắt theo số từ cố định — chỉ lọc đúng danh sách
 * từ dưới đây, so khớp NGUYÊN TỪ (không so khớp theo tiền tố), nên
 * "VIETNAMTEX" không bị ăn theo "VIỆT"/"NAM"/"VIETNAM".
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
  // Hậu tố quốc gia đứng riêng (không ngoặc) — "VIETNAM" không dấu cũng có
  // thể xuất hiện dạng rời (dù dữ liệu thật hiện tại chỉ thấy dạng này
  // trong ngoặc, thêm sẵn phòng khi có tên mới không ngoặc).
  "VIỆT", "NAM", "VIETNAM",
]);

// Hậu tố quốc gia dạng "(VIETNAM)"/"(VIET NAM)"/"(VIỆT NAM)" — xác nhận có
// thật trong dữ liệu (JIANGDONG, HOWELL TECHNOLOGY, RTI, SHUN HING). Tách
// riêng trước khi lọc theo từ vì đây là 1 cụm dính liền dấu ngoặc, không
// tách được bằng split(/\s+/) như các từ khác.
const TRAILING_COUNTRY_PAREN = /\s*\(\s*(?:VIỆT\s*NAM|VIET\s*NAM|VIETNAM)\s*\)\s*$/i;

export function shortenCustomerName(raw: string): string {
  const withoutCountryParen = raw.trim().replace(TRAILING_COUNTRY_PAREN, "");
  const words = withoutCountryParen.split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !CUSTOMER_NAME_STOPWORDS.has(w.toUpperCase()));
  if (kept.length > 0) return kept.join(" ");
  // Lọc hết sạch (toàn từ pháp nhân/quốc gia) — trả lại bản đã bỏ ngoặc quốc
  // gia (nếu có) thay vì chuỗi gốc, để không lộ lại "(VIETNAM)" đã xác định
  // là thừa; nếu bản đó cũng rỗng thì mới lùi về chuỗi gốc.
  return withoutCountryParen.trim() || raw.trim();
}
