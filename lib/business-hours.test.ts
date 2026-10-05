import { describe, expect, it } from "vitest";
import { addBusinessHours, businessHoursBetween } from "./business-hours";

/** Test viết theo GIỜ VIỆT NAM tường minh (05/10/2026) — không dùng giờ máy
 * chạy test, để kết quả như nhau dù máy/CI ở múi UTC hay VN (đúng lỗi máy chủ
 * Vercel chạy UTC từng làm lệch hạn SLA). */
const VN = 7 * 60 * 60 * 1000;
const vnDay = (d: Date) => new Date(d.getTime() + VN).getUTCDay();

/** Ngày trong tuần (0=CN..6=T7, theo giờ VN) gần nhất >= from. */
function nextWeekday(from: Date, targetDay: number): Date {
  let d = new Date(from);
  while (vnDay(d) !== targetDay) d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  return d;
}

/** Cùng ngày (giờ VN) với `date`, đặt giờ:phút theo giờ VN. */
function at(date: Date, hours: number, minutes: number): Date {
  const wall = new Date(date.getTime() + VN);
  wall.setUTCHours(hours, minutes, 0, 0);
  return new Date(wall.getTime() - VN);
}

const ANCHOR = new Date(Date.UTC(2026, 0, 1, 5)); // 12:00 giờ VN 01/01/2026 — mốc để dò Thứ 2/6/7
const MONDAY = nextWeekday(ANCHOR, 1);
const FRIDAY = nextWeekday(ANCHOR, 5);
const SATURDAY = nextWeekday(ANCHOR, 6);

describe("addBusinessHours", () => {
  it("cộng trong cùng 1 khung giờ (sáng)", () => {
    const result = addBusinessHours(at(MONDAY, 8, 0), 1);
    expect(result).toEqual(at(MONDAY, 9, 0));
  });

  it("cộng qua giờ nghỉ trưa trong cùng ngày", () => {
    // 11:30 + 1h: còn 30' tới 12:00, nhảy nghỉ trưa, cộng tiếp 30' từ 13:00 -> 13:30.
    const result = addBusinessHours(at(MONDAY, 11, 30), 1);
    expect(result).toEqual(at(MONDAY, 13, 30));
  });

  it("cộng qua ngày kế tiếp khi hết giờ hành chính trong ngày", () => {
    // 16:00 T2 + 2h: dùng hết 1h15 tới 17:15, còn 45' cộng từ 7:45 T3 -> 8:30 T3.
    const tuesday = new Date(MONDAY);
    tuesday.setTime(tuesday.getTime() + 1 * 24 * 60 * 60 * 1000);
    const result = addBusinessHours(at(MONDAY, 16, 0), 2);
    expect(result).toEqual(at(tuesday, 8, 30));
  });

  it("gửi ngoài giờ hành chính (buổi tối) nhảy tới đầu giờ hành chính tiếp theo", () => {
    // 20:00 T6 + 1h -> nhảy tới 7:45 T7 (T7 vẫn là ngày làm việc), +1h -> 8:45 T7.
    const result = addBusinessHours(at(FRIDAY, 20, 0), 1);
    expect(result).toEqual(at(SATURDAY, 8, 45));
  });

  it("bỏ qua Chủ nhật khi cộng qua cuối tuần", () => {
    // 17:00 T7 + 1h: dùng hết 15' tới 17:15, còn 45' nhảy qua CN, cộng từ 7:45 T2 kế tiếp -> 8:30.
    const mondayAfter = new Date(SATURDAY);
    mondayAfter.setTime(mondayAfter.getTime() + 2 * 24 * 60 * 60 * 1000); // T7 -> CN -> T2
    const result = addBusinessHours(at(SATURDAY, 17, 0), 1);
    expect(result).toEqual(at(mondayAfter, 8, 30));
  });

  it("gửi lúc đang nghỉ trưa (12:30) nhảy tới 13:00 rồi mới cộng", () => {
    const result = addBusinessHours(at(MONDAY, 12, 30), 1);
    expect(result).toEqual(at(MONDAY, 14, 0));
  });

  it("cộng nhiều ngày liên tiếp (20 giờ từ đầu ngày Thứ 2)", () => {
    // Mỗi ngày làm việc có 8h30 (4h15 sáng + 4h15 chiều).
    // T2: 8h30 dùng hết -> còn 11h30. T3: 8h30 -> còn 3h. T4 sáng: 3h vừa hết trong khung 7:45-12:00 -> 10:45.
    const wednesday = new Date(MONDAY);
    wednesday.setTime(wednesday.getTime() + 2 * 24 * 60 * 60 * 1000);
    const result = addBusinessHours(at(MONDAY, 7, 45), 20);
    expect(result).toEqual(at(wednesday, 10, 45));
  });

  it("SLA 0 giờ trả về đúng thời điểm bắt đầu (đã dịch vào giờ hành chính nếu cần)", () => {
    const result = addBusinessHours(at(MONDAY, 9, 0), 0);
    expect(result).toEqual(at(MONDAY, 9, 0));
  });
});

describe("giờ Việt Nam cố định, không phụ thuộc múi giờ máy chạy (lỗi Vercel UTC 05/10/2026)", () => {
  const iso = (s: string) => new Date(s).toISOString();
  it("Thứ Hai 09:00 VN + 4h → 14:00 VN (trước đây máy chủ UTC ra 18:45)", () => {
    expect(addBusinessHours(new Date("2026-10-05T09:00:00+07:00"), 4).toISOString()).toBe(iso("2026-10-05T14:00:00+07:00"));
  });
  it("Thứ Hai 09:00 VN + 8h → 08:30 VN hôm sau", () => {
    expect(addBusinessHours(new Date("2026-10-05T09:00:00+07:00"), 8).toISOString()).toBe(iso("2026-10-06T08:30:00+07:00"));
  });
  it("Thứ Bảy 15:00 VN + 8h → Thứ Hai 14:30 VN, không bao giờ rơi vào Chủ nhật", () => {
    expect(addBusinessHours(new Date("2026-10-03T15:00:00+07:00"), 8).toISOString()).toBe(iso("2026-10-05T14:30:00+07:00"));
  });
  it("businessHoursBetween đo ngược đúng số giờ đã cộng", () => {
    const from = new Date("2026-10-03T15:00:00+07:00");
    expect(businessHoursBetween(from, addBusinessHours(from, 8))).toBeCloseTo(8, 5);
  });
});
