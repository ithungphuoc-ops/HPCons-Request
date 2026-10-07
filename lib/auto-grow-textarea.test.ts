import { describe, expect, it } from "vitest";
import { computeAutoGrowHeight } from "./auto-grow-textarea";

// Ô bảng: chữ 20px/dòng, đệm 7px×2, viền 1px×2 → 1 dòng = 36px (đúng h-9 cũ).
const base = { lineHeight: 20, paddingY: 14, borderY: 2, maxRows: 6 };

describe("computeAutoGrowHeight — ô bảng tự giãn tối đa 6 dòng (07/10/2026)", () => {
  it("1 dòng (hoặc ô trống) giữ đúng 36px như ô cũ, không cuộn", () => {
    expect(computeAutoGrowHeight({ ...base, scrollHeight: 34 })).toEqual({ height: 36, scroll: false });
    expect(computeAutoGrowHeight({ ...base, scrollHeight: 0 })).toEqual({ height: 36, scroll: false });
  });

  it("3 dòng → cao theo nội dung, không cuộn", () => {
    expect(computeAutoGrowHeight({ ...base, scrollHeight: 3 * 20 + 14 })).toEqual({ height: 76, scroll: false });
  });

  it("đúng 6 dòng → tối đa, chưa cuộn", () => {
    expect(computeAutoGrowHeight({ ...base, scrollHeight: 6 * 20 + 14 })).toEqual({ height: 136, scroll: false });
  });

  it("quá 6 dòng → đứng ở 6 dòng và cuộn trong ô", () => {
    expect(computeAutoGrowHeight({ ...base, scrollHeight: 9 * 20 + 14 })).toEqual({ height: 136, scroll: true });
  });

  it("maxRows < 1 được coi như 1", () => {
    expect(computeAutoGrowHeight({ ...base, maxRows: 0, scrollHeight: 74 })).toEqual({ height: 36, scroll: true });
  });
});
