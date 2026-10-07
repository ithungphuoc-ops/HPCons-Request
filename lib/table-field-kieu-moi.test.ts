import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  describeInvalidImportedCells,
  filterNumericInput,
  filterTableColumnTypeGroups,
  formatCellForDisplay,
  formatCellForReading,
  invalidCellReason,
  isNumericColumnType,
  isDateCellShape,
  isTableCellEmpty,
  isValidCellValue,
  joinMultiChoiceCell,
  normalizeChoiceCell,
  normalizeTableColumnOptionsForStorage,
  parseCellToRaw,
  parseChoiceOptionsText,
  parseDateCellInput,
  parseImportedCell,
  parseTableImportFile,
  resolveTableColumnOptions,
  resolveTableColumnSum,
  resolveTableColumnTypes,
  splitMultiChoiceCell,
} from "./table-field";
import type { TableColumnType } from "./types";

// 4 kiểu cột bảng mới — Sếp duyệt demo "cot-bang-them-kieu-du-lieu" 07/10/2026.

describe("kiểu cột mới không phải kiểu số", () => {
  it.each(["date", "datetime", "single_choice", "multiple_choice"] as TableColumnType[])("%s", (t) => {
    expect(isNumericColumnType(t)).toBe(false);
    // Không bị lọc mất chữ lúc gõ như ô số.
    expect(filterNumericInput("07/10/2026 abc", t)).toBe("07/10/2026 abc");
  });

  it("4 kiểu số vẫn là số", () => {
    for (const t of ["int", "decimal", "money", "percent"] as TableColumnType[]) {
      expect(isNumericColumnType(t)).toBe(true);
    }
  });

  it("Tổng luôn tắt ở cột ngày/danh sách kể cả khi dữ liệu lưu true", () => {
    expect(
      resolveTableColumnSum(["Ngày", "Chọn"], ["date", "single_choice"], [true, true]),
    ).toEqual([false, false]);
  });

  it("resolveTableColumnTypes giữ nguyên 4 kiểu mới đã khai", () => {
    expect(
      resolveTableColumnTypes(["A", "B", "C", "D"], ["date", "datetime", "single_choice", "multiple_choice"]),
    ).toEqual(["date", "datetime", "single_choice", "multiple_choice"]);
  });
});

describe("filterTableColumnTypeGroups — Lọc nhanh không phân biệt dấu", () => {
  it("rỗng → đủ 4 nhóm", () => {
    expect(filterTableColumnTypeGroups("").map((g) => g.label)).toEqual(["Chữ", "Số", "Ngày", "Danh sách"]);
  });

  it('"ngay" khớp "Ngày", "Ngày giờ"', () => {
    const groups = filterTableColumnTypeGroups("ngay");
    expect(groups.flatMap((g) => g.types)).toEqual(["date", "datetime"]);
  });

  it('"danh sach" khớp cả nhóm Danh sách', () => {
    expect(filterTableColumnTypeGroups("danh sach").flatMap((g) => g.types)).toEqual([
      "single_choice",
      "multiple_choice",
    ]);
  });

  it('"TIEN" khớp Tiền tệ; từ lạ → rỗng', () => {
    expect(filterTableColumnTypeGroups("TIEN").flatMap((g) => g.types)).toEqual(["money"]);
    expect(filterTableColumnTypeGroups("xyz")).toEqual([]);
  });
});

