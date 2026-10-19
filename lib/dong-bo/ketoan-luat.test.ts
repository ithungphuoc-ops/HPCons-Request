import { describe, expect, it } from "vitest";
import {
  laNguoiDuyetSapKeCuoi,
  suKienKeToanSauQuyetDinh,
  tachDanhSach,
  NHAN_DICH,
  NHAN_LOAI,
  type NguoiDuyetLuat,
} from "@/lib/dong-bo/luat";

const ds = (...x: string[]): NguoiDuyetLuat[] => x.map((s) => ({ id: s.split(":")[0], decision: s.split(":")[1] }));

// Chuỗi 6 người như đề xuất thanh toán NTP: cht → qc → pm → thi → kt → ktt (lần lượt).
const TRUOC_THI = ds("cht:approved", "qc:approved", "pm:approved", "thi:pending", "kt:pending", "ktt:pending");
const SAU_THI = ds("cht:approved", "qc:approved", "pm:approved", "thi:approved", "kt:pending", "ktt:pending");
const TRUOC_KT = SAU_THI;
const SAU_KT = ds("cht:approved", "qc:approved", "pm:approved", "thi:approved", "kt:approved", "ktt:pending");
const XONG = ds("cht:approved", "qc:approved", "pm:approved", "thi:approved", "kt:approved", "ktt:approved");

describe("laNguoiDuyetSapKeCuoi (luật mặc định)", () => {
  const f = (actorUid: string, truoc: NguoiDuyetLuat[], sau: NguoiDuyetLuat[], trangThaiSau = "pending", luong?: string) =>
    laNguoiDuyetSapKeCuoi({ actorUid, truoc, sau, trangThaiSau, luong });

  it("người duyệt SẮP KẾ người cuối vừa duyệt (còn đúng 1 người) → gửi", () => {
    expect(f("kt", TRUOC_KT, SAU_KT)).toBe(true);
  });
  it("các bước sớm hơn duyệt (còn ≥ 2 người) → chưa gửi, kể cả Hồ Văn Thi", () => {
    expect(f("thi", TRUOC_THI, SAU_THI)).toBe(false);
    expect(f("cht", ds("cht:pending", "qc:pending", "ktt:pending"), ds("cht:approved", "qc:pending", "ktt:pending"))).toBe(false);
  });
  it("người cuối duyệt (đề xuất duyệt xong, chuỗi dài) → không gửi lại", () => {
    expect(f("ktt", SAU_KT, XONG, "approved")).toBe(false);
  });
  it("chuỗi 2 người: người đầu duyệt là sắp kế cuối → gửi", () => {
    expect(f("a", ds("a:pending", "b:pending"), ds("a:approved", "b:pending"))).toBe(true);
  });
  it("chỉ 1 người duyệt: gửi khi duyệt xong (không có bước nào sớm hơn)", () => {
    expect(f("a", ds("a:pending"), ds("a:approved"), "approved")).toBe(true);
  });
  it("luồng single (1 người duyệt là xong): gửi khi duyệt xong", () => {
    expect(f("a", ds("a:pending", "b:pending", "c:pending"), ds("a:approved", "b:pending", "c:pending"), "approved", "single")).toBe(true);
  });
  it("đồng thời: người duyệt thứ n-1 (còn 1 người) → gửi", () => {
    expect(f("b", ds("a:approved", "b:pending", "c:pending"), ds("a:approved", "b:approved", "c:pending"))).toBe(true);
  });
  it("duyệt và chuyển tiếp: gửi khi sau đó chỉ còn đúng 1 người chờ", () => {
    // còn người được chuyển tới + người cuối = 2 người → chưa gửi
    expect(f("a", ds("a:pending", "b:pending"), ds("a:approved", "t:pending", "b:pending"))).toBe(false);
    // chỉ còn người được chuyển tới → gửi
    expect(f("a", ds("a:pending"), ds("a:approved", "t:pending"))).toBe(true);
  });
  it("người đã duyệt từ trước (bấm lại) hoặc từ chối → không gửi", () => {
    expect(f("kt", SAU_KT, SAU_KT)).toBe(false);
    expect(f("kt", TRUOC_KT, TRUOC_KT)).toBe(false);
    expect(
      f("kt", TRUOC_KT, ds("cht:approved", "qc:approved", "pm:approved", "thi:approved", "kt:rejected", "ktt:pending"), "rejected"),
    ).toBe(false);
  });
});

type DauVao = Parameters<typeof suKienKeToanSauQuyetDinh>[0];
const cauHinh = { nhomIds: ["G5"], nguoiDuyetUids: [] as string[] };
const co = (o: Partial<DauVao> = {}) =>
  suKienKeToanSauQuyetDinh({
    groupId: "G5",
    actorUid: "kt",
    decision: "approved",
    daTungGui: false,
    cauHinh,
    truoc: TRUOC_KT,
    sau: SAU_KT,
    trangThaiSau: "pending",
    ...o,
  });

describe("suKienKeToanSauQuyetDinh", () => {
  it("mặc định: người duyệt sắp kế người cuối duyệt → duyet_buoc", () => {
    expect(co()).toBe("duyet_buoc");
    expect(co({ decision: "approve_and_forward", actorUid: "a", truoc: ds("a:pending"), sau: ds("a:approved", "t:pending") })).toBe(
      "duyet_buoc",
    );
  });
  it("bước sớm hơn duyệt thì chưa gửi", () => {
    expect(co({ actorUid: "thi", truoc: TRUOC_THI, sau: SAU_THI })).toBeNull();
  });
  it("có danh sách uid cấu hình thì GHI ĐÈ luật mặc định", () => {
    const ghiDe = { nhomIds: ["G5"], nguoiDuyetUids: ["thi"] };
    expect(co({ cauHinh: ghiDe, actorUid: "thi", truoc: TRUOC_THI, sau: SAU_THI })).toBe("duyet_buoc");
    // người sắp kế cuối KHÔNG còn kích hoạt khi đã chỉ định người khác
    expect(co({ cauHinh: ghiDe })).toBeNull();
  });
  it("nhóm không thuộc danh sách thì KHÔNG gửi", () => {
    expect(co({ groupId: "G-cong-nhat" })).toBeNull();
    expect(co({ groupId: null })).toBeNull();
    expect(co({ groupId: undefined })).toBeNull();
  });
  it("chưa cấu hình nhóm (danh sách rỗng) thì không gửi gì", () => {
    expect(co({ cauHinh: { nhomIds: [], nguoiDuyetUids: [] } })).toBeNull();
  });
  it("bị từ chối/trả lại sau khi đã gửi → tra_lai, bất kể ai bấm", () => {
    expect(co({ decision: "rejected", actorUid: "ktt", daTungGui: true })).toBe("tra_lai");
    expect(co({ decision: "returned", actorUid: "thi", daTungGui: true })).toBe("tra_lai");
  });
  it("bị từ chối nhưng chưa từng gửi Kế toán → không báo (khỏi tạo dòng rác)", () => {
    expect(co({ decision: "rejected", daTungGui: false })).toBeNull();
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
