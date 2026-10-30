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
import { evaluateConditionGroup } from "@/lib/server/conditions";
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
 * ★★ ĐỔI LUẬT 22/10/2026 — Sếp chốt sơ đồ liên kết EQUI ("chỉ sửa phần liên kết, vận hành trong
 * App EQUI giữ nguyên"). Ô "Lựa chọn đề nghị" quyết định CỔNG nhận bên App EQUI:
 *
 *   · "Đề nghị phòng ban"   → POST {EQUI_API_URL}/api/app-request/de-nghi-duyet  (Kho vật tư → Hàng cần
 *                             nhập). Thu mua kho EQUI vẫn nhận như cũ và nay đi đủ luồng như công trình.
 *   · "Đề nghị sản xuất" (chữ cũ "Đề nghị lô hàng SX", đổi 29/10/2026 — nhận cả hai)
 *                           → POST {EQUI_API_URL}/api/app-request/ke-hoach-moi   (Sản xuất → Kế hoạch
 *                             sản xuất, mỗi dòng Chi tiết một kế hoạch Nháp). KHÔNG gửi Thu mua nữa —
 *                             chặn ở `hang-cho.ts` (`laLoHangSxEqui`).
 *   · Biểu mẫu KHÔNG có ô đó → Hàng cần nhập như trước (đề xuất trực tiếp nhóm EQUI…).
 *   · Có ô mà bỏ trống / chọn lạ → KHÔNG đoán: hàng chờ báo lỗi "Không nhận ra loại đề nghị" (trước
 *     22/10 là "Không cần gửi" lặng lẽ — Sếp được hứa báo rõ).
 *   (header `x-api-key: EQUI_API_KEY` cho cả hai cổng)
 *
 * Cả hai cổng nhận CÙNG một khuôn payload dưới đây; ngoài ra phải có bảng "Chi tiết" với cột Tên hàng +
 * Số lượng và ít nhất 1 dòng hợp lệ.
 */

/* Mã `so_lo_hang` / `ten_lo_hang` giữ từ đời biểu mẫu đầu — 29/10/2026 Sếp đổi TÊN ô thành "Số hợp đồng"
   (tra cứu hợp đồng Công nợ) và "Tên công trình/Dự án"; mã không đổi nên vẫn đọc đúng ô. */
const SO_LO_HANG_CODES = new Set(["so_lo_hang"]);
/** Ô "Ngày đề nghị cấp ( giao đủ )" — thêm 29/10/2026; kỳ kế hoạch sản xuất = lần đầu → giao đủ. */
const NGAY_GIAO_DU_CODES = new Set(["ngay_de_nghi_cap_giao_du"]);
const TEN_LO_HANG_CODES = new Set(["ten_lo_hang"]);
const NHOM_HANG_CODES = new Set(["nhom_de_xuat"]);

/** So nhãn: bỏ dấu (cả đ → d, NFD không tách được), không phân biệt hoa thường, gộp khoảng trắng thừa. */
function soSanhNhan(s: string): string {
  return chuanHoaSoSanh(s.normalize("NFC")).replace(/đ/g, "d").replace(/\s+/g, " ");
}

/**
 * Các chữ của lựa chọn "sản xuất" (→ Kế hoạch sản xuất). 29/10/2026 Sếp đổi chữ trên biểu mẫu từ
 * "Đề nghị lô hàng SX" thành "Đề nghị sản xuất" — nhận CẢ HAI: phiếu đã lập bằng chữ cũ (gửi lại, sự kiện
 * sau duyệt) vẫn phải đi đúng đường. Đổi chữ lần nữa thì THÊM vào đây, đừng xoá chữ cũ.
 */
const CAC_GIA_TRI_SAN_XUAT = new Set(["Đề nghị lô hàng SX", "Đề nghị sản xuất"].map(soSanhNhan));
const GIA_TRI_PHONG_BAN = soSanhNhan("Đề nghị phòng ban");

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
 * "sản xuất" (`CAC_GIA_TRI_SAN_XUAT` — phòng khi biểu mẫu đổi tên ô; đọc hụt ô này là phiếu phòng ban lọt
 * sang Kế hoạch sản xuất).
 */
function timOLuaChon(fields: ProposalField[]): ProposalField | null {
  return (
    timField(fields, LUA_CHON_DE_NGHI_FIELD_CODES, ["Lựa chọn đề nghị"]) ??
    fields.find((f) => Array.isArray(f.options) && f.options.some((o) => CAC_GIA_TRI_SAN_XUAT.has(soSanhNhan(String(o))))) ??
    null
  );
}

/**
 * Loại một đề xuất nhóm "(EQUI)" theo ô "Lựa chọn đề nghị" — 22/10/2026.
 *   · `lo_hang_sx` / `phong_ban` — chọn đúng một trong hai lựa chọn của biểu mẫu;
 *   · `khong_co_o` — biểu mẫu không có ô này (đi Hàng cần nhập như trước);
 *   · `khong_ro`   — có ô mà bỏ trống / chọn lạ → không đoán, báo lỗi.
 * Nhóm KHÔNG phải "(EQUI)" → `null`.
 */
export type LoaiDeNghiEqui = "lo_hang_sx" | "phong_ban" | "khong_co_o" | "khong_ro";

export function phanLoaiDeNghiEqui(request: RequestInstance): LoaiDeNghiEqui | null {
  const nhomDeXuat = typeof request.groupNameSnapshot === "string" ? request.groupNameSnapshot.trim() : "";
  if (!laNhomEqui(nhomDeXuat)) return null;
  const oLuaChon = timOLuaChon(request.fieldsSnapshot ?? []);
  if (!oLuaChon) return "khong_co_o";
  const chon = soSanhNhan(giaTriChuoi((request.values ?? {})[oLuaChon.id]));
  if (CAC_GIA_TRI_SAN_XUAT.has(chon)) return "lo_hang_sx";
  if (chon === GIA_TRI_PHONG_BAN) return "phong_ban";
  return "khong_ro";
}

/** Đề xuất nhóm "(EQUI)" loại "Đề nghị lô hàng SX" — từ 22/10/2026 KHÔNG gửi Thu mua (chỉ vào Kế hoạch sản xuất). */
export function laLoHangSxEqui(request: RequestInstance): boolean {
  return phanLoaiDeNghiEqui(request) === "lo_hang_sx";
}

/** Giá trị đang chọn ở ô "Lựa chọn đề nghị" (để câu báo lỗi nói đúng thứ người dùng thấy). */
export function giaTriLuaChonEqui(request: RequestInstance): string {
  const o = timOLuaChon(request.fieldsSnapshot ?? []);
  return o ? giaTriChuoi((request.values ?? {})[o.id]) : "";
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
  /** Ô "Ngày đề nghị cấp ( giao đủ )" (29/10/2026). `ngayCanGiao` là ngày cấp LẦN ĐẦU. */
  ngayGiaoDu?: string;
  /**
   * Loại đề nghị — 22/10/2026. Quyết định cổng nhận (`guiSangEqui`). Vắng mặt khi biểu mẫu không có ô
   * "Lựa chọn đề nghị" (đi Hàng cần nhập như trước).
   */
  loaiDeNghi?: "lo_hang_sx" | "phong_ban";
  /** Ô "Số hợp đồng" (mã `so_lo_hang`, tên cũ "Số Lô hàng sản xuất"). Ô đang ẩn → vắng mặt (30/10/2026). */
  soLoHang?: string;
  /** Ô "Tên công trình/Dự án" (mã `ten_lo_hang`, tên cũ "Tên Lô Hàng"). Ô đang ẩn → vắng mặt. */
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
  const loai = phanLoaiDeNghiEqui(request);
  // Không phải nhóm EQUI, hoặc ô "Lựa chọn đề nghị" trống / lạ → không dựng payload (hàng chờ đọc
  // `phanLoaiDeNghiEqui` trước để báo lỗi "không nhận ra loại" thay vì huỷ êm).
  if (loai === null || loai === "khong_ro") return null;

  const fields = request.fieldsSnapshot ?? [];
  const values = request.values ?? {};

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

  /* ★ 30/10/2026 — App Request GIỮ giá trị của ô đã bị ẩn (người lập chọn "Công trình ngoài", chọn số HĐ, rồi
     đổi sang "Công trình nội bộ" → số HĐ cũ vẫn nằm trong `values`). Gửi nguyên thì kế hoạch nội bộ bị gắn
     nhầm lô của HĐ đó. Ô đang ẩn (theo `visibleWhen` trên CHÍNH bản chụp biểu mẫu của phiếu) coi như trống —
     cùng luật trang gửi đề xuất dùng để ẩn ô và bỏ "bắt buộc". Chỉ áp cho đường EQUI. */
  const dangHien = (f: ProposalField): boolean => !f.visibleWhen || evaluateConditionGroup(f.visibleWhen, values, fields);
  const giaTriO = (f: ProposalField | null | undefined): string => (f && dangHien(f) ? giaTriChuoi(values[f.id]) : "");

  const ngayCanGiao = giaTriO(timField(fields, NGAY_CAN_CAP_FIELD_CODES, ["Ngày đề nghị cấp"]));
  const ngayGiaoDu = giaTriO(
    timField(fields, NGAY_GIAO_DU_CODES, ["Ngày đề nghị cấp ( giao đủ )", "Ngày đề nghị cấp (giao đủ)"]),
  );

  const docO = (codes: Set<string>, ten: string): string => giaTriO(timField(fields, codes, [ten]));
  const soLoHang = docO(SO_LO_HANG_CODES, "Số Lô hàng sản xuất");
  const tenLoHang = docO(TEN_LO_HANG_CODES, "Tên Lô Hàng");
  const nhomHang = docO(NHOM_HANG_CODES, "Nhóm đề xuất");
  const boPhan = giaTriO(timOBoPhan(request));

  const taiLieuDinhKem = await layTaiLieuDinhKem(request);

  return {
    requestId: request.id,
    requestCode: request.code ?? request.id,
    ...(tieuDe ? { tieuDe } : {}),
    // Giữ cho giống khuôn Kho (= tieuDe). Nhóm EQUI không bắt buộc "Tên đề xuất" nên có thể rỗng.
    congTrinhChuoi: tieuDe,
    nguoiGui: request.submittedBy.name,
    // Ngày duyệt theo GIỜ VIỆT NAM (22/10/2026, QA): App EQUI dùng nó làm mốc dự phòng cho kỳ kế hoạch /
    // hạn giao — lấy ngày UTC thì duyệt lúc 0–7 giờ sáng là lùi một ngày (có khi lùi cả một tuần kế hoạch).
    ngayDuyet: new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10),
    ...(ngayCanGiao ? { ngayCanGiao } : {}),
    ...(ngayGiaoDu ? { ngayGiaoDu } : {}),
    nhomDeXuat,
    ...(loai === "lo_hang_sx" || loai === "phong_ban" ? { loaiDeNghi: loai } : {}),
    ...(soLoHang ? { soLoHang } : {}),
    ...(tenLoHang ? { tenLoHang } : {}),
    ...(boPhan ? { boPhan } : {}),
    ...(nhomHang ? { nhomHang } : {}),
    vatTu,
    ...(taiLieuDinhKem.length > 0 ? { taiLieuDinhKem } : {}),
  };
}

