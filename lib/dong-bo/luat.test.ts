import { describe, expect, it } from "vitest";
import {
  biChanBoiViecTruoc,
  chonDichMacDinh,
  denHanGui,
  HAN_DUNG_MS,
  khoangChoThuLai,
  laNhomEqui,
  NHAN_DICH,
  phanLoaiLoi,
  quyetDinhSauLoi,
} from "./luat";

describe("laNhomEqui — nhận diện nhóm (EQUI) (16/10/2026)", () => {
  it("tên nhóm kết thúc bằng (EQUI) → đúng", () => {
    expect(laNhomEqui("1.0. Phiếu đề nghị (EQUI)")).toBe(true);
    expect(laNhomEqui("0. Đề xuất trực tiếp (EQUI)")).toBe(true);
  });
  it("không phân biệt hoa thường, bỏ khoảng trắng thừa (cả trong ngoặc)", () => {
    expect(laNhomEqui("  1.0. Phiếu đề nghị (equi)  ")).toBe(true);
    expect(laNhomEqui("1.0.  Phiếu   đề nghị ( Equi )")).toBe(true);
    expect(laNhomEqui("Phiếu\tđề nghị\n(EQUI)\n")).toBe(true);
  });
  it("chuẩn hoá NFC — tên gõ kiểu dựng sẵn hay tổ hợp đều nhận", () => {
    expect(laNhomEqui("1.0. Phiếu đề nghị (EQUI)".normalize("NFD"))).toBe(true);
  });
  it("EQUI không nằm ở CUỐI, hoặc không trong ngoặc → sai", () => {
    expect(laNhomEqui("(EQUI) 1.0. Phiếu đề nghị")).toBe(false);
    expect(laNhomEqui("1.0. Phiếu đề nghị (EQUI) cũ")).toBe(false);
    expect(laNhomEqui("1.0. Phiếu đề nghị EQUI")).toBe(false);
    expect(laNhomEqui("1.0. Phiếu đề nghị (EQUIP)")).toBe(false);
    expect(laNhomEqui("2. Phiếu đề nghị")).toBe(false);
  });
  it("rỗng / null / undefined / kiểu lạ → sai, không ném lỗi", () => {
    expect(laNhomEqui("")).toBe(false);
    expect(laNhomEqui(null)).toBe(false);
    expect(laNhomEqui(undefined)).toBe(false);
    expect(laNhomEqui(42 as unknown as string)).toBe(false);
  });
});

describe("chonDichMacDinh — chọn app đích theo nhóm (16/10/2026)", () => {
  it("nhóm (EQUI) → App EQUI + Thu mua, KHÔNG BAO GIỜ Kho công trình", () => {
    const d = chonDichMacDinh("1.0. Phiếu đề nghị (EQUI)");
    expect(d).toEqual(["equi", "thumua"]);
    expect(d).not.toContain("kho");
  });
  it("đề xuất trực tiếp nhóm EQUI (groupId null, vẫn có tên chụp) → equi + thumua", () => {
    expect(chonDichMacDinh("0. Đề xuất trực tiếp (EQUI)")).toEqual(["equi", "thumua"]);
  });
  it("nhóm thường → Kho + Thu mua y như cũ", () => {
    expect(chonDichMacDinh("2. Phiếu đề nghị")).toEqual(["kho", "thumua"]);
    expect(chonDichMacDinh(null)).toEqual(["kho", "thumua"]);
    expect(chonDichMacDinh(undefined)).toEqual(["kho", "thumua"]);
  });
  it("có nhãn hiển thị cho App EQUI", () => expect(NHAN_DICH.equi).toBe("App EQUI"));
});

describe("khoangChoThuLai", () => {
  it("chưa thử lần nào thì gửi ngay", () => expect(khoangChoThuLai(0)).toBe(0));
  it("bậc 1p · 5p · 30p · 2h rồi dừng ở trần 2h", () => {
    expect([1, 2, 3, 4, 5, 9].map(khoangChoThuLai)).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 7_200_000, 7_200_000]);
  });
});

