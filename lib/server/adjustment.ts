import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { ADJUSTMENT_HISTORY_PREFIX } from "@/lib/request-history-labels";
import type { RequestAttachment, RequestInstance } from "@/lib/types";

export type GhiDieuChinhKetQua =
  | { request: RequestInstance }
  | { loi: string; ma: number };

/**
 * Ghi 1 dòng "điều chỉnh sau duyệt" THẬT vào `history` (+ `attachments` nếu
 * có tệp) trong 1 transaction Firestore — dùng CHUNG cho nhánh "direct"
 * (`adjustment/route.ts`, hành vi cũ) và nhánh "gated" SAU KHI được Duyệt
 * (`adjustment/decision/route.ts`) — xem design.md của change
 * add-adjustment-approval-gate. Tách ra đây để 2 nơi không viết lặp lại logic
 * đếm "lần N" rồi lệch nhau dần theo thời gian (bài học CodeRabbit PR #27 —
 * transaction thay vì đọc-rồi-ghi-đè, giữ nguyên cách làm cũ).
 *
 * `extraPatch` — field khác cần ghi CÙNG LÚC trong transaction này, ví dụ
 * `{ pendingAdjustment: null }` khi gọi từ route quyết định (xoá điều chỉnh
 * đang chờ ngay lúc ghi lịch sử, không tách 2 lần ghi riêng).
 */
export async function ghiDieuChinhVaoLichSu(
  requestId: string,
  input: {
    noiDung: string;
    attachment: RequestAttachment | null;
    actorName: string;
    extraPatch?: Partial<RequestInstance>;
  },
): Promise<GhiDieuChinhKetQua> {
  const nowIso = new Date().toISOString();
  const ref = adminDb.collection("requests").doc(requestId);

  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { loi: "Không tìm thấy đề xuất." as const, ma: 404 };
    const moiNhat = { id: snap.id, ...snap.data() } as RequestInstance;

    if (moiNhat.deletedAt) return { loi: "Đề xuất này đã bị xoá." as const, ma: 409 };
    if (moiNhat.status !== "approved") {
      return { loi: "Chỉ ghi điều chỉnh được cho đề xuất đã duyệt." as const, ma: 400 };
    }

    const lichSuCu = moiNhat.history ?? [];
    const soLan = lichSuCu.filter((h) => h.action.startsWith(ADJUSTMENT_HISTORY_PREFIX)).length + 1;
    const entry = {
      at: nowIso,
      actor: input.actorName,
      action: `${ADJUSTMENT_HISTORY_PREFIX} (lần ${soLan})`,
      note: input.noiDung || "(chỉ đính tệp)",
      ...(input.attachment ? { attachmentName: input.attachment.name } : {}),
    };
    const history = [...lichSuCu, entry];
    const attachments = input.attachment
      ? [...(moiNhat.attachments ?? []), input.attachment]
      : (moiNhat.attachments ?? []);

    const patch = { history, attachments, updatedAt: nowIso, ...input.extraPatch };
    tx.update(ref, patch);
    return { request: { ...moiNhat, ...patch } };
  });
}