export type KetQuaGuiEqui =
  | { ok: true; trangThai: string; maDeNghi?: string; deNghiId?: string; maKeHoach?: string[] }
  | { ok: false; error: string; httpStatus?: number; loaiLoi?: string };

/**
 * App EQUI ĐÃ CÓ đề nghị / kế hoạch chưa. So ĐÚNG tên trạng thái (bài học `daTaoDeNghiThat` bên Kho):
 * `ok: true` với trạng thái lạ KHÔNG được coi là đã tới nơi. `da_ton_tai` = gửi lại sau khi EQUI đã nhận
 * từ trước. `da_tao_ke_hoach` = cổng Kế hoạch sản xuất (22/10/2026).
 */
export function daToiEqui(ketQua: KetQuaGuiEqui): boolean {
  return (
    ketQua.ok &&
    (ketQua.trangThai === "da_tao_de_nghi" || ketQua.trangThai === "da_ton_tai" || ketQua.trangThai === "da_tao_ke_hoach")
  );
}

/** Cổng nhận bên App EQUI theo loại đề nghị — 22/10/2026. */
export function congEquiCho(payload: Pick<EquiDeNghiPayload, "loaiDeNghi">): "ke-hoach-moi" | "de-nghi-duyet" {
  return payload.loaiDeNghi === "lo_hang_sx" ? "ke-hoach-moi" : "de-nghi-duyet";
}

