import { describe, expect, it } from "vitest";
import {
  biChanBoiViecTruoc,
  denHanGui,
  HAN_DUNG_MS,
  khoangChoThuLai,
  phanLoaiLoi,
  quyetDinhSauLoi,
} from "./luat";

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
