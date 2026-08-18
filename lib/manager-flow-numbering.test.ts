import { describe, expect, it } from "vitest";
import { computeManagerFlowNumbers } from "./manager-flow-numbering";

describe("computeManagerFlowNumbers", () => {
  it("đánh số liên tiếp 1,2,3... khi TẤT CẢ bước đều là submitter_manager", () => {
    const steps = [
      { index: 0, kind: "submitter_manager" },
      { index: 1, kind: "submitter_manager" },
      { index: 2, kind: "submitter_manager" },
    ];
    const result = computeManagerFlowNumbers(steps);
    expect(result.get(0)).toBe(1);
    expect(result.get(1)).toBe(2);
    expect(result.get(2)).toBe(3);
  });

  // Đúng kịch bản lỗi thật đã bị 4 agent code review phát hiện độc lập
  // (18/08/2026): bước "fixed" xen giữa/đứng trước làm số bị nhảy cóc nếu
  // đếm nhầm cả bước đó.
  it("BUG ĐÃ SỬA: bỏ qua bước 'fixed' khi đánh số, không để số nhảy cóc", () => {
    const steps = [
      { index: 0, kind: "fixed" }, // vd "Kế toán trưởng" — không phải luồng quản lý
      { index: 1, kind: "submitter_manager" },
      { index: 2, kind: "fixed" },
      { index: 3, kind: "submitter_manager" },
    ];
    const result = computeManagerFlowNumbers(steps);
    // Bước fixed KHÔNG được chiếm số thứ tự nào cả.
    expect(result.has(0)).toBe(false);
    expect(result.has(2)).toBe(false);
    // 2 bước submitter_manager phải ra đúng 1 và 2 liên tiếp — TRƯỚC KHI SỬA,
    // bug cũ sẽ ra 2 và 4 (đếm nhầm cả 2 bước fixed).
    expect(result.get(1)).toBe(1);
    expect(result.get(3)).toBe(2);
  });

  it("bước 'fixed' nhiều người sinh nhiều dòng CÙNG index — không tính trùng thành nhiều số", () => {
    // resolveApproverStepsDetailed: "fixed" nhiều người → nhiều phần tử
    // trong mảng nhưng CÙNG 1 step.index (xem comment gốc trong submit/page.tsx).
    const steps = [
      { index: 0, kind: "fixed" },
      { index: 0, kind: "fixed" }, // người thứ 2 của cùng bước fixed
      { index: 1, kind: "submitter_manager" },
    ];
    const result = computeManagerFlowNumbers(steps);
    expect(result.get(1)).toBe(1);
    expect(result.size).toBe(1);
  });

  it("mảng rỗng → Map rỗng, không lỗi", () => {
    expect(computeManagerFlowNumbers([]).size).toBe(0);
  });

  it("không có bước submitter_manager nào → Map rỗng", () => {
    const steps = [
      { index: 0, kind: "fixed" },
      { index: 1, kind: "fixed" },
    ];
    expect(computeManagerFlowNumbers(steps).size).toBe(0);
  });
});
