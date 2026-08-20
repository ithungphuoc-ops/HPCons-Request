import { createSignedReadUrl } from "@/lib/r2";
import { TITLE_FIELD_CODES } from "@/lib/request-title";
import { deserializeTableRows } from "@/lib/table-field";
import type { ProposalField, RequestAttachment, RequestInstance } from "@/lib/types";

/**
 * Đồng bộ đề xuất đã duyệt xong sang App Thu mua (module mua hàng của HP Cons) — SONG SONG
 * với nhánh gọi QLK CTR (`lib/qlkctr-sync.ts`), KHÔNG thay thế nó.
 *
 * 🔴 KHÁC QLK CTR ở điểm quan trọng nhất: Thu mua nhận **MỌI** đề xuất duyệt xong, có công
 * trình hay không (đề xuất riêng của một phòng ban — vd văn phòng phẩm — vẫn phải gửi qua,
 * Thu mua tự xử lý). QLK CTR chỉ nhận khi có công trình vì nó không có gì để làm với đề
 * xuất không liên quan công trình. Vì vậy hàm `trichXuatPayloadThuMua` dưới đây KHÔNG gate
 * theo `congTrinhChuoi` rỗng/không rỗng như bên QLK CTR — chỉ gate theo có đủ vật tư/phòng
 * ban hay không.
 *
 * Đọc lại 2 field có sẵn ("Tên đề xuất" cho công trình — có thể rỗng, "Chi tiết" cho vật tư)
 * cộng thêm field kiểu `department_select` ("Chọn bộ phận") cho phòng ban — không đổi field/UI
 * nào của nhóm đề xuất.
 */

const DETAIL_FIELD_CODES = new Set(["chi_tiet", "vat_tu", "vat_tu_de_nghi", "danh_sach_vat_tu"]);

function chuanHoaSoSanh(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function timField(fields: ProposalField[], codes: Set<string>, tenGanDung: string[]): ProposalField | null {
  const theoCode = fields.find((f) => f.code && codes.has(f.code));
  if (theoCode) return theoCode;
  const theoTen = fields.find((f) => tenGanDung.some((t) => chuanHoaSoSanh(f.name) === chuanHoaSoSanh(t)));
  return theoTen ?? null;
}

function timCotBang(cot: string[], ...tenGanDung: string[]): number {
  return cot.findIndex((c) => tenGanDung.some((t) => chuanHoaSoSanh(c).includes(chuanHoaSoSanh(t))));
}

export type ThuMuaVatTu = {
  tenVatTu: string;
  quyCach?: string;
  dvt: string;
  soLuong: number;
  mucDichSuDung?: string;
};

export type ThuMuaTaiLieuDinhKem = { ten: string; url: string };

export type ThuMuaPayload = {
  requestCode: string;
  requestId: string;
  tieuDe?: string;
  nguoiGuiTen: string;
  nguoiGuiUid?: string;
  nguoiGuiEmail: string;
  ngayGui: string;
  ngayDuyet: string;
  ngayCanGiao?: string;
  /** Rỗng = đề xuất của một phòng ban, không gắn công trình nào — Thu mua vẫn nhận. */
  congTrinhChuoi?: string;
  phongBan: string;
  vatTu: ThuMuaVatTu[];
  taiLieuDinhKem?: ThuMuaTaiLieuDinhKem[];
};

/** Cùng logic tải tệp đính kèm với `qlkctr-sync.ts` — xem chú thích ở đó. */
async function layTaiLieuDinhKem(request: RequestInstance): Promise<ThuMuaTaiLieuDinhKem[]> {
  const files: RequestAttachment[] = [];
  for (const field of request.fieldsSnapshot) {
    if (field.dataType !== "file") continue;
    const value = request.values[field.id];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const path = (item as Partial<RequestAttachment> | undefined)?.path;
      const name = (item as Partial<RequestAttachment> | undefined)?.name;
      if (typeof path === "string" && typeof name === "string") files.push({ path, name, size: 0 });
    }
  }
  if (files.length === 0) return [];

  const ketQua = await Promise.allSettled(files.map((f) => createSignedReadUrl(f.path)));
  const taiLieu: ThuMuaTaiLieuDinhKem[] = [];
  ketQua.forEach((r, i) => {
    if (r.status === "fulfilled") taiLieu.push({ ten: files[i].name, url: r.value });
  });
  return taiLieu;
}

