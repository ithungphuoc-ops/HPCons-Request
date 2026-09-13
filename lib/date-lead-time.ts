/**
 * Đếm số "ngày làm việc" (Thứ 2 → Thứ 7, trừ Chủ Nhật — CÙNG quy ước với
 * lib/business-hours.ts, "SLA theo lịch làm việc") và phân loại mức gấp của
 * 1 ngày cần cấp so với hôm làm đề nghị — dùng cho luật
 * ProposalField.dateLeadTimeRule (Sếp chốt 20/08/2026):
 *   - ≤ `blockDays` (kể cả hôm nay) → "blocked", CHẶN HẲN không cho gửi.
 *   - `blockDays`+1 tới TRƯỚC `standardDays` → "urgent", phải hỏi lại người gửi
 *     có thật sự gấp không rồi mới cho đánh dấu. Đặt `standardDays` =
 *     `blockDays`+1 thì khoảng này RỖNG — không bao giờ hỏi.
 *   - >= `standardDays` → "ok", không cảnh báo gì.
 *
 * Cả 2 mốc do Admin tự đặt cho TỪNG field của TỪNG nhóm (Sếp chốt "phương án
 * C" 13/09/2026). Field lưu trước ngày đó không có `blockDays` → mặc định 2.
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

/**
 * "past" = chọn ngày TRƯỚC ngày làm đề nghị — tách riêng khỏi "blocked" để báo
 * đúng câu lỗi (Sếp yêu cầu 13/09/2026: ngày quá khứ báo thẳng "chọn lại ngày",
 * không nói về mốc 3 ngày làm việc).
 */
export type DateLeadTimeStatus = "past" | "blocked" | "urgent" | "ok";

/** Mặc định khi field chưa có cấu hình — đúng bằng hành vi trước 13/09/2026. */
export const DATE_LEAD_TIME_DEFAULT_BLOCK_DAYS = 2;
export const DATE_LEAD_TIME_DEFAULT_STANDARD_DAYS = 5;
/** Chặn số vô lý (gõ nhầm 999) ở cả trình duyệt lẫn máy chủ. */
export const DATE_LEAD_TIME_MAX_DAYS = 60;

export type DateLeadTimeNumbers = { blockDays: number; standardDays: number };

/**
 * NƠI DUY NHẤT điền mặc định cho field cũ (chưa có `blockDays`) — mọi chỗ cần
 * 2 con số đều phải đi qua đây, đừng đọc `rule.blockDays` trần.
 */
export function resolveDateLeadTimeNumbers(
  rule?: { blockDays?: number; standardDays?: number } | null,
): DateLeadTimeNumbers {
  return {
    blockDays: Number.isInteger(rule?.blockDays) ? (rule?.blockDays as number) : DATE_LEAD_TIME_DEFAULT_BLOCK_DAYS,
    standardDays: Number.isInteger(rule?.standardDays)
      ? (rule?.standardDays as number)
      : DATE_LEAD_TIME_DEFAULT_STANDARD_DAYS,
  };
}

export function classifyDateLeadTime(
  businessDays: number,
  standardDays: number,
  blockDays: number = DATE_LEAD_TIME_DEFAULT_BLOCK_DAYS,
): DateLeadTimeStatus {
  if (businessDays <= blockDays) return "blocked";
  if (businessDays < standardDays) return "urgent";
  return "ok";
}

/**
 * Kiểm tra 2 con số Admin đặt. Trả câu lỗi tiếng Việt, `null` = hợp lệ. Dùng
 * CHUNG cho hộp thoại sửa trường (chặn sớm) và máy chủ lúc lưu nhóm (phòng
 * người gọi thẳng API) — không được lệch luật giữa 2 nơi.
 */
export function validateDateLeadTimeNumbers({ blockDays, standardDays }: DateLeadTimeNumbers): string | null {
  if (!Number.isInteger(blockDays) || blockDays < 0 || blockDays > DATE_LEAD_TIME_MAX_DAYS) {
    return `Mốc chặn phải là số nguyên từ 0 đến ${DATE_LEAD_TIME_MAX_DAYS}.`;
  }
  if (!Number.isInteger(standardDays) || standardDays < 1 || standardDays > DATE_LEAD_TIME_MAX_DAYS) {
    return `Ngưỡng chuẩn phải là số nguyên từ 1 đến ${DATE_LEAD_TIME_MAX_DAYS}.`;
  }
  if (standardDays <= blockDays) {
    return `Ngưỡng chuẩn (${standardDays}) phải lớn hơn mốc chặn (${blockDays}) — nếu không, vùng "hợp lệ" và vùng "chặn" chồng lên nhau.`;
  }
  return null;
}

/**
 * Phân loại theo 2 mốc NGÀY thật (thay vì chỉ số ngày làm việc) để phân biệt
 * được ngày quá khứ với ngày quá gấp. `now` mặc định là bây giờ.
 */
export function classifyDateLeadTimeByDate(
  target: Date,
  rule?: { blockDays?: number; standardDays?: number } | null,
  now: Date = new Date(),
): DateLeadTimeStatus {
  if (startOfDay(target) < startOfDay(now)) return "past";
  const { blockDays, standardDays } = resolveDateLeadTimeNumbers(rule);
  return classifyDateLeadTime(countBusinessDaysBetween(now, target), standardDays, blockDays);
}

/** Câu chặn đổi theo mốc Admin đặt: chặn ≤ blockDays nghĩa là phải cách ÍT NHẤT blockDays+1 ngày. */
export function dateLeadTimeBlockedMessage(blockDays: number = DATE_LEAD_TIME_DEFAULT_BLOCK_DAYS): string {
  return `Ngày cần cấp phải cách ngày đề nghị ÍT NHẤT ${blockDays + 1} ngày làm việc (Không bao gồm Chủ Nhật) — vui lòng chọn ngày khác.`;
}

/** Riêng cho ngày quá khứ — không nhắc mốc 3 ngày, báo thẳng cho người dùng chọn lại. */
export const DATE_LEAD_TIME_PAST_MESSAGE =
  "Ngày cần cấp không được trước ngày đề nghị — vui lòng chọn lại ngày.";

export const DATE_LEAD_TIME_URGENT_NOTE =
  "Yêu cầu gấp — chưa có kế hoạch đề nghị rõ ràng.";
