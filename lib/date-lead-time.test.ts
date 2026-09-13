import { describe, expect, it } from "vitest";
import {
  classifyDateLeadTime,
  classifyDateLeadTimeByDate,
  countBusinessDaysBetween,
  dateLeadTimeBlockedMessage,
  parseFieldDateOnly,
  resolveDateLeadTimeNumbers,
  validateDateLeadTimeNumbers,
} from "./date-lead-time";

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

  // Mốc 3 ngày (Sếp thêm 13/09/2026): khoảng "gấp" rỗng — 2 ngày vẫn chặn,
  // từ 3 ngày trở lên là "ok", không bao giờ rơi vào "urgent".
  it("standardDays = 3 -> không có khoảng urgent", () => {
    expect(classifyDateLeadTime(2, 3)).toBe("blocked");
    expect(classifyDateLeadTime(3, 3)).toBe("ok");
    expect(classifyDateLeadTime(10, 3)).toBe("ok");
  });
});

describe("classifyDateLeadTimeByDate", () => {
  // MONDAY là mốc "hôm làm đề nghị" trong bộ test này.
  it("ngày trước hôm làm đề nghị -> past (không phải blocked)", () => {
    expect(classifyDateLeadTimeByDate(addDays(MONDAY, -1), { standardDays: 5 }, MONDAY)).toBe("past");
    expect(classifyDateLeadTimeByDate(addDays(MONDAY, -30), { standardDays: 3 }, MONDAY)).toBe("past");
  });

  it("đúng hôm nay hoặc 1-2 ngày làm việc -> blocked", () => {
    expect(classifyDateLeadTimeByDate(MONDAY, { standardDays: 5 }, MONDAY)).toBe("blocked");
    expect(classifyDateLeadTimeByDate(addDays(MONDAY, 2), { standardDays: 5 }, MONDAY)).toBe("blocked");
  });

  it("đủ xa -> urgent/ok theo ngưỡng chuẩn", () => {
    expect(classifyDateLeadTimeByDate(addDays(MONDAY, 3), { standardDays: 5 }, MONDAY)).toBe("urgent");
    expect(classifyDateLeadTimeByDate(addDays(MONDAY, 3), { standardDays: 3 }, MONDAY)).toBe("ok");
  });
});

// ===== Phương án C: Admin tự đặt 2 mốc (Sếp chốt 13/09/2026) =====
describe("resolveDateLeadTimeNumbers", () => {
  it("field cũ chỉ có standardDays -> blockDays mặc định 2 (giữ hành vi cũ)", () => {
    expect(resolveDateLeadTimeNumbers({ standardDays: 7 })).toEqual({ blockDays: 2, standardDays: 7 });
  });
  it("không có gì -> 2/5", () => {
    expect(resolveDateLeadTimeNumbers(undefined)).toEqual({ blockDays: 2, standardDays: 5 });
    expect(resolveDateLeadTimeNumbers(null)).toEqual({ blockDays: 2, standardDays: 5 });
  });
  it("blockDays = 0 vẫn được giữ (0 là số hợp lệ, không rơi về mặc định)", () => {
    expect(resolveDateLeadTimeNumbers({ blockDays: 0, standardDays: 1 })).toEqual({ blockDays: 0, standardDays: 1 });
  });
});

describe("classifyDateLeadTime theo blockDays tuỳ chỉnh", () => {
  it("blockDays = 0 -> chỉ hôm nay bị chặn", () => {
    expect(classifyDateLeadTime(0, 5, 0)).toBe("blocked");
    expect(classifyDateLeadTime(1, 5, 0)).toBe("urgent");
  });
  it("blockDays = 3 -> tới 3 ngày vẫn chặn", () => {
    expect(classifyDateLeadTime(3, 10, 3)).toBe("blocked");
    expect(classifyDateLeadTime(4, 10, 3)).toBe("urgent");
    expect(classifyDateLeadTime(10, 10, 3)).toBe("ok");
  });
  it("standardDays = blockDays + 1 -> không có vùng gấp", () => {
    expect(classifyDateLeadTime(3, 4, 3)).toBe("blocked");
    expect(classifyDateLeadTime(4, 4, 3)).toBe("ok");
  });
});

describe("validateDateLeadTimeNumbers", () => {
  it("hợp lệ -> null", () => {
    expect(validateDateLeadTimeNumbers({ blockDays: 2, standardDays: 5 })).toBeNull();
    expect(validateDateLeadTimeNumbers({ blockDays: 0, standardDays: 1 })).toBeNull();
  });
  it("ngưỡng chuẩn <= mốc chặn -> báo lỗi", () => {
    expect(validateDateLeadTimeNumbers({ blockDays: 5, standardDays: 3 })).toMatch(/lớn hơn mốc chặn/);
    expect(validateDateLeadTimeNumbers({ blockDays: 3, standardDays: 3 })).toMatch(/lớn hơn mốc chặn/);
  });
  it("số âm / không nguyên / quá lớn -> báo lỗi", () => {
    expect(validateDateLeadTimeNumbers({ blockDays: -1, standardDays: 5 })).toMatch(/Mốc chặn/);
    expect(validateDateLeadTimeNumbers({ blockDays: 2, standardDays: 999 })).toMatch(/Ngưỡng chuẩn/);
    expect(validateDateLeadTimeNumbers({ blockDays: 1.5, standardDays: 5 })).toMatch(/Mốc chặn/);
    expect(validateDateLeadTimeNumbers({ blockDays: 2, standardDays: 0 })).toMatch(/Ngưỡng chuẩn/);
  });
});

describe("dateLeadTimeBlockedMessage", () => {
  it("nói ÍT NHẤT blockDays + 1 ngày", () => {
    expect(dateLeadTimeBlockedMessage(2)).toContain("ÍT NHẤT 3 ngày làm việc");
    expect(dateLeadTimeBlockedMessage(0)).toContain("ÍT NHẤT 1 ngày làm việc");
    expect(dateLeadTimeBlockedMessage()).toContain("ÍT NHẤT 3 ngày làm việc");
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
