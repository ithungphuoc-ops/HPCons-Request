/**
 * Tên nhà thầu phụ vắn tắt — PORT Y NGUYÊN thuật toán `ntpVietTat` của app
 * Công nợ (HPCons-Congno/lib/subcontractors.ts, chốt 30/09/2026) để 2 app
 * luôn rút gọn RA CÙNG 1 KẾT QUẢ cho cùng 1 tên, tránh 2 nơi tự tính lệch
 * nhau. Dùng khi Admin/người làm đề xuất để trống "Tên viết tắt" lúc thêm
 * nhà thầu phụ mới qua app Đề xuất (xem lib/congno.ts createSubcontractorInCongNo
 * và ShortTextWithExternalCodeLookup trong submit/page.tsx) — Công nợ cũng tự
 * tính lại y hệt lúc hiển thị (`tenVanTatNTP`) nếu field này để trống, nên
 * việc app Đề xuất có tự tính trước hay không chỉ ảnh hưởng TRẢI NGHIỆM xem
 * trước, không ảnh hưởng kết quả cuối cùng.
 *
 * File này KHÔNG import "server-only" — dùng được cả ở client (gợi ý trực
 * tiếp lúc đang gõ) lẫn server (fallback khi lưu nếu để trống).
 */

const LOAI_HINH = [
  "CÔNG TY",
  "TRÁCH NHIỆM HỮU HẠN",
  "TNHH",
  "CỔ PHẦN",
  "MỘT THÀNH VIÊN",
  "HAI THÀNH VIÊN",
  "MTV",
  "DOANH NGHIỆP TƯ NHÂN",
  "DNTN",
  "HỢP TÁC XÃ",
  "HỘ KINH DOANH",
  "CP",
];
const NGANH_NGHE = [
  "XUẤT NHẬP KHẨU", "PHÒNG CHÁY CHỮA CHÁY", "PHÒNG CHÁY", "CHỮA CHÁY", "CHỐNG CHÁY", "VỆ SINH NHÀ SẠCH", "NHÀ SẠCH",
  "ĐỊA KỸ THUẬT", "KỸ THUẬT", "ĐẦU TƯ", "PHÁT TRIỂN", "MÔI TRƯỜNG", "THƯƠNG MẠI", "XÂY DỰNG", "DỊCH VỤ", "CƠ KHÍ",
  "TƯ VẤN", "THIẾT KẾ", "SẢN XUẤT", "KIẾN TRÚC", "KIỂM ĐỊNH", "CƠ ĐIỆN", "CÔNG NGHỆ", "CÔNG NGHIỆP", "NỘI THẤT",
  "TRANG TRÍ", "VẬN TẢI", "THIẾT BỊ", "CÂY XANH", "ĐO ĐẠC", "KHẢO SÁT", "CƠ GIỚI", "TỔNG HỢP", "XÂY LẮP",
  "THANG MÁY", "CẦU TRỤC", "QUY HOẠCH", "KHOA HỌC", "QUỐC TẾ", "XÂY DỰNG", "SẢN XUẤT", "MÁY XÂY DỰNG", "BÓ VỈA",
  "CỬA", "ĐIỆN", "MÁY", "ĐÁ", "GRANITE", "& CỘNG SỰ", "VÀ CỘNG SỰ", "CỘNG SỰ", "VIỆN", "VÀ", "&",
  "TMDV", "TM", "DV", "XD", "XDTM", "SX", "TMĐT",
];
const QUOC_GIA = /\s*\(?\s*(VIỆT NAM|VIET NAM|VIETNAM|VN)\s*\)?\.?\s*$/;
const PHU_AM_DAU = "(NGH|NG|NH|CH|GH|GI|KH|PH|QU|TH|TR|[BCDĐGHKLMNPRSTVX])?";
const NGUYEN_AM = "[AĂÂEÊIOÔƠUƯY]+";
const PHU_AM_CUOI = "(NG|NH|CH|[CMNPT])?";
const AM_TIET = new RegExp(`^${PHU_AM_DAU}${NGUYEN_AM}${PHU_AM_CUOI}$`);
const boDau = (w: string) => w.normalize("NFD").replace(/[̀-̣̉]/g, "").normalize("NFC");
const laTiengViet = (w: string) => AM_TIET.test(boDau(w));
const coDau = (w: string) => w.normalize("NFD") !== w.normalize("NFD").replace(/[̀-ͯ]/g, "") || /Đ/.test(w);

export function ntpVietTat(ten?: string): string {
  let t = ` ${(ten || "").toUpperCase().normalize("NFC").replace(/\s+/g, " ").trim()} `;
  if (!t.trim()) return "";
  for (let lap = 0; lap < 3; lap++) for (const l of LOAI_HINH) t = t.replace(new RegExp(`^\\s*${l}\\s+`), " ");
  t = t.replace(QUOC_GIA, " ").replace(/\s*[-–—]\s*/g, " - ").replace(/[.,]+\s*$/, " ");
  let toks = t.trim().split(" ").filter(Boolean);
  const gen = new Array(toks.length).fill(false);
  const phrases = [...new Set(NGANH_NGHE)].sort((a, b) => b.split(" ").length - a.split(" ").length);
  for (let i = 0; i < toks.length; i++) {
    for (const p of phrases) {
      const ws = p.split(" ");
      if (ws.every((w, k) => toks[i + k] === w)) {
        for (let k = 0; k < ws.length; k++) gen[i + k] = true;
        break;
      }
    }
  }
  toks = toks.map((w, i) => (w === "-" && (gen[i - 1] || gen[i + 1] || i === 0 || i === toks.length - 1) ? "" : w));
  let end = toks.length - 1;
  while (end >= 0 && (gen[end] || !toks[end])) end--;
  let start = end;
  while (start - 1 >= 0 && !gen[start - 1] && toks[start - 1]) start--;
  let rieng = end >= 0 ? toks.slice(start, end + 1) : [];
  const firstViet = rieng.findIndex((w) => coDau(w) && laTiengViet(w));
  if (firstViet > 0) {
    let k = firstViet;
    while (k > 0 && laTiengViet(rieng[k - 1])) k--;
    if (k > 0 && rieng.slice(0, k).every((w) => !laTiengViet(w))) rieng = rieng.slice(k);
  }
  const out = rieng.join(" ").replace(/\s*-\s*/g, "-").trim();
  return out || t.trim();
}
