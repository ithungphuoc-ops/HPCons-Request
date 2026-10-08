/**
 * Chia thông báo theo NGÀY cho khung chuông (Sếp duyệt demo 08/10/2026 — "giống App Tổng").
 * Mirror lib/notificationFormat.ts của App Tổng: tiêu đề nhóm "8/10/2026" + nhãn
 * "Hôm nay" / "N ngày trước" (App Tổng KHÔNG có "Hôm qua" — giữ y để 2 chuông đọc như nhau).
 *
 * Khác App Tổng ở 1 chỗ: tính theo GIỜ VIỆT NAM (UTC+7) cố định, không theo múi giờ trình
 * duyệt — máy để sai múi giờ (hay gặp ở máy dựng sẵn tiếng Anh) vẫn chia đúng ngày, và
 * test chạy được ở mọi máy. Công ty chỉ hoạt động ở VN nên không mất gì.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** Số thứ tự ngày theo lịch VN (đếm từ 1/1/1970) — 2 mốc cùng số = cùng 1 ngày ở VN. */
function vnDayNumber(ms: number): number {
  return Math.floor((ms + VN_OFFSET_MS) / DAY_MS);
}

export function vnDayKey(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? String(vnDayNumber(t)) : "invalid";
}

/** "8/10/2026" — cùng dạng toLocaleDateString('vi-VN') App Tổng đang hiện. */
export function vnGroupDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + VN_OFFSET_MS);
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
}

export function vnRelativeDayLabel(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = vnDayNumber(now) - vnDayNumber(t);
  if (diff <= 0) return "Hôm nay";
  return `${diff} ngày trước`;
}

/** "11:17" theo giờ VN. */
export function vnTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + VN_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Gom danh sách (đã xếp mới → cũ) thành từng nhóm ngày, giữ nguyên thứ tự. */
export function groupByVnDay<T>(items: T[], at: (item: T) => string): { key: string; iso: string; items: T[] }[] {
  const out: { key: string; iso: string; items: T[] }[] = [];
  for (const item of items) {
    const iso = at(item);
    const key = vnDayKey(iso);
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(item);
    else out.push({ key, iso, items: [item] });
  }
  return out;
}
