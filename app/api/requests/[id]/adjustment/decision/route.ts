import { after, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { guiCacViec, taoViecDongBo } from "@/lib/dong-bo/hang-cho";
import { buildAdjustmentHistoryPatch } from "@/lib/server/adjustment";
import { loadRequest } from "@/lib/server/requests";
import { requireSession, ForbiddenError } from "@/lib/session";
import type { RequestInstance } from "@/lib/types";

interface AdjustmentDecisionBody {
  decision?: unknown;
  /** Chỉ dùng khi decision = "forward" — người được chỉ định xử lý thay
   * ĐÚNG slot của người đang gọi (không đổi slot của người khác). */
  target?: { id?: unknown; name?: unknown };
}

/**
 * Duyệt / Từ chối / Chuyển tiếp cho 1 `pendingAdjustment` đang chờ ĐỦ người
 * duyệt (AND — mọi người trong `approvers[]` phải duyệt) — luồng RIÊNG cho
 * "Điều chỉnh đề nghị sau duyệt" (change add-adjustment-approval-conditions),
 * KHÁC HẲN `app/api/requests/[id]/decision/route.ts` (luồng duyệt CHÍNH của
 * đề xuất, `approvers[]`/`ApproverState`, không đụng).
 *
 * Quyền: CHỈ người có mặt trong `pendingAdjustment.approvers` VÀ CHƯA duyệt
 * (`approvedAt === null`) mới thao tác được slot của CHÍNH MÌNH — không có
 * khái niệm Owner/Admin thao tác thay.
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
    const mySlot = pending.approvers.find((a) => a.uid === session.uid);
    if (!mySlot || mySlot.approvedAt !== null) {
      throw new ForbiddenError("Bạn không có phần việc nào đang chờ xử lý trong điều chỉnh này.");
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
        return NextResponse.json({ error: "Không thể chuyển tiếp cho chính mình." }, { status: 400 });
      }
      const nowIso = new Date().toISOString();
      const ketQua = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { loi: "Không tìm thấy đề xuất." as const, ma: 404 };
        const moiNhat = { id: snap.id, ...snap.data() } as RequestInstance;
        const slots = moiNhat.pendingAdjustment?.approvers ?? [];
        const idx = slots.findIndex((a) => a.uid === session.uid && a.approvedAt === null);
        if (idx === -1) {
          return {
            loi: "Phần việc này đã được xử lý hoặc chuyển cho người khác rồi." as const,
            ma: 409,
          };
        }
        // Nếu `targetId` đã có mặt (đang chờ xử lý SLOT KHÁC) thì gộp slot này
        // vào, tránh 1 người xuất hiện 2 slot cùng lúc trong cùng điều chỉnh.
        const already = slots.some((a, i) => i !== idx && a.uid === targetId);
        const newApprovers = already
          ? slots.filter((_, i) => i !== idx)
          : slots.map((a, i) => (i === idx ? { uid: targetId, name: targetName, approvedAt: null } : a));
        const pendingAdjustment = { ...moiNhat.pendingAdjustment!, approvers: newApprovers };
        tx.update(ref, { pendingAdjustment, updatedAt: nowIso });
        return { request: { ...moiNhat, pendingAdjustment, updatedAt: nowIso } };
      });
      if ("loi" in ketQua) return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
      return NextResponse.json({ request: ketQua.request });
    }

    if (decision === "rejected") {
      // 1 người trong số những người cần duyệt từ chối = huỷ hẳn toàn bộ
      // (AND — thiếu 1 là hỏng cả) — KHÔNG đụng history/attachments.
      const nowIso = new Date().toISOString();
      const ketQua = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { loi: "Không tìm thấy đề xuất." as const, ma: 404 };
        const moiNhat = { id: snap.id, ...snap.data() } as RequestInstance;
        const slots = moiNhat.pendingAdjustment?.approvers ?? [];
        if (!slots.some((a) => a.uid === session.uid && a.approvedAt === null)) {
          return {
            loi: "Phần việc này đã được xử lý hoặc chuyển cho người khác rồi." as const,
            ma: 409,
          };
        }
        tx.update(ref, { pendingAdjustment: null, updatedAt: nowIso });
        return { request: { ...moiNhat, pendingAdjustment: null, updatedAt: nowIso } };
      });
      if ("loi" in ketQua) return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
      return NextResponse.json({ request: ketQua.request });
    }

    // decision === "approved" — đánh dấu slot của mình xong; nếu ĐỦ mọi
    // người thì ghi THẬT vào history (tái dùng `buildAdjustmentHistoryPatch`,
    // cùng 1 transaction — không gọi lồng `runTransaction`), xoá
    // `pendingAdjustment`, rồi MỚI báo Kho/Thu mua. Còn thiếu người thì chỉ
    // cập nhật `approvedAt` của đúng slot, chưa ghi gì cả.
    const nowIso = new Date().toISOString();
    const ketQua = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { loi: "Không tìm thấy đề xuất." as const, ma: 404 };
      const moiNhat = { id: snap.id, ...snap.data() } as RequestInstance;
      const pendingNow = moiNhat.pendingAdjustment;
      const idx = pendingNow?.approvers.findIndex((a) => a.uid === session.uid && a.approvedAt === null) ?? -1;
      if (!pendingNow || idx === -1) {
        return {
          loi: "Phần việc này đã được xử lý hoặc chuyển cho người khác rồi." as const,
          ma: 409,
        };
      }
      const updatedApprovers = pendingNow.approvers.map((a, i) => (i === idx ? { ...a, approvedAt: nowIso } : a));
      const allDone = updatedApprovers.every((a) => a.approvedAt !== null);

      if (!allDone) {
        const pendingAdjustment = { ...pendingNow, approvers: updatedApprovers };
        tx.update(ref, { pendingAdjustment, updatedAt: nowIso });
        return { request: { ...moiNhat, pendingAdjustment, updatedAt: nowIso }, finalized: false as const };
      }

      const historyPatch = buildAdjustmentHistoryPatch(moiNhat, {
        noiDung: pendingNow.noiDung,
        attachment: pendingNow.attachment,
        actorName: pendingNow.requestedByName,
      });
      const patch = { ...historyPatch, pendingAdjustment: null };
      tx.update(ref, patch);
      return { request: { ...moiNhat, ...patch }, finalized: true as const, pendingSnapshot: pendingNow };
    });
    if ("loi" in ketQua) {
      return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
    }
    if (ketQua.finalized) {
      const pendingSnapshot = ketQua.pendingSnapshot;
      try {
        const ids = await taoViecDongBo({
          requestId: id,
          requestCode: ketQua.request.code ?? null,
          loai: "dieu_chinh",
          nguoi: pendingSnapshot.requestedByName,
          noiDung:
            pendingSnapshot.noiDung ||
            (pendingSnapshot.attachment ? `(chỉ đính tệp: ${pendingSnapshot.attachment.name})` : ""),
          taiLieu: pendingSnapshot.attachment
            ? [{ name: pendingSnapshot.attachment.name, path: pendingSnapshot.attachment.path }]
            : [],
        });
        after(() => guiCacViec(ids));
      } catch (err) {
        console.error(`Tạo việc báo điều chỉnh (đã duyệt) đề xuất ${id} sang Kho / Thu mua lỗi:`, err);
      }
    }
    return NextResponse.json({ request: ketQua.request });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
