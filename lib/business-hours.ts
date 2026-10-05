/**
 * Cộng dồn SLA CHỈ trong giờ hành chính thật của công ty — 7:45–12:00 và
 * 13:00–17:15 GIỜ VIỆT NAM, Thứ 2 đến Thứ 7 (Chủ nhật nghỉ hoàn toàn). Dùng
 * cho "SLA theo lịch làm việc" (ProposalGroup.slaByWorkCalendar) — xem
 * design.md của change add-base-vn-group-settings-parity, Decision #7.
 *
 * Không "server-only": thuần tính toán ngày giờ, không đụng Firestore/
 * credential, để test được trực tiếp bằng vitest.
 */

const MORNING_START = 7 * 60 + 45; // 7:45
const MORNING_END = 12 * 60; // 12:00
const AFTERNOON_START = 13 * 60; // 13:00
const AFTERNOON_END = 17 * 60 + 15; // 17:15
const SUNDAY = 0;

/**
 * Mọi phép tính giờ hành chính đi theo GIỜ VIỆT NAM cố định (UTC+7, VN không
 * đổi giờ mùa hè) — KHÔNG dùng getHours()/setHours() vì đó là giờ của MÁY
 * ĐANG CHẠY: máy chủ Vercel chạy UTC nên trước 05/10/2026 khung 7:45–17:15 bị
 * hiểu thành 14:45–00:15 giờ VN (hạn SLA lệch, có hạn rơi vào 0h Chủ nhật).
 * Cách làm: dời mốc +7h rồi đọc/ghi bằng getUTC*()/setUTC*().
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function vnWall(date: Date): Date {
  return new Date(date.getTime() + VN_OFFSET_MS);
}

function fromVnWall(wall: Date): Date {
  return new Date(wall.getTime() - VN_OFFSET_MS);
}

function dayOfWeekVn(date: Date): number {
  return vnWall(date).getUTCDay();
}

function minutesOfDay(date: Date): number {
  const wall = vnWall(date);
  return wall.getUTCHours() * 60 + wall.getUTCMinutes();
}

function atMinutesOfDay(date: Date, minutes: number): Date {
  const wall = vnWall(date);
  wall.setUTCHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return fromVnWall(wall);
}

function startOfNextDay(date: Date): Date {
  const wall = vnWall(date);
  wall.setUTCDate(wall.getUTCDate() + 1);
  wall.setUTCHours(0, 0, 0, 0);
  return fromVnWall(wall);
}

/**
 * Dịch một thời điểm bất kỳ tới thời điểm HỢP LỆ gần nhất (>=) nằm trong 1
 * khung giờ hành chính — nếu đang ở ngoài giờ/nghỉ trưa/Chủ nhật thì nhảy
 * tới đầu khung giờ làm việc tiếp theo.
 */
function toNextBusinessMoment(date: Date): Date {
  let cursor = new Date(date);
  // Giới hạn vòng lặp để không treo nếu có lỗi logic — tối đa 14 ngày là dư sức.
  for (let guard = 0; guard < 14; guard += 1) {
    if (dayOfWeekVn(cursor) === SUNDAY) {
      cursor = atMinutesOfDay(startOfNextDay(cursor), MORNING_START);
      continue;
    }
    const m = minutesOfDay(cursor);
    if (m < MORNING_START) return atMinutesOfDay(cursor, MORNING_START);
    if (m >= MORNING_START && m < MORNING_END) return cursor;
    if (m >= MORNING_END && m < AFTERNOON_START) return atMinutesOfDay(cursor, AFTERNOON_START);
    if (m >= AFTERNOON_START && m < AFTERNOON_END) return cursor;
    // >= 17:15 -> sang ngày kế tiếp, đầu giờ sáng.
    cursor = atMinutesOfDay(startOfNextDay(cursor), MORNING_START);
  }
  return cursor;
}

/** Cộng `hours` giờ SLA vào `from`, chỉ tính trong giờ hành chính. */
export function addBusinessHours(from: Date, hours: number): Date {
  let remainingMinutes = Math.max(0, Math.round(hours * 60));
  let cursor = toNextBusinessMoment(from);

  while (remainingMinutes > 0) {
    const m = minutesOfDay(cursor);
    const windowEnd = m < MORNING_END ? MORNING_END : AFTERNOON_END;
    const availableInWindow = windowEnd - m;

    if (remainingMinutes <= availableInWindow) {
      cursor = atMinutesOfDay(cursor, m + remainingMinutes);
      remainingMinutes = 0;
    } else {
      remainingMinutes -= availableInWindow;
      cursor = toNextBusinessMoment(atMinutesOfDay(cursor, windowEnd));
    }
  }

  return cursor;
}

/**
 * Số giờ hành chính THỰC SỰ trôi qua giữa `from` và `to` — chiều ngược của
 * `addBusinessHours()`, dùng CÙNG khung giờ (7:45–12:00, 13:00–17:15, nghỉ
 * Chủ nhật) nên `businessHoursBetween(x, addBusinessHours(x, h)) === h`.
 * Dùng cho cột "Thực tế" ở popup "Tiến trình của người duyệt" khi nhóm bật
 * SLA theo lịch làm việc (lib/approver-progress.ts). `to <= from` → 0.
 */
export function businessHoursBetween(from: Date, to: Date): number {
  if (!(to.getTime() > from.getTime())) return 0;
  let cursor = toNextBusinessMoment(from);
  let totalMs = 0;
  // Mỗi vòng đi hết 1 khung giờ (sáng/chiều) — giới hạn ~10 năm khung giờ để
  // không treo nếu dữ liệu ngày giờ lỗi.
  for (let guard = 0; guard < 8000 && cursor.getTime() < to.getTime(); guard += 1) {
    const m = minutesOfDay(cursor);
    const windowEnd = atMinutesOfDay(cursor, m < MORNING_END ? MORNING_END : AFTERNOON_END);
    const sliceEnd = windowEnd.getTime() < to.getTime() ? windowEnd : to;
    totalMs += sliceEnd.getTime() - cursor.getTime();
    cursor = toNextBusinessMoment(windowEnd);
  }
  return totalMs / (60 * 60 * 1000);
}
