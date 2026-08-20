/**
 * Đếm số "ngày làm việc" (Thứ 2 → Thứ 7, trừ Chủ Nhật — CÙNG quy ước với
 * lib/business-hours.ts, "SLA theo lịch làm việc") và phân loại mức gấp của
 * 1 ngày cần cấp so với hôm làm đề nghị — dùng cho luật
 * ProposalField.dateLeadTimeRule (Sếp chốt 20/08/2026):
 *   - ≤ 2 ngày làm việc (kể cả ngày hôm nay/quá khứ) → "blocked", CHẶN HẲN
 *     không cho gửi đề xuất — mốc cứng, không phụ thuộc `standardDays`.
 *   - 3 ngày tới TRƯỚC ngưỡng chuẩn Admin chọn riêng cho field (standardDays:
 *     5/7/15) → "urgent", phải hỏi lại người gửi có thật cần thiết rồi mới
 *     cho đánh dấu.
 *   - >= standardDays → "ok", không cảnh báo gì.
 *
 * Thuần tính toán ngày giờ, không đụng Firestore/credential — test được
 * trực tiếp bằng vitest (xem date-lead-time.test.ts), không cần "server-only".
 */

const SUNDAY = 0;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Ép giá trị field date/datetime ("YYYY-MM-DD" hoặc "YYYY-MM-DDTHH:mm" — xem
 * components/ui/DatePicker.tsx) về mốc NGÀY theo giờ địa phương. Khớp đúng
 * cách DatePicker tự parse (new Date(datePart + 'T00:00:00')) để không lệch
 * ngày do parse chuỗi "YYYY-MM-DD" trần kiểu UTC. Trả `null` nếu rỗng/không
 * hợp lệ.
 */
export function parseFieldDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const datePart = value.split("T")[0];
  if (!datePart) return null;
  const d = new Date(`${datePart}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Số ngày làm việc tính từ SAU ngày `from` (không tính ngày `from`) cho tới
 * HẾT ngày `to` (có tính ngày `to`, nếu không phải Chủ Nhật). `to` cùng ngày
 * hoặc trước `from` → 0 (không trả số âm).
 */
export function countBusinessDaysBetween(from: Date, to: Date): number {
  const start = startOfDay(from);
  const end = startOfDay(to);
  if (end <= start) return 0;

  let count = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= end) {
    if (cursor.getDay() !== SUNDAY) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export type DateLeadTimeStatus = "blocked" | "urgent" | "ok";

export function classifyDateLeadTime(businessDays: number, standardDays: number): DateLeadTimeStatus {
  if (businessDays <= 2) return "blocked";
  if (businessDays < standardDays) return "urgent";
  return "ok";
}

export const DATE_LEAD_TIME_BLOCKED_MESSAGE =
  "Ngày cần cấp phải cách hôm làm đề nghị hơn 3 ngày làm việc (Thứ 2–Thứ 7, trừ Chủ Nhật) — vui lòng chọn ngày khác.";

export const DATE_LEAD_TIME_URGENT_NOTE =
  "Yêu cầu gấp — chưa có kế hoạch đề nghị rõ ràng.";
