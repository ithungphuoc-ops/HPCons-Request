import { describe, expect, it } from "vitest";
import {
  formatCellForDisplay,
  isNumericColumnType,
  isValidCellValue,
  parseCellToRaw,
  resolveTableColumnTypes,
  sumColumn,
} from "./table-field";

// Kiểu dữ liệu cột bảng — Sếp chốt 13/09/2026. Nguyên tắc xuyên suốt: ô LƯU SỐ
// THÔ, chỉ định dạng lúc hiển thị (xem chú thích đầu lib/table-field.ts).

describe("resolveTableColumnTypes — tương thích ngược cho nhóm cũ", () => {
  it("chưa khai kiểu: cột thường là văn bản, riêng 'Số lượng' là số thập phân", () => {
    expect(resolveTableColumnTypes(["Tên hàng", "Số lượng", "ĐVT"])).toEqual([
      "text",
      "decimal",
      "text",
    ]);
  });

  it("không phân biệt hoa thường / khoảng trắng thừa ở tên cột 'Số lượng'", () => {
    expect(resolveTableColumnTypes(["  SỐ LƯỢNG  "])).toEqual(["decimal"]);
  });

  it("đã khai kiểu thì dùng đúng kiểu khai", () => {
    expect(resolveTableColumnTypes(["Đơn giá", "Ghi chú"], ["money", "text"])).toEqual([
      "money",
      "text",
    ]);
  });

  it("mảng kiểu ngắn hơn (admin vừa thêm cột) — cột thiếu tự suy ra", () => {
    expect(resolveTableColumnTypes(["Đơn giá", "Số lượng", "Ghi chú"], ["money"])).toEqual([
      "money",
      "decimal",
      "text",
    ]);
  });

  it("giá trị lạ do client gửi bậy -> bỏ qua, suy ra lại", () => {
    expect(resolveTableColumnTypes(["Ghi chú"], ["hack" as never])).toEqual(["text"]);
  });
});

describe("parseCellToRaw — bóc về số thô", () => {
  it("bỏ dấu phẩy ngăn nghìn và đuôi tiền tệ", () => {
    expect(parseCellToRaw("1,234,567 VNĐ", "money")).toBe("1234567");
    expect(parseCellToRaw("1,234,567.89", "decimal")).toBe("1234567.89");
    expect(parseCellToRaw("12.5%", "percent")).toBe("12.5");
  });

  it("dấu phẩy kiểu Việt trong DỮ LIỆU CŨ ('2,5') là thập phân, không phải ngăn nghìn", () => {
    expect(parseCellToRaw("2,5", "decimal")).toBe("2.5");
    expect(parseCellToRaw("12,75", "decimal")).toBe("12.75");
  });

  it("cột văn bản giữ nguyên, không bóc gì (kể cả khoảng trắng giữa chữ)", () => {
    expect(parseCellToRaw("Tole sàn deck", "text")).toBe("Tole sàn deck");
    expect(parseCellToRaw("1,5 ly", "text")).toBe("1,5 ly");
  });
});

describe("isValidCellValue", () => {
  it("ô rỗng luôn hợp lệ (bắt buộc là luật riêng)", () => {
    expect(isValidCellValue("", "money")).toBe(true);
  });

  it("số nguyên không nhận phần thập phân", () => {
    expect(isValidCellValue("12", "int")).toBe(true);
    expect(isValidCellValue("12.5", "int")).toBe(false);
  });

  it("không nhận chữ, không nhận số âm", () => {
    expect(isValidCellValue("file đính kèm", "decimal")).toBe(false);
    expect(isValidCellValue("-5", "decimal")).toBe(false);
  });

  it("cột văn bản nhận mọi thứ", () => {
    expect(isValidCellValue("file đính kèm", "text")).toBe(true);
  });
});

describe("formatCellForDisplay — dấu phẩy ngăn nghìn, dấu chấm thập phân", () => {
  it("tiền tệ: không số lẻ, có đuôi VNĐ", () => {
    expect(formatCellForDisplay("1234567", "money")).toBe("1,234,567 VNĐ");
  });

  it("số thập phân: tối đa 3 chữ số sau dấu chấm", () => {
    expect(formatCellForDisplay("1234567.891", "decimal")).toBe("1,234,567.891");
    expect(formatCellForDisplay("2.5", "decimal")).toBe("2.5");
  });

  it("số nguyên và phần trăm", () => {
    expect(formatCellForDisplay("1250", "int")).toBe("1,250");
    expect(formatCellForDisplay("12.5", "percent")).toBe("12.5%");
  });

  it("cột văn bản và giá trị không phải số trả nguyên si (không nuốt dữ liệu cũ)", () => {
    expect(formatCellForDisplay("Tole sàn deck", "text")).toBe("Tole sàn deck");
    expect(formatCellForDisplay("file đính kèm", "decimal")).toBe("file đính kèm");
    expect(formatCellForDisplay("", "money")).toBe("");
  });
});

describe("sumColumn", () => {
  it("cộng đúng, bỏ qua ô rỗng và ô không phải số", () => {
    const rows = [
      ["A", "1000"],
      ["B", ""],
      ["C", "2500"],
      ["D", "file đính kèm"],
    ];
    expect(sumColumn(rows, 1)).toBe(3500);
  });

  it("không có ô nào cộng được -> null (không hiện dòng tổng bằng 0)", () => {
    expect(sumColumn([["A", ""]], 1)).toBeNull();
  });
});

describe("isNumericColumnType", () => {
  it("chỉ văn bản là không phải số", () => {
    expect(isNumericColumnType("text")).toBe(false);
    expect(isNumericColumnType("int")).toBe(true);
    expect(isNumericColumnType("money")).toBe(true);
  });
});
