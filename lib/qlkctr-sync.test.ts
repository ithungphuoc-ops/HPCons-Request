import { describe, expect, it, vi } from "vitest";
import { trichXuatPayload } from "./qlkctr-sync";
import { serializeTableRows } from "./table-field";
import type { ProposalField, RequestInstance } from "./types";

vi.mock("./r2", () => ({
  createSignedReadUrl: vi.fn(async (path: string) => `https://signed.example/${path}?sig=test`),
}));

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
  it("tách đúng dữ liệu khi field đúng mã code chuẩn (ten_de_xuat/chi_tiet)", async () => {
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

    const payload = await trichXuatPayload(request);
    expect(payload).not.toBeNull();
    expect(payload?.congTrinhChuoi).toBe("30/2025/HĐXD/UNICE-HPCS - UNICE QUẢNG NGÃI");
    expect(payload?.vatTu).toEqual([
      { tenVatTu: "Xi măng", quyCach: "Nghi sơn", dvt: "bao", soLuong: 500, mucDichSuDung: "Xây tô nhà ăn" },
      { tenVatTu: "Cát", quyCach: "Xây", dvt: "m3", soLuong: 20, mucDichSuDung: "Xây tô nhà ăn" },
    ]);
    expect(payload?.taiLieuDinhKem).toBeUndefined();
  });

  it("vẫn tìm được field qua tên hiển thị khi field CHƯA có code (fallback theo tên)", async () => {
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

    const payload = await trichXuatPayload(request);
    expect(payload).not.toBeNull();
    expect(payload?.congTrinhChuoi).toBe("12/2025/HĐXD/ABC - KHU CÔNG NGHIỆP ABC");
    expect(payload?.vatTu[0].tenVatTu).toBe("Thép phi 10");
  });

  it("vẫn map đúng khi thứ tự cột bảng bị đảo (ĐVT đứng trước Số lượng)", async () => {
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

    const payload = await trichXuatPayload(request);
    expect(payload?.vatTu[0]).toEqual({
      tenVatTu: "Cát vàng",
      quyCach: undefined,
      dvt: "m3",
      soLuong: 20,
      mucDichSuDung: "Xây tô",
    });
  });

  it("trả về null khi không có field bảng chi tiết nào", async () => {
    const titleField = makeField({ id: "f1", name: "Tên đề xuất", code: "ten_de_xuat" });
    const request = makeRequest({
      fieldsSnapshot: [titleField],
      values: { f1: "Công trình test" },
    });
    expect(await trichXuatPayload(request)).toBeNull();
  });

  it("trả về null khi bảng chi tiết thiếu cột bắt buộc (không có Số lượng)", async () => {
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
    expect(await trichXuatPayload(request)).toBeNull();
  });

  it("trả về null khi đề xuất không liên quan gì (không có field nào khớp)", async () => {
    const request = makeRequest({
      fieldsSnapshot: [makeField({ id: "f1", name: "Lý do nghỉ phép" })],
      values: { f1: "Nghỉ ốm" },
    });
    expect(await trichXuatPayload(request)).toBeNull();
  });

  it("gửi kèm link tải (chữ ký) cho file đính kèm ở field kiểu file, không đọc dữ liệu vật tư từ đó", async () => {
    const titleField = makeField({ id: "f1", name: "Tên đề xuất", code: "ten_de_xuat" });
    const detailField = makeField({
      id: "f2",
      name: "Chi tiết",
      dataType: "table",
      code: "chi_tiet",
      tableColumns: CHI_TIET_COLS_THUONG,
    });
    const fileField = makeField({ id: "f3", name: "Tài liệu đính kèm", dataType: "file" });
    const request = makeRequest({
      fieldsSnapshot: [titleField, detailField, fileField],
      values: {
        f1: "Công trình test",
        f2: serializeTableRows([["Cát vàng", "", "20", "m3", ""]]),
        f3: [{ name: "bao-gia.pdf", path: "requests/req1/bao-gia.pdf", size: 12345 }],
      },
    });

    const payload = await trichXuatPayload(request);
    expect(payload?.taiLieuDinhKem).toEqual([
      { ten: "bao-gia.pdf", url: "https://signed.example/requests/req1/bao-gia.pdf?sig=test" },
    ]);
    // File đính kèm không được lẫn vào danh sách vật tư.
    expect(payload?.vatTu).toEqual([
      { tenVatTu: "Cát vàng", quyCach: undefined, dvt: "m3", soLuong: 20, mucDichSuDung: undefined },
    ]);
  });

  it("bỏ qua êm nếu tạo link tải cho 1 file thất bại, không chặn cả đề nghị", async () => {
    const { createSignedReadUrl } = await import("./r2");
    vi.mocked(createSignedReadUrl).mockRejectedValueOnce(new Error("R2 lỗi"));

    const titleField = makeField({ id: "f1", name: "Tên đề xuất", code: "ten_de_xuat" });
    const detailField = makeField({
      id: "f2",
      name: "Chi tiết",
      dataType: "table",
      code: "chi_tiet",
      tableColumns: CHI_TIET_COLS_THUONG,
    });
    const fileField = makeField({ id: "f3", name: "Tài liệu đính kèm", dataType: "file" });
    const request = makeRequest({
      fieldsSnapshot: [titleField, detailField, fileField],
      values: {
        f1: "Công trình test",
        f2: serializeTableRows([["Cát vàng", "", "20", "m3", ""]]),
        f3: [{ name: "loi.pdf", path: "requests/req1/loi.pdf", size: 1 }],
      },
    });

    const payload = await trichXuatPayload(request);
    expect(payload).not.toBeNull();
    expect(payload?.taiLieuDinhKem).toBeUndefined();
  });
});