describe("phương án cột Danh sách", () => {
  it("parseChoiceOptionsText: trim, bỏ rỗng, gộp trùng không phân biệt hoa thường", () => {
    expect(parseChoiceOptionsText(" Có , Không,, có ,KHÔNG ")).toEqual(["Có", "Không"]);
    expect(parseChoiceOptionsText("")).toEqual([]);
    expect(parseChoiceOptionsText(undefined)).toEqual([]);
  });

  it("resolveTableColumnOptions: chỉ cột danh sách có phương án; thiếu/lệch → []", () => {
    expect(
      resolveTableColumnOptions(["Tên", "NAS", "Phần mềm"], ["text", "single_choice", "multiple_choice"], [
        "Bỏ qua",
        "Có,Không",
        "Base, NAS",
      ]),
    ).toEqual([[], ["Có", "Không"], ["Base", "NAS"]]);
    // Nhóm cũ không có tableColumnOptions.
    expect(resolveTableColumnOptions(["Tên hàng", "Số lượng"], undefined, undefined)).toEqual([[], []]);
    // Lệch độ dài (vừa thêm cột).
    expect(resolveTableColumnOptions(["A", "B"], ["single_choice", "single_choice"], ["X,Y"])).toEqual([
      ["X", "Y"],
      [],
    ]);
  });

  it("normalizeTableColumnOptionsForStorage: đúng độ dài, cột khác để rỗng", () => {
    expect(
      normalizeTableColumnOptionsForStorage(["A", "B", "C"], ["single_choice", "text", "multiple_choice"], [
        " Có ,Không ",
        "rác",
      ]),
    ).toEqual(["Có,Không", "", ""]);
  });

  it("joinMultiChoiceCell theo thứ tự admin khai, giữ phương án lạ ở cuối", () => {
    const options = ["Base", "Email công ty", "NAS"];
    expect(joinMultiChoiceCell(["NAS", "Base"], options)).toBe("Base, NAS");
    expect(joinMultiChoiceCell(["Cũ", "NAS"], options)).toBe("NAS, Cũ");
    expect(joinMultiChoiceCell([], options)).toBe("");
    expect(splitMultiChoiceCell("Base, NAS")).toEqual(["Base", "NAS"]);
    expect(splitMultiChoiceCell("")).toEqual([]);
  });

  it("isValidCellValue / invalidCellReason cho danh sách", () => {
    const opts = ["Có", "Không"];
    expect(isValidCellValue("Có", "single_choice", opts)).toBe(true);
    expect(isValidCellValue("có", "single_choice", opts)).toBe(false);
    expect(invalidCellReason("Lạ", "single_choice", opts)).toBe("phải là một phương án trong danh sách");
    expect(isValidCellValue("Có, Không", "multiple_choice", opts)).toBe(true);
    expect(invalidCellReason("Có, Lạ", "multiple_choice", opts)).toBe("chỉ được chọn các phương án trong danh sách");
    // Ô rỗng luôn hợp lệ ở đây (bắt buộc là luật riêng).
    expect(isValidCellValue("", "multiple_choice", opts)).toBe(true);
    // Chưa có phương án (dữ liệu lệch) → không có gì để đối chiếu.
    expect(isValidCellValue("Gì cũng được", "single_choice", [])).toBe(true);
  });

  it("normalizeChoiceCell (nhập file): khớp không phân biệt hoa thường → đúng chữ phương án", () => {
    const opts = ["Có", "Không"];
    expect(normalizeChoiceCell("  có ", "single_choice", opts)).toBe("Có");
    expect(normalizeChoiceCell("Lạ", "single_choice", opts)).toBe("Lạ");
    const sw = ["Base", "Email công ty", "NAS"];
    expect(normalizeChoiceCell("nas, base", "multiple_choice", sw)).toBe("Base, NAS");
    // Phương án được chứa ";" (chỉ cấm dấu phẩy) — không tách theo ";".
    expect(normalizeChoiceCell("ca 1; ca 2, nas", "multiple_choice", ["Ca 1; ca 2", "NAS"])).toBe("Ca 1; ca 2, NAS");
    expect(parseChoiceOptionsText("Sáng; chiều,Tối")).toEqual(["Sáng; chiều", "Tối"]);
    expect(normalizeChoiceCell("NAS\nEMAIL CÔNG TY", "multiple_choice", sw)).toBe("Email công ty, NAS");
    expect(normalizeChoiceCell("NAS, Lạ", "multiple_choice", sw)).toBe("NAS, Lạ");
  });

  it("formatCellForDisplay nhiều lựa chọn → 'A, B'", () => {
    expect(formatCellForDisplay("Base,NAS", "multiple_choice")).toBe("Base, NAS");
    expect(formatCellForDisplay("Có", "single_choice")).toBe("Có");
  });
});

