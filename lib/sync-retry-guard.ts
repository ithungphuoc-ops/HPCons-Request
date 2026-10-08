import type { RequestHistoryEntry } from "@/lib/types";

/**
 * Chặn "tự thử lại đồng bộ" (QLK CTR — lib/qlkctr-sync.ts, Thu mua — lib/thumua-sync.ts)
 * chạy quá dày. Trước 08/10/2026 MỖI lần mở danh sách "Tôi gửi đi" hoặc trang chi tiết
 * là thử lại ngay cho mọi đề xuất đang lỗi: trích payload (có thể đọc R2) + gọi app bên kia
 * + ghi thêm 1 dòng "… (tự thử lại)" vào `history` dù kết quả y hệt lần trước — 1 đề xuất
 * hỏng vì công trình chưa có bên Kho mà được mở 20 lần là 20 dòng nhật ký giống nhau.
 *
 * Giờ: mỗi đề xuất, mỗi kênh tối đa 1 lần / SYNC_RETRY_MIN_INTERVAL_MS (mốc lưu ở
 * `qlkCtrRetryAt` / `thuMuaRetryAt`, giữ chỗ bằng transaction nên 2 tab mở cùng lúc
 * không cùng gửi), và kết quả giống hệt dòng gần nhất của kênh đó thì KHÔNG nối thêm dòng.
 * Vẫn giữ tinh thần cũ: nhịp thử do người dùng mở đề xuất quyết định — chỉ thưa ra.
 */
export const SYNC_RETRY_MIN_INTERVAL_MS = 30 * 60 * 1000;

export type SyncRetryField = "qlkCtrRetryAt" | "thuMuaRetryAt";

/** Đã qua đủ khoảng cách tối thiểu kể từ lần thử lại trước chưa? */
export function duocThuLai(lastRetryAt: string | null | undefined, now: number): boolean {
  if (!lastRetryAt) return true;
  const last = Date.parse(lastRetryAt);
  if (Number.isNaN(last)) return true;
  return now - last >= SYNC_RETRY_MIN_INTERVAL_MS;
}

const HAU_TO_THU_LAI = " (tự thử lại)";
const boHauTo = (action: string) => (action.endsWith(HAU_TO_THU_LAI) ? action.slice(0, -HAU_TO_THU_LAI.length) : action);

/**
 * Dòng nhật ký sắp ghi có TRÙNG kết quả với dòng gần nhất của cùng kênh không (so hành
 * động — bỏ hậu tố "(tự thử lại)" — và ghi chú). Trùng → khỏi nối thêm.
 */
export function trungKetQuaLanTruoc(
  history: RequestHistoryEntry[] | undefined,
  entry: { action: string; note?: string },
  cungKenh: (action: string) => boolean,
): boolean {
  const last = [...(history ?? [])].reverse().find((h) => cungKenh(h.action));
  if (!last) return false;
  return boHauTo(last.action) === boHauTo(entry.action) && (last.note ?? "") === (entry.note ?? "");
}

/**
 * Giữ chỗ lượt thử lại: trong transaction, đọc mốc hiện tại; còn trong khoảng chờ → false
 * (không thử); ngược lại ghi mốc = bây giờ rồi trả true. Lỗi → false (thà bỏ 1 lượt thử
 * còn hơn gửi trùng; lượt mở sau sẽ thử).
 */
export async function giuChoThuLai(requestId: string, field: SyncRetryField, now = Date.now()): Promise<boolean> {
  try {
    const { adminDb } = await import("@/lib/firebase/admin");
    const ref = adminDb.collection("requests").doc(requestId);
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      if (!duocThuLai(snap.get(field) as string | undefined, now)) return false;
      tx.update(ref, { [field]: new Date(now).toISOString() });
      return true;
    });
  } catch (err) {
    console.error(`Giữ chỗ tự thử lại đồng bộ (${field}) cho đề xuất ${requestId} lỗi:`, err);
    return false;
  }
}
