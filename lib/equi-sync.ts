import { laNhomEqui } from "@/lib/dong-bo/luat";
import {
  chuanHoaSoSanh,
  DETAIL_FIELD_CODES,
  layTaiLieuDinhKem,
  LUA_CHON_DE_NGHI_FIELD_CODES,
  NGAY_CAN_CAP_FIELD_CODES,
  timCotBang,
  timField,
  type QlkCtrPayload,
  type QlkCtrVatTu,
} from "@/lib/qlkctr-sync";
import { TITLE_FIELD_CODES } from "@/lib/request-title";
import { deserializeTableRows, flattenLineBreaks } from "@/lib/table-field";
import { timOBoPhan } from "@/lib/thumua-sync";
import type { ProposalField, RequestInstance } from "@/lib/types";

/**
 * ★ Đồng bộ đề xuất đã duyệt xong sang App EQUI (equi.hpcore.vn) — "Liên kết mua hàng EQUI"
 * (Sếp duyệt 15/10/2026, code 16/10/2026).
 *
 * Nguyên tắc Sếp chốt: EQUI làm Y NHƯ luồng HPCons. App EQUI đóng đúng vai "App Kho" (QLK CTR) cho đề
 * xuất các nhóm "(EQUI)", nên khuôn dữ liệu là NGUYÊN `QlkCtrPayload` cộng thêm vài trường EQUI (hợp đồng
 * mục 1). Đọc field / bảng bằng chính các helper của `qlkctr-sync.ts` để hai đường đọc giống hệt nhau.
 *
 *   POST {EQUI_API_URL}/api/app-request/de-nghi-duyet   (header `x-api-key: EQUI_API_KEY`)
 *
 * Chỉ gửi khi: nhóm "(EQUI)" · ô "Lựa chọn đề nghị" (nếu biểu mẫu có) = "Đề nghị lô hàng SX" · có bảng
 * "Chi tiết" với cột Tên hàng + Số lượng · ít nhất 1 dòng hợp lệ. Phiếu "Đề nghị phòng ban" KHÔNG sang
 * App EQUI (Thu mua tự ghi nhận giao hàng — y như HPCons).
 */

const SO_LO_HANG_CODES = new Set(["so_lo_hang"]);
const TEN_LO_HANG_CODES = new Set(["ten_lo_hang"]);
const NHOM_HANG_CODES = new Set(["nhom_de_xuat"]);

/** So nhãn: bỏ dấu (cả đ → d, NFD không tách được), không phân biệt hoa thường, gộp khoảng trắng thừa. */
function soSanhNhan(s: string): string {
  return chuanHoaSoSanh(s.normalize("NFC")).replace(/đ/g, "d").replace(/\s+/g, " ");
}

const GIA_TRI_LO_HANG_SX = soSanhNhan("Đề nghị lô hàng SX");

