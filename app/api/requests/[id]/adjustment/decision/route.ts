import { after, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { guiCacViec, taoViecDongBo } from "@/lib/dong-bo/hang-cho";
import { ghiDieuChinhVaoLichSu } from "@/lib/server/adjustment";
import { loadRequest } from "@/lib/server/requests";
import { requireSession, ForbiddenError } from "@/lib/session";
import type { RequestInstance } from "@/lib/types";

interface AdjustmentDecisionBody {
  decision?: unknown;
  /** Chỉ dùng khi decision = "forward" — người được chỉ định xử lý thay. */
  target?: { id?: unknown; name?: unknown };
}

/**
 * Duyệt / Từ chối / Chuyển tiếp cho 1 `pendingAdjustment` đang chờ — luồng
 * RIÊNG cho "Điều chỉnh đề nghị sau duyệt" (change add-adjustment-approval-gate),
 * KHÁC HẲN `app/api/requests/[id]/decision/route.ts` (luồng duyệt CHÍNH của
 * đề xuất, state máy khác hẳn — `approvers[]`/`ApproverState`, không đụng).
 *
 * Quyền: CHỈ đúng `pendingAdjustment.approverUid` — không có khái niệm
 * Owner/Admin thao tác thay, giống tinh thần `canSupplementAfterApproval`.
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
    if (found.deletedAt) {
      return NextResponse.json({ error: "Đề xuất này đã bị xoá." }, { status: 409 });
    }
    const pending = found.pendingAdjustment;
    if (!pending) {
      return NextResponse.json(
        { error: "Đề xuất này không có điều chỉnh nào đang chờ duyệt." },
        { status: 400 },
      );
    }
    if (pending.approverUid !== session.uid) {
      throw new ForbiddenError("Chỉ đúng người đang được giao xử lý điều chỉnh này mới thao tác được.");
    }

    const body = (await request.json()) as AdjustmentDecisionBody;
    const decision = body.decision;
    if (decision !== "approved" && decision !== "rejected" && decision !== "forward") {
      return NextResponse.json({ error: "Quyết định không hợp lệ." }, { status: 400 });
    }

    const ref = adminDb.collection("requests").doc(id);

    if (decision === "forward") {
      const targetId = typeof body.target?.id === "string" ? body.target.id.trim() : "";
      const targetName = typeof body.target?.name === "string" ? body.target.name.trim() : "";
      if (!targetId || !targetName) {
        return NextResponse.json({ error: "Thiếu người được chuyển tiếp." }, { status: 400 });
      }
      if (targetId === session.uid) {
        return NextResponse.json(
          { error: "Không thể chuyển tiếp cho chính mình." },
          { status: 400 },
        );
      }
      const nowIso = new Date().toISOString();
      const ketQua = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { loi: "Không tìm thấy đề xuất." as const, ma: 404 };
        const moiNhat = { id: snap.id, ...snap.data() } as RequestInstance;
        if (!moiNhat.pendingAdjustment || moiNhat.pendingAdjustment.approverUid !== session.uid) {
          return {
            loi: "Điều chỉnh này đã được xử lý hoặc chuyển cho người khác rồi." as const,
            ma: 409,
          };
        }
        const pendingAdjustment: NonNullable<RequestInstance["pendingAdjustment"]> = {
          ...moiNhat.pendingAdjustment,
          approverUid: targetId,
          approverName: targetName,
        };
        tx.update(ref, { pendingAdjustment, updatedAt: nowIso });
        return { request: { ...moiNhat, pendingAdjustment, updatedAt: nowIso } };
      });
      if ("loi" in ketQua) return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
      return NextResponse.json({ request: ketQua.request });
    }

    if (decision === "rejected") {
      const nowIso = new Date().toISOString();
      const ketQua = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { loi: "Không tìm thấy đề xuất." as const, ma: 404 };
        const moiNhat = { id: snap.id, ...snap.data() } as RequestInstance;
        if (!moiNhat.pendingAdjustment || moiNhat.pendingAdjustment.approverUid !== session.uid) {
          return {
            loi: "Điều chỉnh này đã được xử lý hoặc chuyển cho người khác rồi." as const,
            ma: 409,
          };
        }
        // Huỷ hẳn — KHÔNG đụng history/attachments (Decision 5, change
        // add-adjustment-approval-gate).
        tx.update(ref, { pendingAdjustment: null, updatedAt: nowIso });
        return { request: { ...moiNhat, pendingAdjustment: null, updatedAt: nowIso } };
      });
      if ("loi" in ketQua) return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
      return NextResponse.json({ request: ketQua.request });
    }

    // decision === "approved" — ghi THẬT vào history (tái dùng đúng logic
    // route adjustment nhánh "direct"), xoá pendingAdjustment CÙNG transaction,
    // rồi MỚI báo Kho/Thu mua.
    const ketQua = await ghiDieuChinhVaoLichSu(id, {
      noiDung: pending.noiDung,
      attachment: pending.attachment,
      actorName: pending.requestedByName,
      extraPatch: { pendingAdjustment: null },
    });
    if ("loi" in ketQua) {
      return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
    }
    try {
      const ids = await taoViecDongBo({
        requestId: id,
        requestCode: ketQua.request.code ?? null,
        loai: "dieu_chinh",
        nguoi: pending.requestedByName,
        noiDung:
          pending.noiDung || (pending.attachment ? `(chỉ đính tệp: ${pending.attachment.name})` : ""),
        taiLieu: pending.attachment ? [{ name: pending.attachment.name, path: pending.attachment.path }] : [],
      });
      after(() => guiCacViec(ids));
    } catch (err) {
      console.error(`Tạo việc báo điều chỉnh (đã duyệt) đề xuất ${id} sang Kho / Thu mua lỗi:`, err);
    }
    return NextResponse.json({ request: ketQua.request });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
