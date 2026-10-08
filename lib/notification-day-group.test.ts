import { describe, expect, it } from "vitest";
import { groupByVnDay, vnDayKey, vnGroupDate, vnRelativeDayLabel, vnTime } from "./notification-day-group";

// 08/10/2026 11:17 giờ VN = 04:17 UTC.
const NOW = Date.parse("2026-10-08T04:17:00.000Z");

describe("chia ngày theo giờ VN (UTC+7)", () => {
  it("17:30 UTC = 00:30 giờ VN hôm sau → khác ngày với 16:30 UTC", () => {
    expect(vnDayKey("2026-10-07T17:30:00.000Z")).not.toBe(vnDayKey("2026-10-07T16:30:00.000Z"));
    expect(vnGroupDate("2026-10-07T17:30:00.000Z")).toBe("8/10/2026");
    expect(vnGroupDate("2026-10-07T16:30:00.000Z")).toBe("7/10/2026");
  });

  it("nhãn giống App Tổng: Hôm nay / N ngày trước", () => {
    expect(vnRelativeDayLabel("2026-10-07T17:30:00.000Z", NOW)).toBe("Hôm nay");
    expect(vnRelativeDayLabel("2026-10-07T16:30:00.000Z", NOW)).toBe("1 ngày trước");
    expect(vnRelativeDayLabel("2026-10-01T04:00:00.000Z", NOW)).toBe("7 ngày trước");
  });

  it("giờ:phút theo giờ VN", () => {
    expect(vnTime("2026-10-08T04:17:00.000Z")).toBe("11:17");
    expect(vnTime("2026-10-07T17:05:00.000Z")).toBe("00:05");
  });

  it("gom nhóm giữ thứ tự, mốc lỗi không làm hỏng", () => {
    const groups = groupByVnDay(
      ["2026-10-08T04:00:00.000Z", "2026-10-08T01:00:00.000Z", "2026-10-07T10:00:00.000Z", "x"],
      (s) => s,
    );
    expect(groups.map((g) => g.items.length)).toEqual([2, 1, 1]);
    expect(vnGroupDate("x")).toBe("");
  });
});

describe("mốc tương lai (đồng hồ lệch) → kẹp về hiện tại", () => {
  it("tiêu đề nhóm và nhãn cùng là hôm nay", () => {
    const [g] = groupByVnDay(["2026-10-08T20:00:00.000Z"], (s) => s, NOW);
    expect(vnGroupDate(g.iso)).toBe("8/10/2026");
    expect(vnRelativeDayLabel(g.iso, NOW)).toBe("Hôm nay");
  });
});
