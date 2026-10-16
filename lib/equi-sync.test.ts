import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeTableRows } from "./table-field";
import type { ProposalField, RequestInstance } from "./types";

// lib/r2.ts khai `import "server-only"` — không tải được trong jsdom; giả link ký sẵn.
vi.mock("@/lib/r2", () => ({
  createSignedReadUrl: vi.fn(async (path: string) => `https://signed.example/${path}?sig=test`),
}));

const { daToiEqui, guiSangEqui, trichXuatPayloadEqui } = await import("./equi-sync");

function f(overrides: Partial<ProposalField>): ProposalField {
  return {
    id: overrides.id ?? "f",
    name: overrides.name ?? "Trường",
    dataType: overrides.dataType ?? "short_text",
    required: false,
    order: 1,
    ...overrides,
  } as ProposalField;
}

const oTen = f({ id: "f_ten", code: "ten_de_xuat", name: "Tên đề xuất" });
const oLuaChon = f({
  id: "f_lc",
  code: "lua_chon_de_nghi",
  name: "Lựa chọn đề nghị",
  dataType: "single_choice",
  options: ["Đề nghị lô hàng SX", "Đề nghị phòng ban"],
});
const oSoLo = f({ id: "f_solo", code: "so_lo_hang", name: "Số Lô hàng sản xuất" });
const oTenLo = f({ id: "f_tenlo", code: "ten_lo_hang", name: "Tên Lô Hàng" });
const oBoPhan = f({ id: "f_bp", name: "Bộ phận", dataType: "single_choice", options: ["Bộ phận sản xuất", "Kho"] });
const oNhomHang = f({ id: "f_nh", code: "nhom_de_xuat", name: "Nhóm đề xuất", dataType: "single_choice" });
const oNgay = f({ id: "f_ngay", code: "ngay_de_nghi_cap", name: "Ngày đề nghị cấp", dataType: "date" });
const oChiTiet = f({
  id: "f_ct",
  code: "chi_tiet",
  name: "Chi tiết",
  dataType: "table",
  tableColumns: ["Tên hàng", "Quy cách/chủng loại", "ĐVT", "Số lượng", "Mục đích sử dụng", "Ghi chú"],
});
const oTep = f({ id: "f_tep", name: "Tài liệu", dataType: "file" });

const DU_FIELDS = [oTen, oLuaChon, oSoLo, oTenLo, oBoPhan, oNhomHang, oNgay, oChiTiet, oTep];

