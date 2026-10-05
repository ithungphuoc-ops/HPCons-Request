import "server-only";

import type { DichDongBo, LoaiSuKien } from "@/lib/dong-bo/luat";

/**
 * ★ GỬI SỰ KIỆN SAU DUYỆT sang Kho / Thu mua — đợt 1 "liên kết 4 app" (Sếp chốt 03/10/2026).
 *
 *   POST {QLKCTR_API_URL | THUMUA_API_URL}/api/app-request/cap-nhat-de-nghi
 *
 * Cùng 1 hợp đồng dữ liệu cho cả 2 app nhận (xem `CapNhatDeNghiTuAppRequest` bên QLK CTR,
 * lib/app-request-types.ts). Khoá: cùng biến với đường gửi đề nghị hiện có (QLKCTR_API_KEY /
 * THUMUA_API_KEY).
 *
 * Không throw — mọi lỗi trả qua `{ ok: false }` kèm `httpStatus` / `loaiLoi` để hàng chờ phân loại.
 */

export type GoiCapNhat = {
  suKienId: string;
  requestId: string;
  requestCode?: string;
  loai: Exclude<LoaiSuKien, "duyet">;
  luc: string;
  nguoi?: string;
  noiDung?: string;
  taiLieu?: { ten: string; url: string }[];
};

export type KetQuaGuiCapNhat =
  | { ok: true; trangThai: string; canhBao?: string }
  | { ok: false; error: string; httpStatus?: number; loaiLoi?: string };

// Bên nhận có thể phải tải file đính kèm về (Kho: tối đa 20 giây/file, tải song song).
const THOI_GIAN_CHO_MS = 25_000;

export async function guiCapNhatSuKien(dich: DichDongBo, goi: GoiCapNhat): Promise<KetQuaGuiCapNhat> {
  const url = dich === "kho" ? process.env.QLKCTR_API_URL : process.env.THUMUA_API_URL;
  const khoa = dich === "kho" ? process.env.QLKCTR_API_KEY : process.env.THUMUA_API_KEY;
  if (!url) {
    return {
      ok: false,
      loaiLoi: "vinh_vien",
      error: `Chưa cấu hình ${dich === "kho" ? "QLKCTR_API_URL" : "THUMUA_API_URL"}.`,
    };
  }

  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/app-request/cap-nhat-de-nghi`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(khoa ? { "x-api-key": khoa } : {}) },
      body: JSON.stringify(goi),
      signal: AbortSignal.timeout(THOI_GIAN_CHO_MS),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      trangThai?: string;
      canhBao?: string;
      loaiLoi?: string;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}`, httpStatus: res.status, loaiLoi: data.loaiLoi };
    }
    return { ok: true, trangThai: data.trangThai ?? "", ...(data.canhBao ? { canhBao: data.canhBao } : {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi không xác định." };
  }
}
