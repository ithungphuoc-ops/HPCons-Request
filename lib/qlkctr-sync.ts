import { createSignedReadUrl } from "@/lib/r2";
import { TITLE_FIELD_CODES } from "@/lib/request-title";
import { deserializeTableRows } from "@/lib/table-field";
import type { ProposalField, RequestAttachment, RequestInstance } from "@/lib/types";

/**
 * Đồng bộ đề xuất đã duyệt xong sang QLK CTR (app quản lý kho công trình) — xem
 * openspec/changes/add-qlkctr-sync-webhook. Không đổi field/UI nào của nhóm đề xuất,
 * chỉ đọc lại 2 field có sẵn ("Tên đề xuất" mang chuỗi "Mã hợp đồng - Tên công trình",
 * "Chi tiết" là bảng vật tư) rồi gửi sang API riêng của QLK CTR.
 *
 * Không có quyền đọc Firestore thật của app này để xác nhận đúng `field.code`/thứ tự cột
 * — nên tra theo NHIỀU mã quen thuộc + fallback theo tên hiển thị, và tra vị trí cột theo
 * TÊN cột (field.tableColumns) chứ không theo số thứ tự cố định.
 */

const DETAIL_FIELD_CODES = new Set(["chi_tiet", "vat_tu", "vat_tu_de_nghi", "danh_sach_vat_tu"]);
const LUA_CHON_DE_NGHI_FIELD_CODES = new Set(["lua_chon_de_nghi"]);
const NGAY_CAN_CAP_FIELD_CODES = new Set(["ngay_de_nghi_cap", "ngay_can_cap", "ngay_can_giao"]);

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

const GIA_TRI_DE_NGHI_CONG_TRINH = chuanHoaSoSanh("Đề nghị công trình");

export type QlkCtrVatTu = {
  tenVatTu: string;
  quyCach?: string;
  dvt: string;
  soLuong: number;
  mucDichSuDung?: string;
};

export type QlkCtrTaiLieuDinhKem = { ten: string; url: string };

export type QlkCtrPayload = {
  requestId: string;
  requestCode: string;
  tieuDe?: string;
  nguoiGui: string;
  ngayDuyet: string;
  ngayCanGiao?: string;
  congTrinhChuoi: string;
  vatTu: QlkCtrVatTu[];
  taiLieuDinhKem?: QlkCtrTaiLieuDinhKem[];
};

/**
 * Lấy tất cả file đính kèm ở MỌI field kiểu "file" của đề xuất (không giới hạn 1 field cụ thể —
 * BCH có thể đính kèm PDF/Excel ở bất kỳ field file nào nhóm cấu hình), quy đổi mỗi file thành 1
 * link tải có chữ ký (hết hạn sau 5 phút — đủ dùng vì QLK CTR tải ngay trong lúc xử lý request
 * duyệt này, xem lib/r2.ts::createSignedReadUrl). QLK CTR chỉ lưu lại để xem sau, không đọc dữ
 * liệu vật tư từ các file này (vật tư luôn lấy từ bảng "Chi tiết" như cũ).
 */
async function layTaiLieuDinhKem(request: RequestInstance): Promise<QlkCtrTaiLieuDinhKem[]> {
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
  const taiLieu: QlkCtrTaiLieuDinhKem[] = [];
  ketQua.forEach((r, i) => {
    if (r.status === "fulfilled") taiLieu.push({ ten: files[i].name, url: r.value });
  });
  return taiLieu;
}

/**
 * Trả về `null` nếu không đủ dữ liệu để gửi (thiếu field "Tên đề xuất"/"Chi tiết", thiếu cột
 * bắt buộc "Tên hàng"/"Số lượng", hoặc bảng chi tiết rỗng), HOẶC nếu field "Lựa chọn đề nghị" có
 * mặt nhưng giá trị KHÔNG phải "Đề nghị công trình" (VD "Đề nghị phòng ban" — không có công trình,
 * QLK CTR không giữ loại này) — KHÔNG throw, để nơi gọi tự quyết định bỏ qua êm (đề xuất không
 * liên quan công trình vẫn duyệt bình thường). Field không tồn tại (nhóm cũ chưa có) thì vẫn cho
 * qua như trước, để không phá luồng đã chạy ổn định.
 */
