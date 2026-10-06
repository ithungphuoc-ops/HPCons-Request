import { after, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { guiCacViec, taoViecDongBo } from "@/lib/dong-bo/hang-cho";
import { pendingAdjustmentFiles } from "@/lib/adjustment-settings";
import { buildAdjustmentHistoryPatch } from "@/lib/server/adjustment";
import { loadAdjustmentGroupSettings } from "@/lib/server/adjustment-approval-rules";
import { loadActiveUsers } from "@/lib/server/adjustment-reviewers";
import { notifyAdjustmentApprovers } from "@/lib/server/notification-emails";
import { bumpNotificationSignal } from "@/lib/server/notification-signal";
import { loadRequest } from "@/lib/server/requests";
import { requireSession, ForbiddenError } from "@/lib/session";
import type { RequestInstance } from "@/lib/types";

interface AdjustmentDecisionBody {
  decision?: unknown;
  /** Chỉ dùng khi decision = "forward" — người được chỉ định xử lý thay
   * ĐÚNG slot của người đang gọi (không đổi slot của người khác). */
  target?: { id?: unknown; name?: unknown };
  /** `pendingAdjustment.createdAt` client ĐANG THẤY lúc bấm — "mã thế hệ" ổn
   * định suốt vòng đời 1 điều chỉnh (Chuyển tiếp không đổi field này, chỉ
   * Duyệt-đủ/Từ chối mới xoá hẳn rồi có thể tạo điều chỉnh MỚI khác
   * `createdAt`). CodeRabbit (PR #68) chỉ ra quyền duyệt trước đó chỉ khoá
   * theo uid+slot, không khoá theo ĐÚNG nội dung đang chờ — tab cũ/thao tác
   * trễ có thể vô tình duyệt NHẦM 1 điều chỉnh khác đã thay thế cái lúc đầu
   * xem. Bắt buộc gửi kèm, lệch thì từ chối thay vì âm thầm duyệt nhầm. */
  expectedCreatedAt?: unknown;
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
 * khái niệm Owner/Admin thao tác thay. MỌI quyết định đều kiểm lại
 * `expectedCreatedAt` + `deletedAt` BÊN TRONG transaction (không tin bản đọc
 * ban đầu) — xem design.md Decision 6 (vá theo review PR #68).
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
    const expectedCreatedAt = typeof body.expectedCreatedAt === "string" ? body.expectedCreatedAt : "";
    if (!expectedCreatedAt) {
      return NextResponse.json({ error: "Thiếu thông tin điều chỉnh đang chờ xử lý." }, { status: 400 });
    }

    const ref = adminDb.collection("requests").doc(id);

    /** Đọc + kiểm lại ĐÚNG slot/nội dung TRONG transaction — dùng chung cho cả
     * 3 nhánh, tránh 3 nơi tự viết lại cùng 4 điều kiện rồi lệch nhau. Trả
     * `null` nếu không hợp lệ (đã kèm sẵn lý do/mã lỗi cho nơi gọi trả về). */
    function checkPendingInTx(
      moiNhat: RequestInstance,
    ): { pendingNow: NonNullable<RequestInstance["pendingAdjustment"]>; idx: number } | { loi: string; ma: number } {
      if (moiNhat.deletedAt) return { loi: "Đề xuất này đã bị xoá." as const, ma: 409 };
      if (moiNhat.status !== "approved") {
        return { loi: "Đề xuất này không còn ở trạng thái đã duyệt." as const, ma: 409 };
      }
      const pendingNow = moiNhat.pendingAdjustment;
      if (!pendingNow || pendingNow.createdAt !== expectedCreatedAt) {
        return {
          loi: "Điều chỉnh này đã thay đổi hoặc được xử lý xong rồi — vui lòng tải lại trang." as const,
          ma: 409,
        };
      }
      const idx = pendingNow.approvers.findIndex((a) => a.uid === session.uid && a.approvedAt === null);
      if (idx === -1) {
        return {
          loi: "Phần việc này đã được xử lý hoặc chuyển cho người khác rồi." as const,
          ma: 409,
        };
      }
      return { pendingNow, idx };
    }

    if (decision === "forward") {
      const targetId = typeof body.target?.id === "string" ? body.target.id.trim() : "";
      if (!targetId) {
        return NextResponse.json({ error: "Thiếu người được chuyển tiếp." }, { status: 400 });
      }
      if (targetId === session.uid) {
        return NextResponse.json({ error: "Không thể chuyển tiếp cho chính mình." }, { status: 400 });
      }
      if (targetId === pending.requestedByUid) {
        return NextResponse.json(
          { error: "Không chuyển tiếp cho chính người đã đề nghị điều chỉnh." },
          { status: 400 },
        );
      }
      // Người nhận phải còn hoạt động ở App Tổng; tên lấy từ App Tổng (06/10/2026
      // — trước đây tin nguyên `target.name` client gửi lên).
      const targetUser = (await loadActiveUsers([targetId])).get(targetId);
      if (!targetUser) {
        return NextResponse.json(
          { error: "Người được chuyển tiếp không còn hoạt động ở App Tổng — chọn người khác." },
          { status: 400 },
        );
      }
      const targetName = targetUser.name;
      const nowIso = new Date().toISOString();
      const ketQua = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { loi: "Không tìm thấy đề xuất." as const, ma: 404 };
        const moiNhat = { id: snap.id, ...snap.data() } as RequestInstance;
        const checked = checkPendingInTx(moiNhat);
        if ("loi" in checked) return checked;
        const { pendingNow, idx } = checked;
        if (targetId === pendingNow.requestedByUid) {
          return { loi: "Không chuyển tiếp cho chính người đã đề nghị điều chỉnh." as const, ma: 400 };
        }
        // Người được chuyển tiếp tới ĐÃ có mặt ở 1 slot khác (dù đã duyệt hay
        // chưa) — từ chối thẳng thay vì tự gộp/xoá slot (CodeRabbit PR #68:
        // gộp sai lúc slot kia ĐÃ duyệt từng làm "mất" 1 yêu cầu duyệt mà
        // không ai hay, có thể kẹt vĩnh viễn nếu đó là slot cuối cùng).
        if (pendingNow.approvers.some((a, i) => i !== idx && a.uid === targetId)) {
          return {
            loi: "Người này đã có trong danh sách người duyệt của điều chỉnh này rồi, hãy chọn người khác." as const,
            ma: 400,
          };
        }
        const approvers = pendingNow.approvers.map((a, i) =>
          i === idx ? { uid: targetId, name: targetName, approvedAt: null } : a,
        );
        const pendingAdjustment = { ...pendingNow, approvers };
        tx.update(ref, {
          pendingAdjustment,
          // Người nhận chuyển tiếp xem được đề xuất (canView) cả sau khi xong.
          adjustmentReviewerUids: FieldValue.arrayUnion(targetId),
          updatedAt: nowIso,
        });
        const adjustmentReviewerUids = Array.from(new Set([...(moiNhat.adjustmentReviewerUids ?? []), targetId]));
        return { request: { ...moiNhat, pendingAdjustment, adjustmentReviewerUids, updatedAt: nowIso } };
      });
      if ("loi" in ketQua) return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
      const saved = ketQua.request;
      after(() => bumpNotificationSignal());
      after(async () => {
        const settings = await loadAdjustmentGroupSettings(saved.groupId);
        await notifyAdjustmentApprovers([targetId], saved, pending.requestedByName, settings);
      });
      return NextResponse.json({ request: saved });
    }

    if (decision === "rejected") {
      // 1 người trong số những người cần duyệt từ chối = huỷ hẳn toàn bộ
      // (AND — thiếu 1 là hỏng cả) — KHÔNG đụng history/attachments.
      const nowIso = new Date().toISOString();
      const ketQua = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { loi: "Không tìm thấy đề xuất." as const, ma: 404 };
        const moiNhat = { id: snap.id, ...snap.data() } as RequestInstance;
        const checked = checkPendingInTx(moiNhat);
        if ("loi" in checked) return checked;
        tx.update(ref, { pendingAdjustment: null, updatedAt: nowIso });
        return { request: { ...moiNhat, pendingAdjustment: null, updatedAt: nowIso } };
      });
      if ("loi" in ketQua) return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
      after(() => bumpNotificationSignal());
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
      const checked = checkPendingInTx(moiNhat);
      if ("loi" in checked) return checked;
      const { pendingNow, idx } = checked;

      const updatedApprovers = pendingNow.approvers.map((a, i) => (i === idx ? { ...a, approvedAt: nowIso } : a));
      const allDone = updatedApprovers.every((a) => a.approvedAt !== null);

      if (!allDone) {
        const pendingAdjustment = { ...pendingNow, approvers: updatedApprovers };
        tx.update(ref, { pendingAdjustment, updatedAt: nowIso });
        return { request: { ...moiNhat, pendingAdjustment, updatedAt: nowIso }, finalized: false as const };
      }

      const historyPatch = buildAdjustmentHistoryPatch(moiNhat, {
        noiDung: pendingNow.noiDung,
        // Đọc được cả điều chỉnh CŨ (1 tệp `attachment`) lẫn mới (`attachments`).
        files: pendingAdjustmentFiles(pendingNow),
        actorName: pendingNow.requestedByName,
        actorUid: pendingNow.requestedByUid,
      });
      const patch = { ...historyPatch, pendingAdjustment: null };
      tx.update(ref, patch);
      return { request: { ...moiNhat, ...patch }, finalized: true as const, pendingSnapshot: pendingNow };
    });
    if ("loi" in ketQua) {
      return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
    }
    after(() => bumpNotificationSignal());
    if (ketQua.finalized) {
      const pendingSnapshot = ketQua.pendingSnapshot;
      const files = pendingAdjustmentFiles(pendingSnapshot);
      try {
        const ids = await taoViecDongBo({
          requestId: id,
          requestCode: ketQua.request.code ?? null,
          loai: "dieu_chinh",
          nguoi: pendingSnapshot.requestedByName,
          noiDung:
            pendingSnapshot.noiDung ||
            (files.length > 0 ? `(chỉ đính tệp: ${files.map((f) => f.name).join(", ")})` : ""),
          taiLieu: files.map((f) => ({ name: f.name, path: f.path })),
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
