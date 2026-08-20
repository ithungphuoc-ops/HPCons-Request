import { describe, expect, it } from "vitest";
import { classifyDateLeadTime, countBusinessDaysBetween, parseFieldDateOnly } from "./date-lead-time";

/** Tìm ngày trong tuần (0=CN..6=T7) gần nhất >= from — test không phụ thuộc
 * vào việc nhớ đúng thứ của 1 ngày cụ thể theo lịch thật (cùng kỹ thuật
 * business-hours.test.ts). */
function nextWeekday(from: Date, targetDay: number): Date {
  const d = new Date(from);
  while (d.getDay() !== targetDay) d.setDate(d.getDate() + 1);
  return d;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

const ANCHOR = new Date(2026, 0, 1);
const MONDAY = nextWeekday(ANCHOR, 1);

describe("countBusinessDaysBetween", () => {
  it("cùng ngày -> 0", () => {
    expect(countBusinessDaysBetween(MONDAY, MONDAY)).toBe(0);
  });

  it("to trước from -> 0 (không âm)", () => {
    expect(countBusinessDaysBetween(MONDAY, addDays(MONDAY, -3))).toBe(0);
  });

  it("Thứ 2 -> Thứ 3 (liền kề, không qua Chủ Nhật) = 1 ngày làm việc", () => {
    expect(countBusinessDaysBetween(MONDAY, addDays(MONDAY, 1))).toBe(1);
  });

  it("Thứ 2 -> Thứ 7 cùng tuần = 5 ngày làm việc (T3,T4,T5,T6,T7)", () => {
    expect(countBusinessDaysBetween(MONDAY, addDays(MONDAY, 5))).toBe(5);
  });

  it("Thứ 2 -> Thứ 2 tuần sau = 6 ngày làm việc (trừ đúng Chủ Nhật giữa 2 mốc)", () => {
    expect(countBusinessDaysBetween(MONDAY, addDays(MONDAY, 7))).toBe(6);
  });

  it("bỏ qua phần giờ:phút, chỉ tính theo ngày", () => {
    const from = new Date(MONDAY);
    from.setHours(23, 0, 0, 0);
    const to = new Date(addDays(MONDAY, 1));
    to.setHours(0, 5, 0, 0);
    expect(countBusinessDaysBetween(from, to)).toBe(1);
  });
});

describe("classifyDateLeadTime", () => {
  it("<=2 ngày làm việc -> blocked, mốc cứng không phụ thuộc standardDays", () => {
    expect(classifyDateLeadTime(0, 5)).toBe("blocked");
    expect(classifyDateLeadTime(2, 15)).toBe("blocked");
  });

  it("3 ngày tới trước standardDays -> urgent", () => {
    expect(classifyDateLeadTime(3, 5)).toBe("urgent");
    expect(classifyDateLeadTime(4, 5)).toBe("urgent");
    expect(classifyDateLeadTime(6, 7)).toBe("urgent");
    expect(classifyDateLeadTime(14, 15)).toBe("urgent");
  });

  it(">= standardDays -> ok", () => {
    expect(classifyDateLeadTime(5, 5)).toBe("ok");
    expect(classifyDateLeadTime(20, 15)).toBe("ok");
  });
});

describe("parseFieldDateOnly", () => {
  it("rỗng/null -> null", () => {
    expect(parseFieldDateOnly("")).toBeNull();
    expect(parseFieldDateOnly(null)).toBeNull();
    expect(parseFieldDateOnly(undefined)).toBeNull();
  });

  it("YYYY-MM-DD -> đúng ngày theo giờ địa phương, không lệch do UTC", () => {
    const d = parseFieldDateOnly("2026-08-25");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(7);
    expect(d!.getDate()).toBe(25);
  });

  it("YYYY-MM-DDTHH:mm (datetime) -> chỉ lấy phần ngày", () => {
    const d = parseFieldDateOnly("2026-08-25T14:30");
    expect(d).not.toBeNull();
    expect(d!.getDate()).toBe(25);
    expect(d!.getHours()).toBe(0);
  });
});