export async function trichXuatPayload(request: RequestInstance): Promise<QlkCtrPayload | null> {
  const titleField = timField(request.fieldsSnapshot, TITLE_FIELD_CODES, ["Tên đề xuất", "Tên đề nghị"]);
  const detailField = timField(request.fieldsSnapshot, DETAIL_FIELD_CODES, ["Chi tiết", "Vật tư đề nghị"]);
  if (!titleField || !detailField) return null;

  const luaChonField = timField(request.fieldsSnapshot, LUA_CHON_DE_NGHI_FIELD_CODES, ["Lựa chọn đề nghị"]);
  if (luaChonField) {
    const giaTri = chuanHoaSoSanh(String(request.values[luaChonField.id] ?? ""));
    if (giaTri && giaTri !== GIA_TRI_DE_NGHI_CONG_TRINH) return null;
  }

  const congTrinhChuoi = String(request.values[titleField.id] ?? "").trim();
  if (!congTrinhChuoi) return null;

  const cot = detailField.tableColumns ?? [];
  const idxTen = timCotBang(cot, "tên hàng", "tên vật tư");
  const idxSL = timCotBang(cot, "số lượng", "sl");
  if (idxTen < 0 || idxSL < 0) return null;
  const idxQuyCach = timCotBang(cot, "quy cách", "chủng loại");
  const idxDvt = timCotBang(cot, "đvt", "đơn vị");
  const idxMucDich = timCotBang(cot, "mục đích");

  const rows = deserializeTableRows(request.values[detailField.id]);
  const vatTu: QlkCtrVatTu[] = rows
    .map((r) => ({
      tenVatTu: (r[idxTen] ?? "").trim(),
      quyCach: idxQuyCach >= 0 ? r[idxQuyCach]?.trim() || undefined : undefined,
      dvt: idxDvt >= 0 ? (r[idxDvt] ?? "").trim() : "",
      soLuong: Number(r[idxSL]) || 0,
      mucDichSuDung: idxMucDich >= 0 ? r[idxMucDich]?.trim() || undefined : undefined,
    }))
    .filter((v) => v.tenVatTu && v.soLuong > 0);
  if (vatTu.length === 0) return null;

  const taiLieuDinhKem = await layTaiLieuDinhKem(request);

  const ngayCanCapField = timField(request.fieldsSnapshot, NGAY_CAN_CAP_FIELD_CODES, ["Ngày đề nghị cấp"]);
  const ngayCanGiao = ngayCanCapField
    ? String(request.values[ngayCanCapField.id] ?? "").trim() || undefined
    : undefined;

  return {
    requestId: request.id,
    requestCode: request.code ?? request.id,
    tieuDe: congTrinhChuoi,
    nguoiGui: request.submittedBy.name,
    ngayDuyet: new Date().toISOString().slice(0, 10),
    ...(ngayCanGiao ? { ngayCanGiao } : {}),
    congTrinhChuoi,
    vatTu,
    ...(taiLieuDinhKem.length > 0 ? { taiLieuDinhKem } : {}),
  };
}

export type KetQuaGuiQlkCtr =
  | { ok: true; trangThai: string; congTrinh?: string }
  | { ok: false; error: string };

/** Không throw — mọi lỗi (thiếu cấu hình, mạng, HTTP lỗi) đều trả về qua `{ ok: false, error }`. */
export async function guiSangQlkCtr(payload: QlkCtrPayload): Promise<KetQuaGuiQlkCtr> {
  const url = process.env.QLKCTR_API_URL;
  if (!url) return { ok: false, error: "Chưa cấu hình QLKCTR_API_URL." };

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/app-request/de-nghi-duyet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.QLKCTR_API_KEY ? { "x-api-key": process.env.QLKCTR_API_KEY } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; trangThai?: string; congTrinh?: string };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, trangThai: data.trangThai ?? "", congTrinh: data.congTrinh };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi không xác định." };
  }
}