/**
 * Trả `null` nếu không đủ dữ liệu để gửi (thiếu mã đề xuất, thiếu field "Chi tiết", thiếu
 * cột bắt buộc "Tên hàng"/"Số lượng", bảng chi tiết rỗng, hoặc KHÔNG tìm được field "Chọn bộ
 * phận") — KHÔNG throw, để nơi gọi tự quyết định bỏ qua êm.
 *
 * 🔴 KHÔNG gate theo công trình — đề xuất phòng ban (không có field "Tên đề xuất" hoặc field
 * đó rỗng) VẪN gửi, chỉ để `congTrinhChuoi` rỗng.
 */
export async function trichXuatPayloadThuMua(request: RequestInstance): Promise<ThuMuaPayload | null> {
  if (!request.code) return null;

  const detailField = timField(request.fieldsSnapshot, DETAIL_FIELD_CODES, ["Chi tiết", "Vật tư đề nghị"]);
  if (!detailField) return null;

  const cot = detailField.tableColumns ?? [];
  const idxTen = timCotBang(cot, "tên hàng", "tên vật tư");
  const idxSL = timCotBang(cot, "số lượng", "sl");
  if (idxTen < 0 || idxSL < 0) return null;
  const idxQuyCach = timCotBang(cot, "quy cách", "chủng loại");
  const idxDvt = timCotBang(cot, "đvt", "đơn vị");
  const idxMucDich = timCotBang(cot, "mục đích");

  const rows = deserializeTableRows(request.values[detailField.id]);
  const vatTu: ThuMuaVatTu[] = rows
    .map((r) => ({
      tenVatTu: (r[idxTen] ?? "").trim(),
      quyCach: idxQuyCach >= 0 ? r[idxQuyCach]?.trim() || undefined : undefined,
      dvt: idxDvt >= 0 ? (r[idxDvt] ?? "").trim() : "",
      soLuong: Number(r[idxSL]) || 0,
      mucDichSuDung: idxMucDich >= 0 ? r[idxMucDich]?.trim() || undefined : undefined,
    }))
    .filter((v) => v.tenVatTu && v.soLuong > 0);
  if (vatTu.length === 0) return null;

  const departmentField = request.fieldsSnapshot.find((f) => f.dataType === "department_select");
  const phongBan = departmentField ? String(request.values[departmentField.id] ?? "").trim() : "";
  if (!phongBan) return null;

  const titleField = timField(request.fieldsSnapshot, TITLE_FIELD_CODES, ["Tên đề xuất", "Tên đề nghị"]);
  const congTrinhChuoi = titleField ? String(request.values[titleField.id] ?? "").trim() || undefined : undefined;

  const taiLieuDinhKem = await layTaiLieuDinhKem(request);

  return {
    requestCode: request.code,
    requestId: request.id,
    tieuDe: congTrinhChuoi,
    nguoiGuiTen: request.submittedBy.name,
    nguoiGuiUid: request.submittedBy.uid,
    nguoiGuiEmail: request.submittedBy.email,
    ngayGui: request.submittedAt.slice(0, 10),
    ngayDuyet: new Date().toISOString().slice(0, 10),
    congTrinhChuoi,
    phongBan,
    vatTu,
    ...(taiLieuDinhKem.length > 0 ? { taiLieuDinhKem } : {}),
  };
}

export type KetQuaGuiThuMua =
  | { ok: true; trangThai: string; maDeNghi?: string }
  | { ok: false; error: string };

/** Không throw — mọi lỗi (thiếu cấu hình, mạng, HTTP lỗi) đều trả về qua `{ ok: false, error }`. */
export async function guiSangThuMua(payload: ThuMuaPayload): Promise<KetQuaGuiThuMua> {
  const url = process.env.THUMUA_API_URL;
  if (!url) return { ok: false, error: "Chưa cấu hình THUMUA_API_URL." };

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/app-request/de-nghi-moi`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.THUMUA_API_KEY ? { "x-api-key": process.env.THUMUA_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; trangThai?: string; maDeNghi?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, trangThai: data.trangThai ?? "", maDeNghi: data.maDeNghi };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi không xác định." };
  }
}
