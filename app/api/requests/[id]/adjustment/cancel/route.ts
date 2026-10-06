import { after, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import {
  ADJUSTMENT_CANCEL_REASON_MAX_LENGTH,
  buildAdjustmentCancelNote,
  canCancelPendingAdjustment,
} from "@/lib/adjustment-settings";
import { canManageGroupsAtAppScope } from "@/lib/permissions";
import { ADJUSTMENT_CANCELLED_ACTION } from "@/lib/request-history-labels";
import { bumpNotificationSignal } from "@/lib/server/notification-signal";
import { loadRequest } from "@/lib/server/requests";
import { requireSession, ForbiddenError } from "@/lib/session";
import type { RequestHistoryEntry, RequestInstance } from "@/lib/types";

interface AdjustmentCancelBody {
  /** `pendingAdjustment.createdAt` client ĐANG THẤY lúc bấm — giống route
   * `adjustment/decision`: lệch thì từ chối, không huỷ nhầm 1 điều chỉnh khác. */
  expectedCreatedAt?: unknown;
  /** Lý do huỷ — không bắt buộc. */
  reason?: unknown;
}

const NO_ACCESS = "Chỉ người đã gửi điều chỉnh hoặc Owner/Admin mới huỷ được điều chỉnh này.";
const CHANGED = "Điều chỉnh này đã thay đổi hoặc được xử lý xong rồi — vui lòng tải lại trang.";

/**
 * "Huỷ điều chỉnh" — rút lại 1 `pendingAdjustment` đang chờ duyệt (Sếp đồng ý
 * 06/10/2026: tránh treo khi người duyệt nghỉ/không xử lý). Sau khi huỷ,
 * người điều chỉnh gửi điều chỉnh mới bình thường.
 *
 * Quyền: người đã gửi điều chỉnh (`requestedByUid`) hoặc Owner/Admin — xem
 * `canCancelPendingAdjustment`. Người duyệt điều chỉnh dùng nút Từ chối.
 *
 * Ghi (trong transaction, kiểm lại `expectedCreatedAt` + `deletedAt`):
 * `pendingAdjustment: null` + 1 dòng history "Đã huỷ điều chỉnh chờ duyệt".
 * Giống nhánh Từ chối: KHÔNG báo Kho/Thu mua (chưa có hiệu lực), KHÔNG đưa
 * tệp của điều chỉnh vào `attachments`, KHÔNG gửi email (nhánh Từ chối hiện
 * cũng không gửi). Chỉ bump tín hiệu để chuông người duyệt tự hết thông báo.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const found = await loadRequest(id);
    if (!found) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    const isAdmin = canManageGroupsAtAppScope(session.role);
    if (found.deletedAt) {
      return NextResponse.json({ error: "Đề xuất này đã bị xoá." }, { status: 409 });
    }
    const pending = found.pendingAdjustment;
    if (!pending) {
      return NextResponse.json({ error: CHANGED }, { status: 409 });
    }
    if (!canCancelPendingAdjustment(pending, session.uid, isAdmin)) {
      throw new ForbiddenError(NO_ACCESS);
    }

    const body = (await request.json().catch(() => ({}))) as AdjustmentCancelBody;
    const expectedCreatedAt = typeof body.expectedCreatedAt === "string" ? body.expectedCreatedAt : "";
    if (!expectedCreatedAt) {
      return NextResponse.json({ error: "Thiếu thông tin điều chỉnh đang chờ duyệt." }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > ADJUSTMENT_CANCEL_REASON_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Lý do huỷ tối đa ${ADJUSTMENT_CANCEL_REASON_MAX_LENGTH} ký tự.` },
        { status: 400 },
      );
    }

    const ref = adminDb.collection("requests").doc(id);
    const nowIso = new Date().toISOString();
    const ketQua = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { loi: "Không tìm thấy đề xuất." as const, ma: 404 };
      const moiNhat = { id: snap.id, ...snap.data() } as RequestInstance;
      if (moiNhat.deletedAt) return { loi: "Đề xuất này đã bị xoá." as const, ma: 409 };
      const pendingNow = moiNhat.pendingAdjustment;
      if (!pendingNow || pendingNow.createdAt !== expectedCreatedAt) {
        return { loi: CHANGED, ma: 409 };
      }
      // Kiểm lại quyền theo bản MỚI NHẤT (cùng createdAt thì requestedByUid
      // không đổi, nhưng không tin bản đọc ngoài transaction).
      if (!canCancelPendingAdjustment(pendingNow, session.uid, isAdmin)) {
        return { loi: NO_ACCESS, ma: 403 };
      }
      const entry: RequestHistoryEntry = {
        at: nowIso,
        actor: session.name,
        action: ADJUSTMENT_CANCELLED_ACTION,
        note: buildAdjustmentCancelNote(pendingNow, reason),
      };
      const history = [...(moiNhat.history ?? []), entry];
      tx.update(ref, { pendingAdjustment: null, history, updatedAt: nowIso });
      return { request: { ...moiNhat, pendingAdjustment: null, history, updatedAt: nowIso } };
    });
    if ("loi" in ketQua) return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
    // Chuông của người duyệt tự tải lại → hết thông báo "chờ duyệt điều chỉnh".
    after(() => bumpNotificationSignal());
    return NextResponse.json({ request: ketQua.request });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
