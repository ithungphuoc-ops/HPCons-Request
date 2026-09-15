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

/**
 * Ba vùng của luật ngày, sinh ra từ 2 con số Admin đặt.
 *
 * ★ MỘT NƠI VIẾT, HAI NƠI DÙNG (Sếp chốt "cách A", 15/09/2026): hộp thiết lập
 * của Admin và câu báo lỗi cho người gửi PHẢI cùng gốc, không được mỗi nơi
 * viết một kiểu rồi lệch nhau khi sửa.
 *
 * Vì sao trả về MẢNG VÙNG thay vì một câu dài — 4 chỗ hỏng của câu cũ:
 *   "Chọn ngày cách ngày đề nghị ≤ 2 ngày làm việc: chặn hẳn, không cho gửi.
 *    Từ 3 ngày làm việc trở lên là hợp lệ — không có khoảng hỏi gấp. Ngày
 *    trước ngày đề nghị luôn bị chặn, không phụ thuộc 2 số này."
 *   1. `≤` là ký hiệu toán, không đọc thành lời tiếng Việt được.
 *   2. "chặn hẳn, không cho gửi" — hai vế cùng một nghĩa, thừa một.
 *   3. "không có khoảng hỏi gấp" — tả một vùng ĐANG TẮT, người đọc phải hình
 *      dung ra nó rồi mới xoá đi.
 *   4. "không phụ thuộc 2 số này" — "2 số" nào, người đọc phải ngước lên tìm.
 * Tách thành vùng thì nhóm không bật vùng hỏi gấp chỉ còn 2 dòng, KHÔNG phải
 * viết thêm câu giải thích một thứ vắng mặt.
 */
export type DateLeadTimeZoneKind = "blocked" | "urgent" | "ok";

export interface DateLeadTimeZone {
  kind: DateLeadTimeZoneKind;
  /** Nhãn ngắn, in đậm ở đầu dòng. */
  label: string;
  /** Phần mô tả sau nhãn. */
  detail: string;
}

export function dateLeadTimeZones(
  rule?: { blockDays?: number; standardDays?: number } | null,
): DateLeadTimeZone[] {
  const { blockDays, standardDays } = resolveDateLeadTimeNumbers(rule);
  const minOk = blockDays + 1;
  const coVungHoiGap = standardDays > minOk;

  const zones: DateLeadTimeZone[] = [
    {
      kind: "blocked",
      label: "Không gửi được",
      detail: `chọn ngày cách dưới ${minOk} ngày làm việc`,
    },
  ];
  if (coVungHoiGap) {
    zones.push({
      kind: "urgent",
      label: "Gửi được, app hỏi lại",
      detail: `từ ${minOk} đến ${standardDays - 1} ngày làm việc. Người gửi xác nhận là gấp thì phiếu được ghi chú lại.`,
    });
  }
  zones.push({
    kind: "ok",
    label: "Gửi bình thường",
    detail: `từ ${coVungHoiGap ? standardDays : minOk} ngày làm việc trở lên`,
  });
  return zones;
}

/** Dòng chân của hộp thiết lập — nói rõ 2 điều KHÔNG phụ thuộc 2 con số trên. */
export const DATE_LEAD_TIME_FOOTNOTE =
  "Chủ Nhật không tính là ngày làm việc. Ngày đã qua luôn bị chặn, dù đặt hai số này thế nào.";

/**
 * Câu báo cho NGƯỜI GỬI khi họ chọn ngày quá gấp.
 *
 * Cố ý CHỈ lấy ý của vùng đầu tiên, không kể cả 3 vùng như hộp thiết lập:
 * người gửi đang bị chặn, thứ họ cần là "phải chọn ngày nào", không phải bản
 * mô tả toàn bộ luật. Con số vẫn sinh từ đúng `blockDays` nên không lệch được
 * với hộp thiết lập.
 */
export function dateLeadTimeBlockedMessage(blockDays: number = DATE_LEAD_TIME_DEFAULT_BLOCK_DAYS): string {
  return `Ngày cần cấp phải cách ngày đề nghị ít nhất ${blockDays + 1} ngày làm việc, không tính Chủ Nhật.`;
}

/** Riêng cho ngày quá khứ — không nhắc mốc 3 ngày, báo thẳng cho người dùng chọn lại. */
export const DATE_LEAD_TIME_PAST_MESSAGE =
  "Ngày cần cấp không được trước ngày đề nghị — vui lòng chọn lại ngày.";

export const DATE_LEAD_TIME_URGENT_NOTE =
  "Yêu cầu gấp — chưa có kế hoạch đề nghị rõ ràng.";
