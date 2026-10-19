import { describe, expect, it } from "vitest";
import { suKienKeToanSauQuyetDinh, tachDanhSach, NHAN_DICH, NHAN_LOAI } from "@/lib/dong-bo/luat";

const cauHinh = { nhomIds: ["G5"], nguoiDuyetUids: ["thi"] };
const co = (o: Partial<Parameters<typeof suKienKeToanSauQuyetDinh>[0]>) =>
  suKienKeToanSauQuyetDinh({ groupId: "G5", actorUid: "thi", decision: "approved", daTungGui: false, cauHinh, ...o });

describe("suKienKeToanSauQuyetDinh", () => {
  it("người được chỉ định duyệt → duyet_buoc, dù đề xuất còn chờ bước sau", () => {
    expect(co({})).toBe("duyet_buoc");
    expect(co({ decision: "forward_then_approve" })).toBe("duyet_buoc");
  });
  it("người khác duyệt (CHT, QC, kế toán…) thì KHÔNG gửi", () => {
    expect(co({ actorUid: "cht" })).toBeNull();
  });
  it("nhóm không thuộc danh sách thì KHÔNG gửi, kể cả đúng người", () => {
    expect(co({ groupId: "G-cong-nhat" })).toBeNull();
    expect(co({ groupId: null })).toBeNull();
    expect(co({ groupId: undefined })).toBeNull();
  });
  it("bị từ chối/trả lại sau khi đã gửi → tra_lai, bất kể ai bấm", () => {
    expect(co({ decision: "rejected", actorUid: "ktt", daTungGui: true })).toBe("tra_lai");
    expect(co({ decision: "returned", actorUid: "thi", daTungGui: true })).toBe("tra_lai");
  });
  it("bị từ chối nhưng chưa từng gửi Kế toán → không báo (khỏi tạo dòng rác)", () => {
    expect(co({ decision: "rejected", daTungGui: false })).toBeNull();
  });
  it("chưa cấu hình (danh sách rỗng) thì không gửi gì", () => {
    expect(co({ cauHinh: { nhomIds: [], nguoiDuyetUids: [] } })).toBeNull();
  });
});

describe("tachDanhSach + nhãn", () => {
  it("tách, bỏ khoảng trắng và phần tử rỗng", () => {
    expect(tachDanhSach(" a, b ,,c ")).toEqual(["a", "b", "c"]);
    expect(tachDanhSach(undefined)).toEqual([]);
    expect(tachDanhSach("")).toEqual([]);
  });
  it("có nhãn cho đích và sự kiện mới", () => {
    expect(NHAN_DICH.ketoan).toBe("App Kế toán");
    expect(NHAN_LOAI.duyet_buoc).toBeTruthy();
    expect(NHAN_LOAI.tra_lai).toBeTruthy();
  });
});
