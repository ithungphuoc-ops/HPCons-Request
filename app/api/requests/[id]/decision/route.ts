import { NextResponse } from "next/server";
import {
  applyApproverDecision,
  approveAndForward,
  canApproverAct,
  forwardThenApprove,
  getRequestStatus,
  missingRequiredNote,
} from "@/lib/approval-logic";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireSession } from "@/lib/session";
import type { RequestInstance, TaggedUser } from "@/lib/types";
import { guiSangQlkCtr, trichXuatPayload } from "@/lib/qlkctr-sync";

interface DecisionBody {
  decision: "approved" | "rejected" | "approve_and_forward" | "forward_then_approve" | "returned";
  /** Chỉ dùng khi decision = "approve_and_forward"/"forward_then_approve" — người được thêm vào duyệt. */
  target?: TaggedUser;
  /** Bắt buộc khi decision = "rejected" hoặc "returned" (§4.4 quy định phải có lý do). */
  note?: string;
}

const ACTION_LABEL: Record<DecisionBody["decision"], string> = {
  approved: "Đã chấp thuận",
  rejected: "Đã từ chối",
  approve_and_forward: "Đã chấp thuận và chuyển tiếp",
  forward_then_approve: "Đã chuyển tiếp cho duyệt trước",
  returned: "Đã trả lại",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = (await request.json()) as DecisionBody;

    const ref = adminDb.collection("requests").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    const current = { id: snap.id, ...snap.data() } as RequestInstance;
    const nowIso = new Date().toISOString();

    // Nhóm có thể bắt buộc thêm ghi chú cho "Chấp thuận"/"Chuyển tiếp" (mặc
    // định KHÔNG bắt buộc, giữ đúng hành vi hiện có) — "rejected"/"returned"
    // LUÔN bắt buộc sẵn, không phụ thuộc cấu hình nhóm (xem missingRequiredNote).
    const isForwardDecision =
      body.decision === "approve_and_forward" || body.decision === "forward_then_approve";
    let requireDecisionNote: { approve?: boolean; forward?: boolean } | undefined;
    if (current.groupId && (body.decision === "approved" || isForwardDecision)) {
      const groupSnap = await adminDb.collection("groups").doc(current.groupId).get();
      requireDecisionNote = (
        groupSnap.data() as { requireDecisionNote?: { approve?: boolean; forward?: boolean } } | undefined
      )?.requireDecisionNote;
    }
    if (missingRequiredNote(body.decision, body.note, requireDecisionNote)) {
      const message =
        body.decision === "rejected" || body.decision === "returned"
          ? "Cần nhập lý do khi từ chối hoặc trả lại đề xuất."
          : `Nhóm này yêu cầu nhập ý kiến khi ${body.decision === "approved" ? "chấp thuận" : "chuyển tiếp"}.`;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (body.decision === "returned") {
      if (!canApproverAct(current.approvalFlow, current.approvers, session.uid)) {
        return NextResponse.json(
          { error: "Bạn chưa tới lượt hoặc đã xử lý đề xuất này." },
          { status: 409 },
        );
      }
      // Trả lại reset toàn bộ người duyệt về "pending" — khi người tạo gửi lại,
      // quy trình duyệt chạy lại từ đầu (khớp sơ đồ trạng thái §3.5).
      const approvers = current.approvers.map((a) => ({ ...a, decision: "pending" as const }));
      const history = [
        ...current.history,
        { at: nowIso, actor: session.name, action: ACTION_LABEL.returned, note: body.note },
      ];
      await ref.update({ approvers, status: "returned", history, updatedAt: nowIso });
      const updated: RequestInstance = {
        ...current,
        approvers,
        status: "returned",
        history,
        updatedAt: nowIso,
      };
      return NextResponse.json({ request: updated });
    }

    if (isForwardDecision) {
      if (!body.target) {
        return NextResponse.json(
          { error: "Thiếu người nhận chuyển tiếp." },
          { status: 400 },
        );
      }
      // approveAndForward/forwardThenApprove ném ApprovalActionError nếu chưa
      // tới lượt, đã quyết định rồi, hoặc người nhận đã có mặt — apiErrorResponse
      // map thành 409. Người chuyển KHÔNG bị thay thế ở cả 2 kiểu (khác hành vi
      // "forwarded" cũ) nên approversSnapshot phải CHÈN người mới, không map-thay.
      const approvers =
        body.decision === "approve_and_forward"
          ? approveAndForward(current.approvalFlow, current.approvers, session.uid, body.target.id)
          : forwardThenApprove(current.approvalFlow, current.approvers, session.uid, body.target.id);
      const selfIndex = current.approversSnapshot.findIndex((a) => a.id === session.uid);
      const approversSnapshot = [...current.approversSnapshot];
      approversSnapshot.splice(
        body.decision === "approve_and_forward" ? selfIndex + 1 : selfIndex,
        0,
        body.target,
      );
      const history = [
        ...current.history,
        {
          at: nowIso,
          actor: session.name,
          action: ACTION_LABEL[body.decision],
          target: body.target.name,
          note: body.note,
        },
      ];
      await ref.update({ approvers, approversSnapshot, history, updatedAt: nowIso });
      const updated: RequestInstance = {
        ...current,
        approvers,
        approversSnapshot,
        history,
        updatedAt: nowIso,
      };
      return NextResponse.json({ request: updated });
    }

    // Tới đây chỉ còn "approved"/"rejected" (returned và 2 kiểu chuyển tiếp đã
    // return ở trên) — kiểm tra tường minh để TS thu hẹp kiểu, đồng thời chặn
    // luôn giá trị lạ nếu có.
    if (body.decision !== "approved" && body.decision !== "rejected") {
      return NextResponse.json({ error: "Quyết định không hợp lệ." }, { status: 400 });
    }

    // applyApproverDecision ném ApprovalActionError nếu chưa tới lượt hoặc đã
    // quyết định rồi — apiErrorResponse tự map lỗi này thành 409.
    const approvers = applyApproverDecision(
      current.approvalFlow,
      current.approvers,
      session.uid,
      body.decision,
    );
    const status = getRequestStatus(current.approvalFlow, approvers);
    const history = [
      ...current.history,
      { at: nowIso, actor: session.name, action: ACTION_LABEL[body.decision], note: body.note },
    ];

    await ref.update({ approvers, status, history, updatedAt: nowIso });

    const updated: RequestInstance = {
      ...current,
      approvers,
      status,
      history,
      updatedAt: nowIso,
    };

    // Đồng bộ sang QLK CTR (app quản lý kho công trình) khi duyệt xong hoàn toàn — xem
    // openspec/changes/add-qlkctr-sync-webhook. Bọc try/catch riêng, tuyệt đối không được để lỗi
    // ở đây làm hỏng response duyệt đề xuất chính (đề xuất vẫn đã duyệt xong dù đồng bộ lỗi).
    if (status === "approved") {
      try {
        const payload = await trichXuatPayload(updated);
        if (payload) {
          const ketQua = await guiSangQlkCtr(payload);
          const syncEntry = {
            at: new Date().toISOString(),
            actor: "Hệ thống",
            action: ketQua.ok ? "Đã đồng bộ sang QLK CTR" : "Đồng bộ QLK CTR thất bại",
            note: ketQua.ok ? `Công trình: ${ketQua.congTrinh ?? "chờ xác nhận"}` : ketQua.error,
          };
          updated.history = [...updated.history, syncEntry];
          await ref.update({ history: updated.history });
        }
      } catch (syncError) {
        console.error("Đồng bộ QLK CTR lỗi (không ảnh hưởng thao tác duyệt):", syncError);
      }
    }

    return NextResponse.json({ request: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
