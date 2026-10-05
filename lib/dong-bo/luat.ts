/**
 * ★ LUẬT HÀNG CHỜ ĐỒNG BỘ — đợt 1 "liên kết 4 app" (Sếp chốt 03/10/2026).
 *
 * Hàm THUẦN (không đọc Firestore, không đọc `Date.now()` — thời gian truyền vào) để bài kiểm gọi
 * thật được. Phần đụng Firestore / mạng nằm ở `hang-cho.ts`.
 *
 * Cơ chế gửi lại (gói Vercel miễn phí chỉ cho hẹn giờ 1 lần/ngày, nên KHÔNG dùng hẹn giờ dày):
 *   · Gửi NGAY lúc phát sinh sự kiện.
 *   · Lỗi TẠM THỜI → hẹn lại theo bậc 1 phút · 5 phút · 30 phút · 2 giờ. Tới hạn thì lần kế tiếp CÓ
 *     NGƯỜI DÙNG App Request (mở danh sách / mở đề xuất) máy chủ tranh thủ gửi; đêm 2:00 quét vét.
 *   · Tối đa 5 lần HOẶC quá 1 ngày → DỪNG + báo (lịch sử đề xuất + trang "Lịch sử Webhook").
 *   · Lỗi VĨNH VIỄN (dữ liệu sai, thiếu quyền — gửi lại y nguyên không bao giờ khác) → DỪNG NGAY.
 */

export type DichDongBo = "kho" | "thumua";
export type LoaiSuKien = "duyet" | "xoa" | "khoi_phuc" | "dieu_chinh" | "them_file";
export type TrangThaiViec = "cho" | "da_gui" | "dung" | "huy";
export type LoaiLoi = "tam_thoi" | "vinh_vien";

/** Chỉ số = số lần đã thử mà vẫn lỗi. Phần tử 0 = chưa thử lần nào → gửi ngay. */
export const BAC_CHO_MS: readonly number[] = [0, 60_000, 300_000, 1_800_000, 7_200_000];
export const SO_LAN_TOI_DA = 5;
export const HAN_DUNG_MS = 24 * 60 * 60 * 1000;
/** Một lượt gửi giữ "khoá" bao lâu để 2 lượt quét chạy song song không gửi trùng 1 việc. */
export const THOI_GIAN_KHOA_MS = 90_000;

export const NHAN_LOAI: Record<LoaiSuKien, string> = {
  duyet: "Gửi đề nghị (duyệt xong)",
  xoa: "Xoá đề xuất",
  khoi_phuc: "Khôi phục đề xuất",
  dieu_chinh: "Điều chỉnh sau duyệt",
  them_file: "Thêm tài liệu",
};
export const NHAN_DICH: Record<DichDongBo, string> = { kho: "App Kho", thumua: "App Thu mua" };

/** Khoảng chờ trước lần thử kế tiếp khi đã thử `soLanThu` lần mà vẫn lỗi (trần 2 giờ). */
export function khoangChoThuLai(soLanThu: number): number {
  if (!Number.isFinite(soLanThu) || soLanThu <= 0) return 0;
  return BAC_CHO_MS[Math.min(Math.floor(soLanThu), BAC_CHO_MS.length - 1)];
}

/**
 * Phân loại 1 lần gửi hỏng. Ưu tiên lời khai của bên nhận (`loaiLoi` trong body), không có thì suy
 * từ mã HTTP. KHÔNG BIẾT THÌ COI LÀ TẠM THỜI — xếp nhầm tạm thời thành vĩnh viễn là việc kẹt không tự
 * hồi phục; nhầm chiều ngược lại chỉ tốn thêm vài lượt trong giới hạn 5 lần.
 */
export function phanLoaiLoi(httpStatus: number | undefined, loaiLoiTuBenNhan?: unknown): LoaiLoi {
  if (loaiLoiTuBenNhan === "tam_thoi" || loaiLoiTuBenNhan === "vinh_vien") return loaiLoiTuBenNhan;
  if (httpStatus === undefined || !Number.isFinite(httpStatus)) return "tam_thoi";
  // 404 = cổng nhận chưa có (vd App Request lên trước App Kho / Thu mua lúc phát hành) — các cổng nhận
  // trả 200 "khong_co_de_nghi" chứ không trả 404 cho dữ liệu, nên 404 là lỗi tạm thời (QA 03/10).
  if (httpStatus === 404 || httpStatus === 408 || httpStatus === 429) return "tam_thoi";
  if (httpStatus >= 400 && httpStatus < 500) return "vinh_vien";
  return "tam_thoi";
}

export type QuyetDinhSauLoi =
  | { trangThai: "cho"; henLuc: number }
  | { trangThai: "dung"; lyDo: string };

/**
 * Sau 1 lần gửi hỏng: hẹn lại hay dừng.
 * @param soLanThu số lần đã thử TÍNH CẢ lần vừa hỏng.
 */
export function quyetDinhSauLoi(input: {
  soLanThu: number;
  taoLuc: number;
  bayGio: number;
  loaiLoi: LoaiLoi;
}): QuyetDinhSauLoi {
  const { soLanThu, taoLuc, bayGio, loaiLoi } = input;
  if (loaiLoi === "vinh_vien") {
    return { trangThai: "dung", lyDo: "Lỗi dữ liệu / cấu hình — gửi lại y nguyên sẽ không khác, cần xử lý tay" };
  }
  if (soLanThu >= SO_LAN_TOI_DA) {
    return { trangThai: "dung", lyDo: `Đã thử ${soLanThu} lần vẫn lỗi — dừng, cần xử lý tay` };
  }
  if (bayGio - taoLuc >= HAN_DUNG_MS) {
    return { trangThai: "dung", lyDo: "Quá 1 ngày vẫn lỗi — dừng, cần xử lý tay" };
  }
  return { trangThai: "cho", henLuc: bayGio + khoangChoThuLai(soLanThu) };
}

/** Việc có được đem ra gửi ở lượt quét này không (đã tới hạn, không đang bị lượt khác giữ khoá). */
export function denHanGui(
  viec: { trangThai: TrangThaiViec; henLuc?: number | null; khoaDen?: number | null },
  bayGio: number,
  boQuaHen = false,
): boolean {
  if (viec.trangThai !== "cho") return false;
  if ((viec.khoaDen ?? 0) > bayGio) return false;
  if (boQuaHen) return true;
  return (viec.henLuc ?? 0) <= bayGio;
}

/**
 * Việc của CÙNG 1 đề xuất + CÙNG 1 app đích phải đi đúng thứ tự (vd "duyệt" phải tới Kho trước
 * "điều chỉnh"). Việc trước còn chờ hoặc đã dừng (chưa ai xử lý) thì việc sau phải đợi.
 * `huy` / `da_gui` không chặn.
 */
export function biChanBoiViecTruoc(
  viec: { id: string; dich: DichDongBo; taoLuc: number },
  tatCaViecCuaDeXuat: readonly { id: string; dich: DichDongBo; taoLuc: number; trangThai: TrangThaiViec }[],
): boolean {
  return tatCaViecCuaDeXuat.some(
    (v) =>
      v.id !== viec.id &&
      v.dich === viec.dich &&
      (v.taoLuc < viec.taoLuc || (v.taoLuc === viec.taoLuc && v.id < viec.id)) &&
      (v.trangThai === "cho" || v.trangThai === "dung"),
  );
}
