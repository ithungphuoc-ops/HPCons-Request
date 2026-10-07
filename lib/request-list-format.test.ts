import { describe, expect, it } from "vitest";
import { chuanHoaTimKiem, matchedTableCell, tableFieldCellValues } from "./request-list-format";
import type { ProposalField, RequestInstance } from "@/lib/types";

const tableField: ProposalField = {
  id: "f_table",
  name: "Chi tiết",
  dataType: "table",
  required: false,
  order: 0,
  tableColumns: ["Tên hàng", "Quy cách", "Số lượng"],
};

function requestWithTable(rows: string[][]): RequestInstance {
  return {
    id: "r1",
    code: "262001-HPCS-CT1",
    groupId: "g1",
    groupNameSnapshot: "1. Phiếu đề nghị",
    fieldsSnapshot: [tableField],
    values: { f_table: rows.map((cells) => ({ cells })) },
    submittedBy: { uid: "u1", email: "a@b.com", name: "Trương Văn Vũ Em" },
    submittedAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T00:00:00.000Z",
    approvalFlow: "concurrent",
    approversSnapshot: [],
    approvers: [],
    followers: [],
    status: "approved",
    deadlineAt: null,
    history: [],
    comments: [],
    deletedAt: null,
  } as unknown as RequestInstance;
}

describe("tableFieldCellValues", () => {
  it("gom mọi ô không rỗng trong field kiểu bảng, bỏ ô rỗng", () => {
    const r = requestWithTable([
      ["Sơn trắng mờ, mã màu T070M", "Taiyang, ngoài trời", "1"],
      ["Cây chống 3m", "", "15"],
    ]);
    expect(tableFieldCellValues(r)).toEqual([
      "Sơn trắng mờ, mã màu T070M",
      "Taiyang, ngoài trời",
      "1",
      "Cây chống 3m",
      "15",
    ]);
  });

  it("không có field kiểu bảng nào → mảng rỗng", () => {
    const r = requestWithTable([]);
    r.fieldsSnapshot = [];
    expect(tableFieldCellValues(r)).toEqual([]);
  });
});

describe("matchedTableCell", () => {
  const r = requestWithTable([
    ["Sơn trắng mờ, mã màu T070M", "Taiyang, ngoài trời", "1"],
    ["Cây chống 3m", "Sắt mạ kẽm", "15"],
  ]);

  it("khớp không phân biệt dấu/hoa-thường, trả đúng nguyên văn ô khớp", () => {
    expect(matchedTableCell(r, "son")).toBe("Sơn trắng mờ, mã màu T070M");
  });

  it("khớp ở cột khác (không phải cột đầu) vẫn tìm ra", () => {
    expect(matchedTableCell(r, "sắt")).toBe("Sắt mạ kẽm");
  });

  it("không có từ khoá tìm kiếm → null", () => {
    expect(matchedTableCell(r, "")).toBeNull();
  });

  it("từ khoá không khớp ô nào → null", () => {
    expect(matchedTableCell(r, "xi mang")).toBeNull();
  });
});

describe("tìm kiếm ô bảng có xuống dòng (07/10/2026)", () => {
  it("chuanHoaTimKiem gộp xuống dòng/khoảng trắng thừa thành 1 dấu cách", () => {
    expect(chuanHoaTimKiem("  Sơn\nlót   chống\r\ngỉ ")).toBe("son lot chong gi");
  });

  it("matchedTableCell: gõ 'son lot' vẫn khớp ô 'Sơn⏎lót', trả nguyên văn ô", () => {
    const r = requestWithTable([["Sơn\nlót chống gỉ", "", "2"]]);
    expect(matchedTableCell(r, "son lot")).toBe("Sơn\nlót chống gỉ");
  });
});
