import { TITLE_FIELD_CODES } from "@/lib/request-title";
import { deserializeTableRows } from "@/lib/table-field";
import type { ProposalField, RequestInstance } from "@/lib/types";

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

export type QlkCtrVatTu = {
  tenVatTu: string;
  quyCach?: string;
  dvt: string;
  soLuong: number;
  mucDichSuDung?: string;
};

export type QlkCtrPayload = {
  requestId: string;
  requestCode: string;
  tieuDe?: string;
  nguoiGui: string;
  ngayDuyet: string;
  congTrinhChuoi: string;
  vatTu: QlkCtrVatTu[];
};

/**
 * Trả về `null` nếu không đủ dữ liệu để gửi (thiếu field "Tên đề xuất"/"Chi tiết", thiếu cột
 * bắt buộc "Tên hàng"/"Số lượng", hoặc bảng chi tiết rỗng) — KHÔNG throw, để nơi gọi tự quyết
 * định bỏ qua êm (đề xuất không liên quan công trình vẫn duyệt bình thường).
 */
export function trichXuatPayload(request: RequestInstance): QlkCtrPayload | null {
  const titleField = timField(request.fieldsSnapshot, TITLE_FIELD_CODES, ["Tên đề xuất", "Tên đề nghị"]);
  const detailField = timField(request.fieldsSnapshot, DETAIL_FIELD_CODES, ["Chi tiết", "Vật tư đề nghị"]);
  if (!titleField || !detailField) return null;

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

  return {
    requestId: request.id,
    requestCode: request.code ?? request.id,
    tieuDe: congTrinhChuoi,
    nguoiGui: request.submittedBy.name,
    ngayDuyet: new Date().toISOString().slice(0, 10),
    congTrinhChuoi,
    vatTu,
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
