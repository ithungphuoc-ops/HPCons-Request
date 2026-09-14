import { describe, expect, it } from "vitest";
import {
  formatCellForDisplay,
  isValidCellValue,
  numericTypeForFieldDataType,
  parseCellToRaw,
} from "./table-field";
import { fieldDataTypeLabels, type FieldDataType } from "./types";

describe("numericTypeForFieldDataType", () => {
  it("nối 3 kiểu trường số sang đúng kiểu cột tương ứng", () => {
    expect(numericTypeForFieldDataType("currency")).toBe("money");
    expect(numericTypeForFieldDataType("integer")).toBe("int");
    expect(numericTypeForFieldDataType("decimal")).toBe("decimal");
  });

  it("mọi kiểu trường KHÔNG phải số đều trả null", () => {
    // Quét toàn bộ union thay vì liệt kê tay: thêm kiểu mới vào FieldDataType
    // mà quên xét ở đây thì test này hỏng ngay, không âm thầm lọt.
    const numeric: FieldDataType[] = ["currency", "integer", "decimal"];
    const all = Object.keys(fieldDataTypeLabels) as FieldDataType[];
    for (const t of all.filter((x) => !numeric.includes(x))) {
      expect(numericTypeForFieldDataType(t), `kiểu "${t}"`).toBeNull();
    }
  });

  it("bao phủ đủ mọi kiểu trường đang khai báo", () => {
    const all = Object.keys(fieldDataTypeLabels) as FieldDataType[];
    expect(all.length).toBeGreaterThan(10);
    for (const t of all) {
      expect(() => numericTypeForFieldDataType(t)).not.toThrow();
    }
  });
});

describe("trường Tiền tệ đứng riêng hiển thị GIỐNG cột bảng kiểu tiền tệ", () => {
  const money = numericTypeForFieldDataType("currency")!;

  it("ngăn hàng nghìn bằng dấu phẩy và tự thêm VNĐ", () => {
    expect(formatCellForDisplay("74610000", money)).toBe("74,610,000 VNĐ");
    expect(formatCellForDisplay("1000", money)).toBe("1,000 VNĐ");
    expect(formatCellForDisplay("999", money)).toBe("999 VNĐ");
  });

  it("rỗng thì để trống, không hiện '0 VNĐ'", () => {
    expect(formatCellForDisplay("", money)).toBe("");
  });

  it("tiền VNĐ làm tròn về số nguyên, không có phần lẻ", () => {
    // Đồng Việt Nam không có đơn vị nhỏ hơn nên kiểu "money" đặt số chữ số
    // thập phân tối đa = 0. Đây là hành vi CỐ Ý, giống hệt cột bảng kiểu tiền
    // tệ — ghi lại thành test để sau không ai "sửa" nhầm thành 2 chữ số.
    expect(formatCellForDisplay("1234.5", money)).toBe("1,235 VNĐ");
    expect(formatCellForDisplay("1234.4", money)).toBe("1,234 VNĐ");
  });
});

describe("Số nguyên / Số thập phân cũng được ngăn hàng nghìn", () => {
  it("số nguyên: có dấu phẩy, KHÔNG có đuôi VNĐ", () => {
    const int = numericTypeForFieldDataType("integer")!;
    expect(formatCellForDisplay("340000", int)).toBe("340,000");
    expect(formatCellForDisplay("340000", int)).not.toContain("VNĐ");
  });

  it("số thập phân giữ phần lẻ", () => {
    const dec = numericTypeForFieldDataType("decimal")!;
    expect(formatCellForDisplay("2.5", dec)).toBe("2.5");
    expect(formatCellForDisplay("12345.75", dec)).toBe("12,345.75");
  });
});

describe("gõ vào rồi rời ô — đúng vòng đời của NumericFieldInput", () => {
  const money = numericTypeForFieldDataType("currency")!;

  it("gõ có sẵn dấu phẩy vẫn hiểu đúng, không mất chữ số", () => {
    const raw = parseCellToRaw("74,610,000", money);
    expect(raw).toBe("74610000");
    expect(Number(raw)).toBe(74610000);
    expect(formatCellForDisplay(raw, money)).toBe("74,610,000 VNĐ");
  });

  it("gõ kiểu Việt Nam '2,5' được hiểu là 2.5 chứ không phải 25", () => {
    expect(parseCellToRaw("2,5", money)).toBe("2.5");
  });

  it("gõ chữ bậy thì KHÔNG hợp lệ, phần kiểm tra lúc gửi sẽ chặn", () => {
    expect(isValidCellValue(parseCellToRaw("abc", money), money)).toBe(false);
    expect(isValidCellValue(parseCellToRaw("-500", money), money)).toBe(false);
  });

  it("số nguyên không nhận phần thập phân", () => {
    const int = numericTypeForFieldDataType("integer")!;
    expect(isValidCellValue("10", int)).toBe(true);
    expect(isValidCellValue("10.5", int)).toBe(false);
  });
});
