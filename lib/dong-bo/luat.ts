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

/**
 * App đích. `"equi"` (16/10/2026, "Liên kết mua hàng EQUI" — Sếp duyệt 15/10): App EQUI (equi.hpcore.vn)
 * đóng đúng vai "App Kho" cho đề xuất các nhóm "(EQUI)" — xem `chonDichMacDinh`.
 */
export type DichDongBo = "kho" | "thumua" | "equi" | "ketoan";
export type LoaiSuKien = "duyet" | "xoa" | "khoi_phuc" | "dieu_chinh" | "them_file" | "duyet_buoc" | "tra_lai";
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
  duyet_buoc: "Duyệt xong bước kỹ thuật (gửi Kế toán lên kế hoạch)",
  tra_lai: "Đề xuất bị từ chối hoặc trả lại sau khi đã gửi Kế toán",
};
export const NHAN_DICH: Record<DichDongBo, string> = { kho: "App Kho", thumua: "App Thu mua", equi: "App EQUI", ketoan: "App Kế toán" };

/**
 * Nhóm đề xuất có thuộc EQUI không — tên nhóm (`groupNameSnapshot`) KẾT THÚC bằng "(EQUI)".
 * Không phân biệt hoa thường, bỏ khoảng trắng thừa (cả trong ngoặc: "( EQUI )"), chuẩn hoá NFC.
 * Vd "1.0. Phiếu đề nghị (EQUI)", "0. Đề xuất trực tiếp (EQUI)" (đề xuất trực tiếp `groupId = null`
 * vẫn có tên nhóm đang chụp).
 */
export function laNhomEqui(tenNhom: string | null | undefined): boolean {
  if (typeof tenNhom !== "string") return false;
  const s = tenNhom.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return /\(\s*equi\s*\)$/.test(s);
}

/**
 * ★ App đích mặc định của 1 sự kiện, theo NHÓM đề xuất (16/10/2026, hợp đồng "Liên kết mua hàng EQUI"):
 *   · Nhóm "(EQUI)" → App EQUI + App Thu mua. 🔴 KHÔNG BAO GIỜ gửi Kho công trình (QLK CTR) — Sếp chốt.
 *   · Nhóm khác      → App Kho + App Thu mua, y như trước.
 * Áp dụng cho MỌI loại việc (duyệt, xoá, khôi phục, điều chỉnh, thêm tệp).
 */
export function chonDichMacDinh(tenNhom: string | null | undefined): DichDongBo[] {
  return laNhomEqui(tenNhom) ? ["equi", "thumua"] : ["kho", "thumua"];
}

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

// ------------------------------------------------------------------------------------------------
// ★ LIÊN KẾT APP KẾ TOÁN — "Kế hoạch thanh toán" (Sếp chốt 19/10/2026, làm thầu phụ trước)
// ------------------------------------------------------------------------------------------------
//
// Khác Kho / Thu mua / EQUI (nhận khi đề xuất DUYỆT XONG toàn bộ), App Kế toán nhận khi người duyệt SẮP KẾ
// NGƯỜI CUỐI CÙNG vừa duyệt (Sếp chốt 19/10/2026: "mặc định người duyệt sắp kế người cuối cùng duyệt thì đẩy
// qua kế hoạch thanh toán"), tức còn đúng 1 người chưa duyệt. Nên cần sự kiện riêng `duyet_buoc` + luật dưới đây.
//
// Cấu hình bằng biến môi trường (KHÔNG cứng trong mã: tên nhóm đã đổi nhiều lần 3 → 4.0 → 5.0 nhưng id
// nhóm thì không đổi; còn người duyệt đổi người là đổi uid):
//   KETOAN_GROUP_IDS         id các nhóm đề xuất gửi Kế toán, cách nhau dấu phẩy
//   KETOAN_NGUOI_DUYET_UIDS  (TUỲ CHỌN, ghi đè mặc định) uid những người mà việc DUYỆT của họ kích hoạt gửi.
//                            Để trống = dùng luật mặc định "người duyệt sắp kế người cuối cùng".

