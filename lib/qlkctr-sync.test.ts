import { describe, expect, it } from "vitest";
import { trichXuatPayload } from "./qlkctr-sync";
import { serializeTableRows } from "./table-field";
import type { ProposalField, RequestInstance } from "./types";

function makeField(overrides: Partial<ProposalField>): ProposalField {
  return {
    id: overrides.id ?? "f1",
    name: overrides.name ?? "Trường",
    dataType: overrides.dataType ?? "short_text",
    required: overrides.required ?? false,
    order: overrides.order ?? 1,
    ...overrides,
  } as ProposalField;
}

function makeRequest(overrides: Partial<RequestInstance>): RequestInstance {
  return {
    id: "req1",
    code: "000123",
    groupId: "g1",
    groupNameSnapshot: "2. Phiếu đề nghị",
    fieldsSnapshot: [],
    values: {},
    submittedBy: { uid: "u1", email: "a@hpcons.com.vn", name: "Nguyễn Hữu Phước" },
    submittedAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
    approvalFlow: "sequential",
    approversSnapshot: [],
    approvers: [],
    followers: [],
    status: "approved",
    deadlineAt: null,
    history: [],
    comments: [],
    deletedAt: null,
    ...overrides,
  } as RequestInstance;
}

const CHI_TIET_COLS_THUONG = ["Tên hàng", "Quy cách/chủng loại", "Số lượng", "ĐVT", "Mục đích sử dụng"];

describe("trichXuatPayload", () => {
  it("tách đúng dữ liệu khi field đúng mã code chuẩn (ten_de_xuat/chi_tiet)", () => {
    const titleField = makeField({ id: "f1", name: "Tên đề xuất", code: "ten_de_xuat" });
    const detailField = makeField({
      id: "f2",
      name: "Chi tiết",
      dataType: "table",
      code: "chi_tiet",
      tableColumns: CHI_TIET_COLS_THUONG,
    });
    const request = makeRequest({
      fieldsSnapshot: [titleField, detailField],
      values: {
        f1: "30/2025/HĐXD/UNICE-HPCS - UNICE QUẢNG NGÃI",
        f2: serializeTableRows([
          ["Xi măng", "Nghi sơn", "500", "bao", "Xây tô nhà ăn"],
          ["Cát", "Xây", "20", "m3", "Xây tô nhà ăn"],
        ]),
      },
    });

    const payload = trichXuatPayload(request);
    expect(payload).not.toBeNull();
    expect(payload?.congTrinhChuoi).toBe("30/2025/HĐXD/UNICE-HPCS - UNICE QUẢNG NGÃI");
    expect(payload?.vatTu).toEqual([
      { tenVatTu: "Xi măng", quyCach: "Nghi sơn", dvt: "bao", soLuong: 500, mucDichSuDung: "Xây tô nhà ăn" },
      { tenVatTu: "Cát", quyCach: "Xây", dvt: "m3", soLuong: 20, mucDichSuDung: "Xây tô nhà ăn" },
    ]);
  });

  it("vẫn tìm được field qua tên hiển thị khi field CHƯA có code (fallback theo tên)", () => {
    const titleField = makeField({ id: "f1", name: "Tên đề xuất" }); // không có code
    const detailField = makeField({
      id: "f2",
      name: "Chi tiết",
      dataType: "table",
      tableColumns: CHI_TIET_COLS_THUONG,
    });
    const request = makeRequest({
      fieldsSnapshot: [titleField, detailField],
      values: {
        f1: "12/2025/HĐXD/ABC - KHU CÔNG NGHIỆP ABC",
        f2: serializeTableRows([["Thép phi 10", "", "150", "Cây", ""]]),
      },
    });

    const payload = trichXuatPayload(request);
    expect(payload).not.toBeNull();
    expect(payload?.congTrinhChuoi).toBe("12/2025/HĐXD/ABC - KHU CÔNG NGHIỆP ABC");
    expect(payload?.vatTu[0].tenVatTu).toBe("Thép phi 10");
  });

  it("vẫn map đúng khi thứ tự cột bảng bị đảo (ĐVT đứng trước Số lượng)", () => {
    const titleField = makeField({ id: "f1", name: "Tên đề xuất", code: "ten_de_xuat" });
    const detailField = makeField({
      id: "f2",
      name: "Chi tiết",
      dataType: "table",
      code: "chi_tiet",
      tableColumns: ["Tên hàng", "ĐVT", "Số lượng", "Mục đích sử dụng"], // ĐVT trước Số lượng
    });
    const request = makeRequest({
      fieldsSnapshot: [titleField, detailField],
      values: {
        f1: "Công trình test",
        f2: serializeTableRows([["Cát vàng", "m3", "20", "Xây tô"]]),
      },
    });

    const payload = trichXuatPayload(request);
    expect(payload?.vatTu[0]).toEqual({
      tenVatTu: "Cát vàng",
      quyCach: undefined,
      dvt: "m3",
      soLuong: 20,
      mucDichSuDung: "Xây tô",
    });
  });

  it("trả về null khi không có field bảng chi tiết nào", () => {
    const titleField = makeField({ id: "f1", name: "Tên đề xuất", code: "ten_de_xuat" });
    const request = makeRequest({
      fieldsSnapshot: [titleField],
      values: { f1: "Công trình test" },
    });
    expect(trichXuatPayload(request)).toBeNull();
  });

  it("trả về null khi bảng chi tiết thiếu cột bắt buộc (không có Số lượng)", () => {
    const titleField = makeField({ id: "f1", name: "Tên đề xuất", code: "ten_de_xuat" });
    const detailField = makeField({
      id: "f2",
      name: "Chi tiết",
      dataType: "table",
      code: "chi_tiet",
      tableColumns: ["Tên hàng", "Ghi chú"],
    });
    const request = makeRequest({
      fieldsSnapshot: [titleField, detailField],
      values: { f1: "Công trình test", f2: serializeTableRows([["Cát", "abc"]]) },
    });
    expect(trichXuatPayload(request)).toBeNull();
  });

  it("trả về null khi đề xuất không liên quan gì (không có field nào khớp)", () => {
    const request = makeRequest({
      fieldsSnapshot: [makeField({ id: "f1", name: "Lý do nghỉ phép" })],
      values: { f1: "Nghỉ ốm" },
    });
    expect(trichXuatPayload(request)).toBeNull();
  });
});
