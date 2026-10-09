import { describe, expect, it } from "vitest";
import { BUSINESS_DAY_MINUTES } from "./business-hours";
import {
  businessLatenessMinutes,
  currentApproverNames,
  formatBusinessLateness,
  formatVnDeadlineShort,
  overduePillInfo,
} from "./request-overdue";
import type { RequestInstance } from "./types";

/** Mốc viết theo GIỜ VIỆT NAM tường minh — kết quả như nhau dù máy chạy test ở múi nào. */
const vn = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h - 7, mi);
const iso = (t: number) => new Date(t).toISOString();

// 05/10/2026 là Thứ 2; 10/10 Thứ 7; 11/10 Chủ nhật; 12/10 Thứ 2.
const MON = (h: number, mi = 0) => vn(2026, 10, 5, h, mi);
const TUE = (h: number, mi = 0) => vn(2026, 10, 6, h, mi);
const SAT = (h: number, mi = 0) => vn(2026, 10, 10, h, mi);
const SUN = (h: number, mi = 0) => vn(2026, 10, 11, h, mi);
const NEXT_MON = (h: number, mi = 0) => vn(2026, 10, 12, h, mi);

function makeRequest(patch: Partial<RequestInstance> = {}): RequestInstance {
  return {
    status: "pending",
    approvalFlow: "sequential",
    approvers: [
      { id: "u1", decision: "approved" },
      { id: "u2", decision: "pending" },
      { id: "u3", decision: "pending" },
    ],
    approversSnapshot: [
      { id: "u1", name: "Nguyễn Văn A" },
      { id: "u2", name: "Trần Thị B" },
      { id: "u3", name: "Lê Văn C" },
    ],
    deadlineAt: iso(MON(9)),
    ...patch,
  } as RequestInstance;
}

describe("1 ngày làm việc", () => {
  it("= 8,5 giờ (7:45–12:00 + 13:00–17:15)", () => {
    expect(BUSINESS_DAY_MINUTES).toBe(510);
  });
  it("mốc test: 05/10/2026 là Thứ 2, 11/10 là Chủ nhật (giờ VN)", () => {
    expect(new Date(MON(12) + 7 * 3600_000).getUTCDay()).toBe(1);
    expect(new Date(SUN(12) + 7 * 3600_000).getUTCDay()).toBe(0);
  });
});

describe("businessLatenessMinutes", () => {
  it("trong cùng buổi sáng", () => {
    expect(businessLatenessMinutes(iso(MON(9)), MON(9, 45))).toBe(45);
  });
  it("trừ giờ nghỉ trưa", () => {
    // 11:00 → 14:00: 60' sáng + 60' chiều.
    expect(businessLatenessMinutes(iso(MON(11)), MON(14))).toBe(120);
  });
  it("ngoài giờ buổi tối không tính thêm", () => {
    // 16:15 → 21:00 cùng ngày: chỉ 16:15–17:15.
    expect(businessLatenessMinutes(iso(MON(16, 15)), MON(21))).toBe(60);
  });
  it("qua đêm: chiều hôm trước tới sáng hôm sau", () => {
    // 17:00 T2 → 8:45 T3: 15' + 60'.
    expect(businessLatenessMinutes(iso(MON(17)), TUE(8, 45))).toBe(75);
  });
  it("Thứ 7 là ngày làm việc, Chủ nhật nghỉ", () => {
    // 16:15 T7 → 8:45 T2 tuần sau: 60' (T7) + 0 (CN) + 60' (T2).
    expect(businessLatenessMinutes(iso(SAT(16, 15)), NEXT_MON(8, 45))).toBe(120);
    // Đang Chủ nhật: chỉ tính phần còn lại của T7.
    expect(businessLatenessMinutes(iso(SAT(16, 15)), SUN(15))).toBe(60);
  });
  it("hạn rơi vào ngoài giờ (nhóm SLA giờ đồng hồ) — đếm từ đầu giờ làm việc kế tiếp", () => {
    // Hạn 22:00 T2 → 9:45 T3: 7:45–9:45 = 120'.
    expect(businessLatenessMinutes(iso(MON(22)), TUE(9, 45))).toBe(120);
  });
  it("chưa tới hạn / hạn hỏng → 0", () => {
    expect(businessLatenessMinutes(iso(MON(10)), MON(9))).toBe(0);
    expect(businessLatenessMinutes("khong-phai-ngay", MON(9))).toBe(0);
  });
  it("trọn 1 ngày làm việc", () => {
    expect(businessLatenessMinutes(iso(MON(9)), TUE(9))).toBe(510);
  });
});

describe("formatBusinessLateness", () => {
  it.each([
    [0, "Vừa trễ hạn"],
    [1, "Trễ 1 phút"],
    [45, "Trễ 45 phút"],
    [59, "Trễ 59 phút"],
    [60, "Trễ 1 giờ"],
    [4 * 60 + 30, "Trễ 4 giờ"],
    [509, "Trễ 8 giờ"],
    [510, "Trễ 1 ngày"],
    [510 + 3 * 60 + 20, "Trễ 1 ngày 3 giờ"],
    [2 * 510 + 59, "Trễ 2 ngày"],
  ])("%i phút → %s", (minutes, label) => {
    expect(formatBusinessLateness(minutes)).toBe(label);
  });
});

describe("formatVnDeadlineShort", () => {
  it("theo giờ VN dd/MM HH:mm", () => {
    expect(formatVnDeadlineShort(iso(vn(2026, 10, 8, 8, 30)))).toBe("08/10 08:30");
  });
  it("hạn hỏng → —", () => {
    expect(formatVnDeadlineShort("abc")).toBe("—");
  });
});

describe("currentApproverNames", () => {
  it("lần lượt: chỉ người đầu tiên còn chờ", () => {
    expect(currentApproverNames(makeRequest())).toEqual(["Trần Thị B"]);
  });
  it("đồng thời: mọi người còn chờ", () => {
    expect(currentApproverNames(makeRequest({ approvalFlow: "concurrent" }))).toEqual(["Trần Thị B", "Lê Văn C"]);
  });
});

describe("overduePillInfo — khi nào hiện nhãn", () => {
  it("đang chờ duyệt + đã quá hạn → có nhãn đủ 3 thông tin", () => {
    // Hạn 9:00 T2, xem lúc 13:00 T3: T2 180' + 255' + T3 sáng 255' = 690' = 1 ngày 3 giờ.
    const info = overduePillInfo(makeRequest(), TUE(13));
    expect(info).toEqual({
      label: "Trễ 1 ngày 3 giờ",
      deadlineText: "Hạn duyệt: 05/10 09:00",
      waitingText: "Đang chờ: Trần Thị B",
    });
  });
  it("chưa tới hạn → không có nhãn", () => {
    expect(overduePillInfo(makeRequest(), MON(8))).toBeNull();
  });
  it("đã xử lý xong / nháp / bị trả lại → không có nhãn dù quá hạn", () => {
    for (const status of ["approved", "rejected", "returned", "draft"]) {
      expect(overduePillInfo(makeRequest({ status } as Partial<RequestInstance>), TUE(13))).toBeNull();
    }
  });
  it("không có hạn → không có nhãn", () => {
    expect(overduePillInfo(makeRequest({ deadlineAt: null }), TUE(13))).toBeNull();
  });
  it("quá hạn ngoài giờ làm việc (chưa trôi phút làm việc nào) → 'Vừa trễ hạn'", () => {
    const info = overduePillInfo(makeRequest({ deadlineAt: iso(MON(17, 15)) }), MON(20));
    expect(info?.label).toBe("Vừa trễ hạn");
  });
});