/** "a, b ,,c" → ["a","b","c"]. */
export function tachDanhSach(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export type CauHinhKeToan = { nhomIds: readonly string[]; nguoiDuyetUids: readonly string[] };

/** Phần tối thiểu của người duyệt mà luật cần — `ApproverState` đầy đủ thoả mãn kiểu này. */
export type NguoiDuyetLuat = { id: string; decision: string };

/**
 * Luật MẶC ĐỊNH: người vừa duyệt là người duyệt SẮP KẾ NGƯỜI CUỐI CÙNG, tức SAU quyết định này đề xuất còn
 * chờ đúng 1 người (người cuối). Tính theo trạng thái trước/sau nên đúng với cả duyệt lần lượt lẫn đồng
 * thời, và với "duyệt và chuyển tiếp" (người được chuyển tới thành người còn lại duy nhất).
 *   · Vừa duyệt = trước quyết định người này chưa duyệt, sau quyết định đã "approved".
 *   · Đề xuất còn chờ (`trangThaiSau === "pending"`) và số người còn "pending" = 1.
 *   · Không có người duyệt trước người cuối (chỉ 1 người duyệt, hoặc luồng "single" — 1 người duyệt là xong):
 *     gửi khi đề xuất vừa DUYỆT XONG, vì không còn bước nào sớm hơn để kích hoạt.
 */
export function laNguoiDuyetSapKeCuoi(input: {
  actorUid: string;
  truoc: readonly NguoiDuyetLuat[];
  sau: readonly NguoiDuyetLuat[];
  trangThaiSau: string;
  luong?: string;
}): boolean {
  const { actorUid, truoc, sau, trangThaiSau, luong } = input;
  const duyetTruoc = truoc.find((a) => a.id === actorUid)?.decision === "approved";
  const duyetSau = sau.find((a) => a.id === actorUid)?.decision === "approved";
  if (duyetTruoc || !duyetSau) return false;
  if (trangThaiSau === "pending") return sau.filter((a) => a.decision === "pending").length === 1;
  if (trangThaiSau === "approved") return truoc.length <= 1 || luong === "single";
  return false;
}

/**
 * Sau 1 quyết định, có cần báo App Kế toán không, và báo gì:
 *   · `duyet_buoc` — đề xuất thuộc nhóm gửi Kế toán và người vừa duyệt là người duyệt sắp kế người cuối
 *     (luật mặc định, `laNguoiDuyetSapKeCuoi`). Nếu cấu hình `nguoiDuyetUids` KHÔNG rỗng thì dùng danh sách
 *     uid đó thay luật mặc định (ghi đè): người trong danh sách duyệt là gửi.
 *   · `tra_lai`    — đề xuất thuộc nhóm đó bị TỪ CHỐI / TRẢ LẠI (bởi bất kỳ ai) và ĐÃ từng gửi Kế toán
 *     (`daTungGui`) → dòng bên Kế toán phải chuyển "Bị trả lại". Chưa từng gửi thì không báo (khỏi tạo
 *     dòng rác bên Kế toán).
 *   · `null`       — không báo.
 */
export function suKienKeToanSauQuyetDinh(input: {
  groupId: string | null | undefined;
  actorUid: string;
  decision: string;
  daTungGui: boolean;
  cauHinh: CauHinhKeToan;
  truoc: readonly NguoiDuyetLuat[];
  sau: readonly NguoiDuyetLuat[];
  trangThaiSau: string;
  luong?: string;
}): "duyet_buoc" | "tra_lai" | null {
  const { groupId, actorUid, decision, daTungGui, cauHinh } = input;
  if (!groupId || !cauHinh.nhomIds.includes(groupId)) return null;

  const laDuyet = decision === "approved" || decision === "approve_and_forward";
  if (laDuyet) {
    if (cauHinh.nguoiDuyetUids.length > 0) {
      if (cauHinh.nguoiDuyetUids.includes(actorUid)) return "duyet_buoc";
    } else if (laNguoiDuyetSapKeCuoi(input)) {
      return "duyet_buoc";
    }
  }
  if ((decision === "rejected" || decision === "returned") && daTungGui) return "tra_lai";
  return null;
}