function req(overrides: Partial<RequestInstance> = {}, values: Record<string, unknown> = {}): RequestInstance {
  return {
    id: "req-eq",
    code: "000000251",
    groupId: "g-eq",
    groupNameSnapshot: "1.0. Phiếu đề nghị (EQUI)",
    fieldsSnapshot: DU_FIELDS,
    values: {
      f_ten: "Lô hàng tháng 10",
      f_lc: "Đề nghị lô hàng SX",
      f_solo: "LSX-2610",
      f_tenlo: "Lô cọc PHC D400",
      f_bp: "Bộ phận sản xuất",
      f_nh: "Vật tư",
      f_ngay: "2026-10-20",
      f_ct: serializeTableRows([
        ["Thép D10\nHòa Phát", "CB300", "cây", "120", "Đổ cọc", "Giao trước 8h"],
        ["", "", "", "", "", ""],
        ["Xi măng", "PC40", "bao", "0", "", ""],
        ["Cát vàng", "", "m3", "5", "", ""],
      ]),
      f_tep: [{ path: "requests/u1/a.pdf", name: "a.pdf", size: 10 }],
      ...values,
    },
    submittedBy: { uid: "u1", email: "a@hpcons.com.vn", name: "Nguyễn Văn A" },
    submittedAt: "2026-10-16T01:00:00.000Z",
    updatedAt: "2026-10-16T01:00:00.000Z",
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

describe("trichXuatPayloadEqui — hợp đồng mục 1 (16/10/2026)", () => {
  it("Đề nghị lô hàng SX nhóm (EQUI) → payload đủ trường", async () => {
    const p = await trichXuatPayloadEqui(req());
    expect(p).not.toBeNull();
    expect(p).toMatchObject({
      requestId: "req-eq",
      requestCode: "000000251",
      tieuDe: "Lô hàng tháng 10",
      congTrinhChuoi: "Lô hàng tháng 10",
      nguoiGui: "Nguyễn Văn A",
      ngayCanGiao: "2026-10-20",
      nhomDeXuat: "1.0. Phiếu đề nghị (EQUI)",
      soLoHang: "LSX-2610",
      tenLoHang: "Lô cọc PHC D400",
      boPhan: "Bộ phận sản xuất",
      nhomHang: "Vật tư",
      taiLieuDinhKem: [{ ten: "a.pdf", url: "https://signed.example/requests/u1/a.pdf?sig=test" }],
    });
    expect(p?.ngayDuyet).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("stt đánh lại 1, 2, … theo dòng HỢP LỆ (bỏ dòng trống / số lượng 0), có ghi chú, gộp xuống dòng", async () => {
    const p = await trichXuatPayloadEqui(req());
    expect(p?.vatTu).toEqual([
      { stt: 1, tenVatTu: "Thép D10 Hòa Phát", quyCach: "CB300", dvt: "cây", soLuong: 120, mucDichSuDung: "Đổ cọc", ghiChu: "Giao trước 8h" },
      { stt: 2, tenVatTu: "Cát vàng", quyCach: undefined, dvt: "m3", soLuong: 5, mucDichSuDung: undefined, ghiChu: undefined },
    ]);
  });

  it("so lựa chọn không phân biệt hoa thường / dấu / khoảng trắng thừa", async () => {
    expect(await trichXuatPayloadEqui(req({}, { f_lc: "  đề nghị LÔ HÀNG  sx " }))).not.toBeNull();
    expect(await trichXuatPayloadEqui(req({}, { f_lc: "De nghi lo hang SX" }))).not.toBeNull();
  });

  it("Đề nghị phòng ban → null (không sang App EQUI)", async () => {
    expect(await trichXuatPayloadEqui(req({}, { f_lc: "Đề nghị phòng ban" }))).toBeNull();
  });

  it("biểu mẫu CÓ ô Lựa chọn đề nghị mà bỏ trống → null (không đoán)", async () => {
    expect(await trichXuatPayloadEqui(req({}, { f_lc: "" }))).toBeNull();
  });

  it("ô Lựa chọn đổi tên/mã vẫn nhận ra theo lựa chọn 'Đề nghị lô hàng SX' → phòng ban vẫn bị chặn", async () => {
    const oDoiTen = { ...oLuaChon, code: "x_moi", name: "1. Loại phiếu" } as ProposalField;
    const fields = DU_FIELDS.map((x) => (x.id === "f_lc" ? oDoiTen : x));
    expect(await trichXuatPayloadEqui(req({ fieldsSnapshot: fields }, { f_lc: "Đề nghị phòng ban" }))).toBeNull();
    expect(await trichXuatPayloadEqui(req({ fieldsSnapshot: fields }))).not.toBeNull();
  });

  it("biểu mẫu KHÔNG có ô Lựa chọn đề nghị → vẫn gửi (như bên Kho)", async () => {
    const fields = DU_FIELDS.filter((x) => x.id !== "f_lc");
    expect(await trichXuatPayloadEqui(req({ fieldsSnapshot: fields }))).not.toBeNull();
  });

  it("thiếu bảng Chi tiết → null", async () => {
    const fields = DU_FIELDS.filter((x) => x.id !== "f_ct");
    expect(await trichXuatPayloadEqui(req({ fieldsSnapshot: fields }))).toBeNull();
  });

  it("bảng thiếu cột Số lượng → null; bảng không có dòng hợp lệ → null", async () => {
    const ctThieuCot = { ...oChiTiet, tableColumns: ["Tên hàng", "ĐVT"] } as ProposalField;
    const fields = DU_FIELDS.map((x) => (x.id === "f_ct" ? ctThieuCot : x));
    expect(await trichXuatPayloadEqui(req({ fieldsSnapshot: fields }))).toBeNull();
    expect(await trichXuatPayloadEqui(req({}, { f_ct: serializeTableRows([["", "", "", "", "", ""]]) }))).toBeNull();
  });

  it("nhóm KHÔNG phải (EQUI) → null, kể cả đề nghị lô hàng SX", async () => {
    expect(await trichXuatPayloadEqui(req({ groupNameSnapshot: "1.0. Phiếu đề nghị" }))).toBeNull();
  });

  it("đề xuất trực tiếp nhóm EQUI (groupId null) vẫn gửi, nhomDeXuat lấy tên đang chụp", async () => {
    const p = await trichXuatPayloadEqui(req({ groupId: null, groupNameSnapshot: " 0. Đề xuất trực tiếp (EQUI) " }));
    expect(p?.nhomDeXuat).toBe("0. Đề xuất trực tiếp (EQUI)");
  });

  it("trường tuỳ chọn trống → vắng mặt; không có 'Tên đề xuất' thì congTrinhChuoi rỗng, không có tieuDe", async () => {
    const fields = DU_FIELDS.filter((x) => x.id !== "f_ten");
    const p = await trichXuatPayloadEqui(req({ fieldsSnapshot: fields }, { f_solo: "", f_tenlo: " ", f_nh: "", f_bp: "", f_tep: [] }));
    expect(p).not.toBeNull();
    expect(p?.congTrinhChuoi).toBe("");
    for (const k of ["tieuDe", "soLoHang", "tenLoHang", "nhomHang", "boPhan", "taiLieuDinhKem"]) {
      expect(p && k in p).toBe(false);
    }
  });

  it("tìm ô theo TÊN khi không có mã", async () => {
    const theoTen = [
      oLuaChon,
      oChiTiet,
      f({ id: "a", name: "Số Lô hàng sản xuất" }),
      f({ id: "b", name: "Tên Lô Hàng" }),
      f({ id: "c", name: "Nhóm đề xuất", dataType: "single_choice" }),
    ];
    const p = await trichXuatPayloadEqui(req({ fieldsSnapshot: theoTen }, { a: "LSX-1", b: "Lô 1", c: "MM-CCDC" }));
    expect(p).toMatchObject({ soLoHang: "LSX-1", tenLoHang: "Lô 1", nhomHang: "MM-CCDC" });
  });
});

describe("guiSangEqui / daToiEqui", () => {
  const ENV_GOC = { url: process.env.EQUI_API_URL, key: process.env.EQUI_API_KEY };
  afterEach(() => {
    vi.unstubAllGlobals();
    if (ENV_GOC.url === undefined) delete process.env.EQUI_API_URL;
    else process.env.EQUI_API_URL = ENV_GOC.url;
    if (ENV_GOC.key === undefined) delete process.env.EQUI_API_KEY;
    else process.env.EQUI_API_KEY = ENV_GOC.key;
  });

  it("thiếu EQUI_API_URL → lỗi vĩnh viễn rõ ràng, không gọi mạng", async () => {
    delete process.env.EQUI_API_URL;
    process.env.EQUI_API_KEY = "k";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const p = await trichXuatPayloadEqui(req());
    expect(await guiSangEqui(p!)).toEqual({ ok: false, loaiLoi: "vinh_vien", error: "Chưa cấu hình EQUI_API_URL." });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("thiếu EQUI_API_KEY → lỗi vĩnh viễn (EQUI đóng cổng khi thiếu khoá)", async () => {
    process.env.EQUI_API_URL = "https://equi.example";
    delete process.env.EQUI_API_KEY;
    const p = await trichXuatPayloadEqui(req());
    const kq = await guiSangEqui(p!);
    expect(kq.ok).toBe(false);
    expect(!kq.ok && kq.loaiLoi).toBe("vinh_vien");
  });

  it("gọi đúng địa chỉ + header x-api-key; da_tao_de_nghi → tới nơi, có mã đề nghị", async () => {
    process.env.EQUI_API_URL = "https://equi.example/";
    process.env.EQUI_API_KEY = "khoa-test";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, trangThai: "da_tao_de_nghi", deNghiId: "dn1", maDeNghi: "DN-EQ-260001" }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const kq = await guiSangEqui((await trichXuatPayloadEqui(req()))!);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://equi.example/api/app-request/de-nghi-duyet");
    expect(fetchSpy.mock.calls[0][1].headers["x-api-key"]).toBe("khoa-test");
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).vatTu[0].stt).toBe(1);
    expect(kq).toEqual({ ok: true, trangThai: "da_tao_de_nghi", deNghiId: "dn1", maDeNghi: "DN-EQ-260001" });
    expect(daToiEqui(kq)).toBe(true);
  });

  it("da_ton_tai cũng là đã tới nơi; trạng thái lạ thì KHÔNG", () => {
    expect(daToiEqui({ ok: true, trangThai: "da_ton_tai" })).toBe(true);
    expect(daToiEqui({ ok: true, trangThai: "bo_qua_gi_do" })).toBe(false);
    expect(daToiEqui({ ok: true, trangThai: "" })).toBe(false);
    expect(daToiEqui({ ok: false, error: "x" })).toBe(false);
  });

  it("HTTP lỗi → trả httpStatus + loaiLoi bên nhận, không throw", async () => {
    process.env.EQUI_API_URL = "https://equi.example";
    process.env.EQUI_API_KEY = "k";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ ok: false, loaiLoi: "tam_thoi", error: "Bận" }) }),
    );
    expect(await guiSangEqui((await trichXuatPayloadEqui(req()))!)).toEqual({
      ok: false,
      error: "Bận",
      httpStatus: 503,
      loaiLoi: "tam_thoi",
    });
  });

  it("mạng hỏng → { ok:false }, không throw", async () => {
    process.env.EQUI_API_URL = "https://equi.example";
    process.env.EQUI_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    expect(await guiSangEqui((await trichXuatPayloadEqui(req()))!)).toEqual({ ok: false, error: "ECONNRESET" });
  });
});