describe("cột Ngày / Ngày giờ", () => {
  it("parseDateCellInput: dd/MM/yyyy và ISO → chuẩn lưu", () => {
    expect(parseDateCellInput("07/10/2026", "date")).toBe("2026-10-07");
    expect(parseDateCellInput("7/1/2026", "date")).toBe("2026-01-07");
    expect(parseDateCellInput("07-10-2026", "date")).toBe("2026-10-07");
    expect(parseDateCellInput("2026-10-07", "date")).toBe("2026-10-07");
    expect(parseDateCellInput("2026-10-07T08:30", "date")).toBe("2026-10-07");
    expect(parseDateCellInput("07/10/2026 08:30", "datetime")).toBe("2026-10-07T08:30");
    expect(parseDateCellInput("2026-10-07T08:30:15", "datetime")).toBe("2026-10-07T08:30");
    expect(parseDateCellInput("07/10/2026", "datetime")).toBe("2026-10-07T00:00");
    expect(parseDateCellInput("", "date")).toBe("");
  });

  it("parseDateCellInput: ngày không có thật / chữ lạ → giữ nguyên để báo lỗi", () => {
    expect(parseDateCellInput("31/02/2026", "date")).toBe("31/02/2026");
    expect(parseDateCellInput("hôm qua", "date")).toBe("hôm qua");
    expect(parseDateCellInput("07/10/2026 25:00", "datetime")).toBe("07/10/2026 25:00");
    // Số ngày kiểu Excel chỉ nhận khi nhập file.
    expect(parseDateCellInput("46302", "date")).toBe("46302");
  });

  it("parseDateCellInput: số ngày kiểu Excel khi nhập file", () => {
    expect(parseDateCellInput("46302", "date", true)).toBe("2026-10-07");
    expect(parseDateCellInput("46302.5", "datetime", true)).toBe("2026-10-07T12:00");
  });

  it("parseCellToRaw dùng chung cho ô ngày", () => {
    expect(parseCellToRaw(" 07/10/2026 ", "date")).toBe("2026-10-07");
    expect(parseCellToRaw(" Có ", "single_choice")).toBe("Có");
  });

  it("isValidCellValue / invalidCellReason cho ngày", () => {
    expect(isValidCellValue("2026-10-07", "date")).toBe(true);
    expect(isValidCellValue("2026-02-29", "date")).toBe(false);
    expect(isValidCellValue("2028-02-29", "date")).toBe(true);
    expect(isValidCellValue("07/10/2026", "date")).toBe(false);
    expect(invalidCellReason("abc", "date")).toBe("phải là ngày hợp lệ (dd/mm/yyyy)");
    expect(isValidCellValue("2026-10-07T08:30", "datetime")).toBe(true);
    expect(isValidCellValue("2026-10-07", "datetime")).toBe(false);
    expect(invalidCellReason("2026-10-07T24:00", "datetime")).toBe("phải là ngày giờ hợp lệ (dd/mm/yyyy hh:mm)");
  });

  it("formatCellForDisplay: dd/MM/yyyy (+ HH:mm), sai định dạng trả nguyên", () => {
    expect(formatCellForDisplay("2026-10-07", "date")).toBe("07/10/2026");
    expect(formatCellForDisplay("2026-10-07T08:05", "datetime")).toBe("07/10/2026 08:05");
    expect(formatCellForDisplay("chữ cũ", "date")).toBe("chữ cũ");
    expect(formatCellForDisplay("", "date")).toBe("");
  });
});

describe("invalidCellReason — câu cũ của cột số giữ nguyên", () => {
  it("số nguyên / số", () => {
    expect(invalidCellReason("1.5", "int")).toBe("phải là số nguyên");
    expect(invalidCellReason("abc", "decimal")).toBe("phải là số");
    expect(invalidCellReason("abc", "money")).toBe("phải là số");
    expect(invalidCellReason("12", "int")).toBeNull();
    expect(invalidCellReason("gì cũng được", "text")).toBeNull();
  });
});

describe("formatCellForReading — xem chi tiết / xuất Excel/Word", () => {
  it("định dạng theo kiểu, chữ chỉ bỏ dòng trắng cuối", () => {
    expect(formatCellForReading("2026-10-07", "date")).toBe("07/10/2026");
    expect(formatCellForReading("Base,NAS", "multiple_choice")).toBe("Base, NAS");
    expect(formatCellForReading("1234567", "money")).toBe("1,234,567 VNĐ");
    expect(formatCellForReading("Dòng 1\nDòng 2\n\n", "text")).toBe("Dòng 1\nDòng 2");
    expect(formatCellForReading("Có ", "single_choice")).toBe("Có");
    expect(formatCellForReading("x", undefined)).toBe("x");
  });
});

