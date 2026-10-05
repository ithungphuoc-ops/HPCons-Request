import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { ADJUSTMENT_HISTORY_PREFIX } from "@/lib/request-history-labels";
import type { RequestAttachment, RequestInstance } from "@/lib/types";

export type GhiDieuChinhKetQua =
  | { request: RequestInstance }
  | { loi: string; ma: number };

/**
 * Tính `{history, attachments, updatedAt}` mới sau khi ghi 1 dòng "điều chỉnh
 * sau duyệt" — hàm THUẦN, không đụng Firestore, để dùng được ở CẢ 2 nơi cần
 * ghi lịch sử bên trong 1 transaction CỦA RIÊNG HỌ: `ghiDieuChinhVaoLichSu()`
 * dưới đây (nhánh "direct") và route `adjustment/decision/route.ts` (nhánh
 * "gated", lúc đủ người duyệt cuối cùng — không gọi lồng `runTransaction`
 * được nên phải tách phần TÍNH TOÁN ra khỏi phần GHI).
 */
export function buildAdjustmentHistoryPatch(
  moiNhat: Pick<RequestInstance, "history" | "attachments">,
  input: { noiDung: string; attachment: RequestAttachment | null; actorName: string },
): Pick<RequestInstance, "history" | "attachments" | "updatedAt"> {
  const nowIso = new Date().toISOString();
  const lichSuCu = moiNhat.history ?? [];
  const soLan = lichSuCu.filter((h) => h.action.startsWith(ADJUSTMENT_HISTORY_PREFIX)).length + 1;
  const entry = {
    at: nowIso,
    actor: input.actorName,
    action: `${ADJUSTMENT_HISTORY_PREFIX} (lần ${soLan})`,
    note: input.noiDung || "(chỉ đính tệp)",
    ...(input.attachment ? { attachmentName: input.attachment.name } : {}),
  };
  return {
    history: [...lichSuCu, entry],
    attachments: input.attachment ? [...(moiNhat.attachments ?? []), input.attachment] : (moiNhat.attachments ?? []),
    updatedAt: nowIso,
  };
}

/**
 * Ghi 1 dòng "điều chỉnh sau duyệt" THẬT vào `history` (+ `attachments` nếu
 * có tệp) trong 1 transaction Firestore RIÊNG — dùng cho nhánh "direct"
 * (`adjustment/route.ts`, hành vi cũ, ghi ngay không cần ai duyệt). Nhánh
 * "gated" lúc đủ người duyệt cuối cùng dùng thẳng `buildAdjustmentHistoryPatch`
 * bên trong transaction CỦA route quyết định — xem design.md của change
 * add-adjustment-approval-conditions.
 *
 * 🔴 GHI TRONG GIAO DỊCH, không đọc-rồi-ghi-đè (CodeRabbit bắt trên PR #27) —
 * 2 lần gửi chạy song song vẫn giữ đủ cả 2 dòng, đánh số đúng thứ tự.
 */
export async function ghiDieuChinhVaoLichSu(
  requestId: string,
  input: { noiDung: string; attachment: RequestAttachment | null; actorName: string },
): Promise<GhiDieuChinhKetQua> {
  const ref = adminDb.collection("requests").doc(requestId);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { loi: "Không tìm thấy đề xuất." as const, ma: 404 };
    const moiNhat = { id: snap.id, ...snap.data() } as RequestInstance;

    if (moiNhat.deletedAt) return { loi: "Đề xuất này đã bị xoá." as const, ma: 409 };
    if (moiNhat.status !== "approved") {
      return { loi: "Chỉ ghi điều chỉnh được cho đề xuất đã duyệt." as const, ma: 400 };
    }

    const patch = buildAdjustmentHistoryPatch(moiNhat, input);
    tx.update(ref, patch);
    return { request: { ...moiNhat, ...patch } };
  });
}
