/**
 * Số tuần ISO 8601 (tuần bắt đầu thứ Hai, tuần 1 = tuần chứa thứ Năm đầu tiên
 * của năm) — dùng chung cho mọi nơi cần hiển thị/tra cứu theo tuần (yêu cầu
 * Sếp 18/08/2026). Đặt ở lib/ (không phải trong component) để nơi khác dùng
 * lại được — vd trang danh sách, mẫu in, mà không phải chép lại thuật toán.
 *
 * Cố ý tính theo giờ Việt Nam (Asia/Ho_Chi_Minh) bằng Intl.DateTimeFormat,
 * KHÔNG dùng getFullYear()/getMonth()/getDate() của đối tượng Date (các hàm
 * đó đọc theo múi giờ LOCAL của máy đang chạy code — khác nhau giữa server
 * Vercel (thường UTC) và trình duyệt người dùng (giờ VN, UTC+7). Nếu không
 * cố định múi giờ, đề xuất nộp gần nửa đêm giờ VN có thể ra 2 kết quả "ngày"
 * khác nhau giữa lần render đầu trên server và lúc hydrate trên trình duyệt
 * — gây lệch số tuần hiển thị hoặc cảnh báo hydration mismatch của React.
 */

const VN_DATE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getIsoWeekInfo(iso: string): { week: number; isOdd: boolean } {
  // "en-CA" cho ra định dạng "YYYY-MM-DD" ổn định để tách số, không phụ
  // thuộc locale runtime đang chạy code.
  const [y, m, day] = VN_DATE_PARTS.format(new Date(iso)).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, day));
  // ISO: Chủ nhật = 7 (thay vì 0) để công thức "lùi về thứ Năm cùng tuần" đúng.
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { week, isOdd: week % 2 === 1 };
}