describe("nhập file Excel vào bảng có cột kiểu mới", () => {
  const columns = ["Họ và tên", "Ngày sinh", "Có dùng NAS không?", "Phần mềm cần cấp"];
  const types: TableColumnType[] = ["text", "date", "single_choice", "multiple_choice"];
  const options = ["", "", "Có,Không", "Base,Email công ty,NAS"];

  it("parseImportedCell", () => {
    expect(parseImportedCell("07/10/2026", "date")).toBe("2026-10-07");
    expect(parseImportedCell("có", "single_choice", ["Có", "Không"])).toBe("Có");
    expect(parseImportedCell("1,234", "money")).toBe("1234");
  });

  it("describeInvalidImportedCells chỉ báo ô Ngày/Danh sách sai", () => {
    const { messages, count } = describeInvalidImportedCells(
      [
        ["A", "2026-10-07", "Có", "Base"],
        ["B", "31/02/2026", "Lạ", ""],
      ],
      columns,
      types,
      resolveTableColumnOptions(columns, types, options),
    );
    expect(count).toBe(2);
    expect(messages[0]).toBe('Dòng 2 trong file, cột "Ngày sinh": "31/02/2026" phải là ngày hợp lệ (dd/mm/yyyy).');
    expect(messages[1]).toContain('cột "Có dùng NAS không?": "Lạ"');
  });

  it("parseTableImportFile: đổi ngày/khớp phương án, báo ô không hiểu được", async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      columns,
      ["Nguyễn Văn A", "07/10/2026", "có", "nas, base"],
      ["Trần Thị B", "hôm qua", "Không", "Lạ"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mẫu");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const file = { arrayBuffer: async () => buffer } as unknown as File;

    const result = await parseTableImportFile(file, columns, types, options);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newRows[0]).toEqual(["Nguyễn Văn A", "2026-10-07", "Có", "Base, NAS"]);
    expect(result.newRows[1]).toEqual(["Trần Thị B", "hôm qua", "Không", "Lạ"]);
    expect(result.invalidCellCount).toBe(2);
  });
});

describe("sửa theo review PR #90", () => {
  it("resolveTableColumnTypes không nhận thuộc tính kế thừa ('constructor', 'toString')", () => {
    expect(
      resolveTableColumnTypes(["A", "Số lượng"], ["constructor", "toString"] as unknown as TableColumnType[]),
    ).toEqual(["text", "decimal"]);
  });

  it("isDateCellShape: chỉ kiểm hình dạng — '0002-10-07' (đang gõ năm) vẫn giữ trong ô", () => {
    expect(isDateCellShape("0002-10-07", "date")).toBe(true);
    expect(isValidCellValue("0002-10-07", "date")).toBe(false);
    expect(isDateCellShape("0020-10-07T08:30", "datetime")).toBe(true);
    expect(isDateCellShape("07/10/2026", "date")).toBe(false);
    expect(isDateCellShape("", "date")).toBe(false);
  });

  it("isTableCellEmpty: ô nhiều lựa chọn chỉ có dấu phẩy là trống", () => {
    expect(isTableCellEmpty(",", "multiple_choice")).toBe(true);
    expect(isTableCellEmpty(" , ", "multiple_choice")).toBe(true);
    expect(isTableCellEmpty("NAS", "multiple_choice")).toBe(false);
    expect(isTableCellEmpty(",", "text")).toBe(false);
    expect(isTableCellEmpty("  ", "text")).toBe(true);
  });

  it("số seri Excel: chỉ khi ô nguồn là ô số và ≥ 3000", () => {
    expect(parseImportedCell("2026", "date", [], false)).toBe("2026");
    expect(parseImportedCell("2026", "date", [], true)).toBe("2026");
    expect(parseImportedCell("46302", "date", [], false)).toBe("46302");
    expect(parseImportedCell("46302", "date", [], true)).toBe("2026-10-07");
  });

  async function importCsv(text: string, cols: string[], types: TableColumnType[]) {
    const bytes = new TextEncoder().encode(text);
    const file = { arrayBuffer: async () => bytes.buffer } as unknown as File;
    return parseTableImportFile(file, cols, types);
  }

  it("CSV: '07/10/2026' là 7 tháng 10 (không đảo ngày-tháng kiểu Mỹ), cột số vẫn bóc '1,234'", async () => {
    const result = await importCsv(
      // Tiêu đề không dấu: test này chỉ nhắm cách đọc NGÀY trong CSV.
      'Ten,Ngay,Thanh tien\nA,07/10/2026,"1,234"\nB,25/10/2026,5\nC,2026,7\n',
      ["Ten", "Ngay", "Thanh tien"],
      ["text", "date", "money"],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newRows[0]).toEqual(["A", "2026-10-07", "1234"]);
    expect(result.newRows[1]).toEqual(["B", "2026-10-25", "5"]);
    // "2026" không bị hiểu thành 18/07/1905 — giữ nguyên để báo đỏ.
    expect(result.newRows[2][1]).toBe("2026");
    expect(result.invalidCellCount).toBe(1);
  });
});
