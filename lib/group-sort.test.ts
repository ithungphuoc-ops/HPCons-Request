import { describe, expect, it } from "vitest";
import { compareGroupNames, leadingNumber, sortGroupsByNumber } from "./group-sort";

describe("leadingNumber", () => {
  it("đọc số đầu tên nhóm", () => {
    expect(leadingNumber("1.0. Phiếu đề nghị (HPCons)")).toEqual([1, 0]);
    expect(leadingNumber("0. Đề xuất trực tiếp")).toEqual([0]);
    expect(leadingNumber("12.3 Tên")).toEqual([12, 3]);
    expect(leadingNumber("Phiếu không số")).toBeNull();
    expect(leadingNumber("2026 Kế hoạch")).toEqual([2026]);
    expect(leadingNumber("1.0.Phiếu dính chữ")).toBeNull();
  });
});

describe("sortGroupsByNumber", () => {
  it("xếp đúng như danh sách HPCons Sếp gửi 05/10/2026", () => {
    const names = [
      "7.0. Xét duyệt báo giá NCC",
      "1.2. Phiếu luân chuyển (HPCons)",
      "3.0. Tạm ứng chi phí (HPCons)",
      "5.0. Thanh toán NTP (HPCons)",
      "1.0. Phiếu đề nghị (HPCons)",
      "1.1. PDN Thiết bị IT - Phòng CNTT",
      "0. Đề xuất trực tiếp (HPCons)",
      "2.2. BKTT - USER (HPCons)",
      "3.1. Tạm ứng Ký quỹ (HPCons)",
      "4.1. Đặt cọc NCC (HPCons)",
      "4.1. Đặt cọc NTP (HPCons)",
    ];
    expect(sortGroupsByNumber(names.map((name) => ({ name }))).map((g) => g.name)).toEqual([
      "0. Đề xuất trực tiếp (HPCons)",
      "1.0. Phiếu đề nghị (HPCons)",
      "1.1. PDN Thiết bị IT - Phòng CNTT",
      "1.2. Phiếu luân chuyển (HPCons)",
      "2.2. BKTT - USER (HPCons)",
      "3.0. Tạm ứng chi phí (HPCons)",
      "3.1. Tạm ứng Ký quỹ (HPCons)",
      "4.1. Đặt cọc NCC (HPCons)",
      "4.1. Đặt cọc NTP (HPCons)",
      "5.0. Thanh toán NTP (HPCons)",
      "7.0. Xét duyệt báo giá NCC",
    ]);
  });

  it("so số chứ không so chữ (10 sau 9), nhóm không số xếp cuối theo chữ cái", () => {
    const sorted = sortGroupsByNumber([{ name: "Zeta" }, { name: "10. Mười" }, { name: "Alpha" }, { name: "9. Chín" }, { name: "1. Một" }, { name: "1.0. Một chấm không" }]);
    expect(sorted.map((g) => g.name)).toEqual(["1. Một", "1.0. Một chấm không", "9. Chín", "10. Mười", "Alpha", "Zeta"]);
  });

  it("không sửa mảng gốc", () => {
    const groups = [{ name: "2. B" }, { name: "1. A" }];
    sortGroupsByNumber(groups);
    expect(groups.map((g) => g.name)).toEqual(["2. B", "1. A"]);
  });

  it("so sánh trùng số theo tên", () => {
    expect(compareGroupNames("4.1. Đặt cọc NCC", "4.1. Đặt cọc NTP")).toBeLessThan(0);
  });
});