/** Không throw — mọi lỗi (thiếu cấu hình, mạng, HTTP lỗi) trả qua `{ ok: false }` kèm `httpStatus`/`loaiLoi`. */
export async function guiSangEqui(payload: EquiDeNghiPayload): Promise<KetQuaGuiEqui> {
  const url = process.env.EQUI_API_URL;
  if (!url) return { ok: false, loaiLoi: "vinh_vien", error: "Chưa cấu hình EQUI_API_URL." };
  // App EQUI thiếu khoá thì đóng cổng (khác QLK CTR) → gửi không khoá chắc chắn 401; báo rõ ngay.
  const khoa = process.env.EQUI_API_KEY;
  if (!khoa) return { ok: false, loaiLoi: "vinh_vien", error: "Chưa cấu hình EQUI_API_KEY." };

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/app-request/${congEquiCho(payload)}`, {
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
      maKeHoach?: unknown;
      loaiLoi?: string;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}`, httpStatus: res.status, loaiLoi: data.loaiLoi };
    }
    const maKeHoach = Array.isArray(data.maKeHoach)
      ? data.maKeHoach.filter((x): x is string => typeof x === "string" && x.trim() !== "")
      : [];
    return {
      ok: true,
      trangThai: data.trangThai ?? "",
      ...(data.maDeNghi ? { maDeNghi: data.maDeNghi } : {}),
      ...(data.deNghiId ? { deNghiId: data.deNghiId } : {}),
      ...(maKeHoach.length ? { maKeHoach } : {}),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi không xác định." };
  }
}
