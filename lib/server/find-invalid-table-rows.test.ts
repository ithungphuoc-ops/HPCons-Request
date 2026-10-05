import { describe, expect, it, vi } from "vitest";

// lib/server/requests.ts khai `import "server-only"` và kéo theo Firebase Admin
// (adminDb, App Tổng) — test này chỉ gọi hàm thuần `findInvalidTableRows`, nên
// mock rỗng để không khởi tạo kết nối thật nào.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({ adminDb: {} }));
vi.mock("@/lib/hpcore", () => ({ getHpcoreDb: vi.fn() }));

const { findInvalidTableRows } = await import("./requests");
import type { ProposalField } from "@/lib/types";

function tableField(overrides: Partial<ProposalField>): ProposalField {
  return {
    id: "f1",
    name: "Bảng",
    dataType: "table",
    required: false,
    order: 0,
    ...overrides,
  } as ProposalField;
}

function rowsValue(rows: string[][]) {
  return rows.map((cells) => ({ cells }));
}

describe("findInvalidTableRows — cột Bắt buộc theo tick (05/10/2026)", () => {
  const transferField = tableField({
    name: "Thông tin chuyển khoản",
    tableColumns: ["Tên đơn vị", "Số tài khoản", "Ngân hàng", "Số tiền", "Ghi chú"],
    tableColumnTypes: ["text", "text", "text", "money", "text"],
    tableColumnRequired: [true, true, true, true, false],
    tableColumnSum: [false, false, false, true, false],
  });

  it("bảng chuyển khoản: tick bắt buộc mà bỏ trống ô → lỗi đúng dòng/cột", () => {
    const issues = findInvalidTableRows([transferField], {
      f1: rowsValue([
        ["Cty A", "0123", "VCB", "1000000", ""],
        ["Cty B", "", "ACB", "", "gấp"],
      ]),
    });
    expect(issues.map((i) => i.message)).toEqual([
      'Dòng 2 của "Thông tin chuyển khoản": "Số tài khoản" chưa nhập.',
      'Dòng 2 của "Thông tin chuyển khoản": "Số tiền" chưa nhập.',
    ]);
  });

  it("dòng trống hẳn bỏ qua; cột không tick bắt buộc bỏ trống được", () => {
    const issues = findInvalidTableRows([transferField], {
      f1: rowsValue([
        ["Cty A", "0123", "VCB", "1000000", ""],
        ["", "", "", "", ""],
      ]),
    });
    expect(issues).toEqual([]);
  });

  it("cột số vẫn kiểm định dạng như cũ", () => {
    const issues = findInvalidTableRows([transferField], {
      f1: rowsValue([["Cty A", "0123", "VCB", "một triệu", ""]]),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('"Số tiền" phải là số');
  });

  it("đã tick rõ: cột tên 'Tên hàng' KHÔNG tick thì không còn bắt buộc", () => {
    const field = tableField({
      tableColumns: ["Tên hàng", "Ghi chú"],
      tableColumnRequired: [false, true],
    });
    const issues = findInvalidTableRows([field], { f1: rowsValue([["", "x"]]) });
    expect(issues).toEqual([]);
  });
});

describe("findInvalidTableRows — trường cũ chưa có tick giữ y hành vi cũ", () => {
  const legacyField = tableField({
    name: "Chi tiết",
    tableColumns: ["Tên hàng", "Quy cách/chủng loại", "ĐVT", "Số lượng", "Đơn giá", "Ghi chú"],
  });

  it("thiếu cột 'then chốt' và 'Số lượng' → lỗi; 'Ghi chú' trống không sao", () => {
    const issues = findInvalidTableRows([legacyField], {
      f1: rowsValue([["Xi măng", "", "bao", "", "", ""]]),
    });
    expect(issues.map((i) => i.message)).toEqual([
      'Dòng 1 của "Chi tiết": "Quy cách/chủng loại" chưa nhập.',
      'Dòng 1 của "Chi tiết": "Số lượng" chưa nhập.',
    ]);
  });

  it("'Số lượng' không phải số → lỗi như cũ", () => {
    const issues = findInvalidTableRows([legacyField], {
      f1: rowsValue([["Xi măng", "PCB40", "bao", "file đính kèm", "", ""]]),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('"Số lượng" phải là số');
  });

  it("bảng không có cột 'then chốt' nào → không bắt gì", () => {
    const field = tableField({ tableColumns: ["Tên đơn vị", "Số tài khoản"] });
    expect(findInvalidTableRows([field], { f1: rowsValue([["", "123"]]) })).toEqual([]);
  });
});