describe("phanLoaiLoi", () => {
  it("ưu tiên lời khai bên nhận", () => expect(phanLoaiLoi(400, "tam_thoi")).toBe("tam_thoi"));
  it("4xx là vĩnh viễn, trừ 404/408/429", () => {
    expect(phanLoaiLoi(400)).toBe("vinh_vien");
    expect(phanLoaiLoi(401)).toBe("vinh_vien");
    expect(phanLoaiLoi(429)).toBe("tam_thoi");
    expect(phanLoaiLoi(408)).toBe("tam_thoi");
    // cổng nhận chưa lên (phát hành lệch thứ tự) — không được dừng ngay
    expect(phanLoaiLoi(404)).toBe("tam_thoi");
  });
  it("5xx / không tới được / không biết → tạm thời", () => {
    expect(phanLoaiLoi(503)).toBe("tam_thoi");
    expect(phanLoaiLoi(undefined)).toBe("tam_thoi");
  });
});

describe("quyetDinhSauLoi", () => {
  const t0 = 1_000_000;
  it("lỗi tạm thời lần 1 → hẹn sau 1 phút", () => {
    expect(quyetDinhSauLoi({ soLanThu: 1, taoLuc: t0, bayGio: t0, loaiLoi: "tam_thoi" })).toEqual({ trangThai: "cho", henLuc: t0 + 60_000 });
  });
  it("lỗi vĩnh viễn → dừng ngay", () => {
    expect(quyetDinhSauLoi({ soLanThu: 1, taoLuc: t0, bayGio: t0, loaiLoi: "vinh_vien" }).trangThai).toBe("dung");
  });
  it("đủ 5 lần → dừng", () => {
    expect(quyetDinhSauLoi({ soLanThu: 5, taoLuc: t0, bayGio: t0 + 10, loaiLoi: "tam_thoi" }).trangThai).toBe("dung");
  });
  it("quá 1 ngày → dừng dù chưa đủ 5 lần", () => {
    expect(quyetDinhSauLoi({ soLanThu: 2, taoLuc: t0, bayGio: t0 + HAN_DUNG_MS, loaiLoi: "tam_thoi" }).trangThai).toBe("dung");
  });
});

describe("denHanGui", () => {
  it("chỉ việc đang chờ, đã tới hạn, không bị khoá", () => {
    expect(denHanGui({ trangThai: "cho", henLuc: 100 }, 100)).toBe(true);
    expect(denHanGui({ trangThai: "cho", henLuc: 200 }, 100)).toBe(false);
    expect(denHanGui({ trangThai: "cho", henLuc: 200 }, 100, true)).toBe(true); // quét đêm bỏ qua hẹn
    expect(denHanGui({ trangThai: "cho", henLuc: 0, khoaDen: 150 }, 100)).toBe(false);
    expect(denHanGui({ trangThai: "da_gui", henLuc: 0 }, 100)).toBe(false);
  });
});

describe("biChanBoiViecTruoc", () => {
  const ds = [
    { id: "a", dich: "kho" as const, taoLuc: 1, trangThai: "cho" as const },
    { id: "b", dich: "kho" as const, taoLuc: 2, trangThai: "cho" as const },
    { id: "c", dich: "thumua" as const, taoLuc: 1, trangThai: "dung" as const },
    { id: "d", dich: "thumua" as const, taoLuc: 3, trangThai: "cho" as const },
  ];
  it("việc sau đợi việc trước cùng app đích", () => {
    expect(biChanBoiViecTruoc(ds[1], ds)).toBe(true);
    expect(biChanBoiViecTruoc(ds[0], ds)).toBe(false);
  });
  it("việc trước đã dừng vẫn chặn (giữ đúng thứ tự)", () => expect(biChanBoiViecTruoc(ds[3], ds)).toBe(true));
  it("không chặn chéo app đích", () => expect(biChanBoiViecTruoc(ds[0], [ds[0], ds[2]])).toBe(false));
  it("việc trước đã huỷ thì không chặn", () => {
    expect(biChanBoiViecTruoc(ds[1], [{ ...ds[0], trangThai: "huy" }, ds[1]])).toBe(false);
  });
});