/** Giá trị 1 ô thành chuỗi gọn (ô chọn nhiều → nối bằng ", "). Kiểu lạ → rỗng. */
function giaTriChuoi(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) {
    return v
      .filter((x): x is string | number => typeof x === "string" || typeof x === "number")
      .map((x) => String(x).trim())
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

/**
 * Ô "Lựa chọn đề nghị": theo mã `lua_chon_de_nghi` / tên như bên Kho; không thấy thì rơi về ô có lựa chọn
 * "Đề nghị lô hàng SX" (phòng khi biểu mẫu đổi tên ô — đọc hụt ô này là phiếu phòng ban lọt sang EQUI).
 */
function timOLuaChon(fields: ProposalField[]): ProposalField | null {
  return (
    timField(fields, LUA_CHON_DE_NGHI_FIELD_CODES, ["Lựa chọn đề nghị"]) ??
    fields.find((f) => Array.isArray(f.options) && f.options.some((o) => soSanhNhan(String(o)) === GIA_TRI_LO_HANG_SX)) ??
    null
  );
}

export type EquiVatTu = QlkCtrVatTu & {
  /** Số thứ tự 1, 2, 3… theo dòng HỢP LỆ đã gửi (dòng trống / số lượng 0 bị bỏ, không chiếm số). */
  stt: number;
  ghiChu?: string;
};

/** Hợp đồng mục 1 — `QlkCtrPayload` cộng thêm các trường EQUI. */
export type EquiDeNghiPayload = Omit<QlkCtrPayload, "vatTu"> & {
  /** `groupNameSnapshot`, vd "1.0. Phiếu đề nghị (EQUI)". */
  nhomDeXuat: string;
  /** Ô "Số Lô hàng sản xuất" (mã `so_lo_hang`). */
  soLoHang?: string;
  /** Ô "Tên Lô Hàng" (mã `ten_lo_hang`). */
  tenLoHang?: string;
  /** Ô "Bộ phận" (cùng luật tìm ô với đường Thu mua — `timOBoPhan`). */
  boPhan?: string;
  /** Ô "Nhóm đề xuất" (Vật tư / MM-CCDC / …, mã `nhom_de_xuat`). */
  nhomHang?: string;
  vatTu: EquiVatTu[];
};

/**
 * Trả `null` (KHÔNG throw) khi đề xuất không thuộc diện gửi App EQUI — nơi gọi (hàng chờ) huỷ việc êm,
 * không coi là lỗi.
 */
export async function trichXuatPayloadEqui(request: RequestInstance): Promise<EquiDeNghiPayload | null> {
  const nhomDeXuat = typeof request.groupNameSnapshot === "string" ? request.groupNameSnapshot.trim() : "";
  if (!laNhomEqui(nhomDeXuat)) return null;

  const fields = request.fieldsSnapshot ?? [];
  const values = request.values ?? {};

  // Biểu mẫu CÓ ô "Lựa chọn đề nghị" thì phải chọn ĐÚNG "Đề nghị lô hàng SX" (bỏ trống / "Đề nghị phòng
  // ban" / lựa chọn khác → không gửi). Biểu mẫu không có ô đó thì cho qua như bên Kho.
  const oLuaChon = timOLuaChon(fields);
  if (oLuaChon && soSanhNhan(giaTriChuoi(values[oLuaChon.id])) !== GIA_TRI_LO_HANG_SX) return null;

  const detailField = timField(fields, DETAIL_FIELD_CODES, ["Chi tiết", "Vật tư đề nghị"]);
  if (!detailField) return null;
  const cot = detailField.tableColumns ?? [];
  const idxTen = timCotBang(cot, "tên hàng", "tên vật tư");
  const idxSL = timCotBang(cot, "số lượng", "sl");
  if (idxTen < 0 || idxSL < 0) return null;
  const idxQuyCach = timCotBang(cot, "quy cách", "chủng loại");
  const idxDvt = timCotBang(cot, "đvt", "đơn vị");
  const idxMucDich = timCotBang(cot, "mục đích");
  const timGhiChu = timCotBang(cot, "ghi chú");
  // Cột ghép kiểu "Mục đích / ghi chú" đã gửi ở mucDichSuDung — không gửi trùng.
  const idxGhiChu = timGhiChu !== idxMucDich ? timGhiChu : -1;

  const vatTu: EquiVatTu[] = deserializeTableRows(values[detailField.id])
    .map((r) => ({
      // Gộp xuống dòng trong ô thành 1 dấu cách khi gửi đi — y như đường Kho / Thu mua.
      tenVatTu: flattenLineBreaks(r[idxTen] ?? ""),
      quyCach: idxQuyCach >= 0 ? flattenLineBreaks(r[idxQuyCach] ?? "") || undefined : undefined,
      dvt: idxDvt >= 0 ? flattenLineBreaks(r[idxDvt] ?? "") : "",
      soLuong: Number(r[idxSL]) || 0,
      mucDichSuDung: idxMucDich >= 0 ? flattenLineBreaks(r[idxMucDich] ?? "") || undefined : undefined,
      ghiChu: idxGhiChu >= 0 ? flattenLineBreaks(r[idxGhiChu] ?? "") || undefined : undefined,
    }))
    .filter((v) => v.tenVatTu && v.soLuong > 0)
    .map((v, i) => ({ stt: i + 1, ...v }));
  if (vatTu.length === 0) return null;

  const titleField = timField(fields, TITLE_FIELD_CODES, ["Tên đề xuất", "Tên đề nghị"]);
  const tieuDe = titleField ? String(values[titleField.id] ?? "").trim() : "";

  const ngayCanCapField = timField(fields, NGAY_CAN_CAP_FIELD_CODES, ["Ngày đề nghị cấp"]);
  const ngayCanGiao = ngayCanCapField ? String(values[ngayCanCapField.id] ?? "").trim() : "";

  const docO = (codes: Set<string>, ten: string): string => {
    const f = timField(fields, codes, [ten]);
    return f ? giaTriChuoi(values[f.id]) : "";
  };
  const soLoHang = docO(SO_LO_HANG_CODES, "Số Lô hàng sản xuất");
  const tenLoHang = docO(TEN_LO_HANG_CODES, "Tên Lô Hàng");
  const nhomHang = docO(NHOM_HANG_CODES, "Nhóm đề xuất");
  const oBoPhan = timOBoPhan(request);
  const boPhan = oBoPhan ? giaTriChuoi(values[oBoPhan.id]) : "";

  const taiLieuDinhKem = await layTaiLieuDinhKem(request);

  return {
    requestId: request.id,
    requestCode: request.code ?? request.id,
    ...(tieuDe ? { tieuDe } : {}),
    // Giữ cho giống khuôn Kho (= tieuDe). Nhóm EQUI không bắt buộc "Tên đề xuất" nên có thể rỗng.
    congTrinhChuoi: tieuDe,
    nguoiGui: request.submittedBy.name,
    ngayDuyet: new Date().toISOString().slice(0, 10),
    ...(ngayCanGiao ? { ngayCanGiao } : {}),
    nhomDeXuat,
    ...(soLoHang ? { soLoHang } : {}),
    ...(tenLoHang ? { tenLoHang } : {}),
    ...(boPhan ? { boPhan } : {}),
    ...(nhomHang ? { nhomHang } : {}),
    vatTu,
    ...(taiLieuDinhKem.length > 0 ? { taiLieuDinhKem } : {}),
  };
}

export type KetQuaGuiEqui =
  | { ok: true; trangThai: string; maDeNghi?: string; deNghiId?: string }
  | { ok: false; error: string; httpStatus?: number; loaiLoi?: string };

/**
 * App EQUI ĐÃ CÓ đề nghị chưa. So ĐÚNG tên trạng thái (bài học `daTaoDeNghiThat` bên Kho): `ok: true`
 * với trạng thái lạ KHÔNG được coi là đã tới nơi. `da_ton_tai` = gửi lại sau khi EQUI đã nhận từ trước.
 */
export function daToiEqui(ketQua: KetQuaGuiEqui): boolean {
  return ketQua.ok && (ketQua.trangThai === "da_tao_de_nghi" || ketQua.trangThai === "da_ton_tai");
}

/** Không throw — mọi lỗi (thiếu cấu hình, mạng, HTTP lỗi) trả qua `{ ok: false }` kèm `httpStatus`/`loaiLoi`. */
export async function guiSangEqui(payload: EquiDeNghiPayload): Promise<KetQuaGuiEqui> {
  const url = process.env.EQUI_API_URL;
  if (!url) return { ok: false, loaiLoi: "vinh_vien", error: "Chưa cấu hình EQUI_API_URL." };
  // App EQUI thiếu khoá thì đóng cổng (khác QLK CTR) → gửi không khoá chắc chắn 401; báo rõ ngay.
  const khoa = process.env.EQUI_API_KEY;
  if (!khoa) return { ok: false, loaiLoi: "vinh_vien", error: "Chưa cấu hình EQUI_API_KEY." };

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/app-request/de-nghi-duyet`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": khoa },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      trangThai?: string;
      maDeNghi?: string;
      deNghiId?: string;
      loaiLoi?: string;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}`, httpStatus: res.status, loaiLoi: data.loaiLoi };
    }
    return {
      ok: true,
      trangThai: data.trangThai ?? "",
      ...(data.maDeNghi ? { maDeNghi: data.maDeNghi } : {}),
      ...(data.deNghiId ? { deNghiId: data.deNghiId } : {}),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi không xác định." };
  }
}
