import { NextResponse } from "next/server";
import {
  applyApproverDecision,
  approveAndForward,
  canApproverAct,
  DECISION_TO_APPROVAL_TIME_ACTION,
  forwardThenApprove,
  getRequestStatus,
  isApprovalTimeValueMissing,
  missingRequiredNote,
} from "@/lib/approval-logic";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { recomputeDeadlineForNextStep } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import type { ApprovalTimeField, ProposalGroup, RequestInstance, TaggedUser } from "@/lib/types";
import { guiSangQlkCtr, trichXuatPayload } from "@/lib/qlkctr-sync";
import { guiSangThuMua, trichXuatPayloadThuMua } from "@/lib/thumua-sync";

interface DecisionBody {
  decision: "approved" | "rejected" | "approve_and_forward" | "forward_then_approve" | "returned";
  /** Chỉ dùng khi decision = "approve_and_forward"/"forward_then_approve" — người được thêm vào duyệt. */
  target?: TaggedUser;
  /** Bắt buộc khi decision = "rejected" hoặc "returned" (§4.4 quy định phải có lý do). */
  note?: string;
  /** "Mẫu form phê duyệt" — CHỈ tham khảo, server tự xác định lại field thật
   * khớp (bước × hành động) của người đang quyết định, không tin nguyên giá
   * trị 2 field này từ client (xem đoạn validate approvalTimeField bên dưới). */
  approvalTimeFieldId?: string;
  approvalTimeValue?: unknown;
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
    let approvalTimeFields: ApprovalTimeField[] = [];
    // 3 field dùng để TÍNH LẠI deadlineAt khi chuyển sang bước duyệt tiếp
    // theo — xem recomputeDeadlineForNextStep() (lib/server/requests.ts).
    let approverSlaEnabled: boolean | undefined;
    let slaByWorkCalendar: boolean | undefined;
    let groupSlaHours: number | null = null;
    // Tải nhóm 1 LẦN nếu có groupId — cần cho cả requireDecisionNote (đã có
    // từ trước) VÀ "Mẫu form phê duyệt" (mới) — trước đây chỉ tải khi
    // approved/forward, giờ tải luôn cả "rejected" vì field cũng áp dụng
    // được cho hành động Từ chối.
    if (current.groupId) {
      const groupSnap = await adminDb.collection("groups").doc(current.groupId).get();
      const groupData = groupSnap.data() as Partial<ProposalGroup> | undefined;
      requireDecisionNote = groupData?.requireDecisionNote;
      approvalTimeFields = groupData?.approvalTimeFields ?? [];
      approverSlaEnabled = groupData?.approverSlaEnabled;
      slaByWorkCalendar = groupData?.slaByWorkCalendar;
      groupSlaHours = groupData?.slaHours ?? null;
    }
    if (missingRequiredNote(body.decision, body.note, requireDecisionNote)) {
      const message =
        body.decision === "rejected" || body.decision === "returned"
          ? "Cần nhập lý do khi từ chối hoặc trả lại đề xuất."
          : `Nhóm này yêu cầu nhập ý kiến khi ${body.decision === "approved" ? "chấp thuận" : "chuyển tiếp"}.`;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // "Mẫu form phê duyệt" — server TỰ xác định lại field khớp (bước × hành
    // động của NGƯỜI ĐANG QUYẾT ĐỊNH), không tin `body.approvalTimeFieldId`
    // — chỉ dùng để biết field nào, còn có áp dụng được không do server tính.
    // `current.approverStepMeta` cùng thứ tự với `current.approvers`.
    let matchedApprovalTimeField: ApprovalTimeField | undefined;
    const decisionAction = DECISION_TO_APPROVAL_TIME_ACTION[body.decision];
    if (decisionAction) {
      const myIndex = current.approvers.findIndex((a) => a.id === session.uid);
      const myStepCode = myIndex >= 0 ? current.approverStepMeta?.[myIndex]?.code : undefined;
      if (myStepCode) {
        matchedApprovalTimeField = approvalTimeFields.find(
          (f) => f.approverStepCode === myStepCode && f.decisionAction === decisionAction,
        );
      }
    }
    if (matchedApprovalTimeField && isApprovalTimeValueMissing(matchedApprovalTimeField.field, body.approvalTimeValue)) {
      return NextResponse.json(
        { error: `Cần điền "${matchedApprovalTimeField.field.name}" trước khi tiếp tục.` },
        { status: 400 },
      );
    }
    // Lưu vào `approvalTimeValues` (TÁCH BIỆT `values` — dữ liệu form gửi ban
    // đầu), key = id field đã được SERVER xác nhận khớp — không dùng thẳng
    // `body.approvalTimeFieldId` của client. Không có field khớp → giữ
    // nguyên `approvalTimeValues` cũ, không đổi.
    const approvalTimeValues = matchedApprovalTimeField
      ? { ...(current.approvalTimeValues ?? {}), [matchedApprovalTimeField.id]: body.approvalTimeValue }
      : current.approvalTimeValues;

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
      const viewedAt = { ...current.viewedAt, [session.uid]: nowIso };
      await ref.update({ approvers, status: "returned", history, updatedAt: nowIso, viewedAt });
      const updated: RequestInstance = {
        ...current,
        approvers,
        status: "returned",
        history,
        updatedAt: nowIso,
        viewedAt,
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
      const insertIndex = body.decision === "approve_and_forward" ? selfIndex + 1 : selfIndex;
      const approversSnapshot = [...current.approversSnapshot];
      approversSnapshot.splice(insertIndex, 0, body.target);
      // Phát hiện + vá lỗi có sẵn: `approverStepMeta` PHẢI cùng độ dài/thứ tự
      // với `approversSnapshot`/`approvers` (đọc bằng index ở nhiều nơi, vd
      // tra "Mẫu form phê duyệt" phía trên) — trước đây route này chèn người
      // mới vào approversSnapshot nhưng KHÔNG chèn gì vào approverStepMeta,
      // khiến 2 mảng lệch độ dài/thứ tự ngay sau lần chuyển tiếp ĐẦU TIÊN,
      // làm sai lệch mọi thứ tra theo index từ đó về sau (kể cả bước duyệt
      // của chính người bị chuyển tới lẫn tính SLA riêng bước bên dưới).
      // Người được chuyển tới là bổ sung tạm thời (không thuộc approverSteps
      // cấu hình sẵn của nhóm) nên chèn 1 mục rỗng {} — coi như "không có
      // tên/mã/SLA riêng", rơi về hành vi mặc định giống bước không cấu hình gì.
      const approverStepMeta = current.approverStepMeta ? [...current.approverStepMeta] : undefined;
      approverStepMeta?.splice(insertIndex, 0, {});
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
      const viewedAt = { ...current.viewedAt, [session.uid]: nowIso };
      const deadlineAt = recomputeDeadlineForNextStep({
        approvalFlow: current.approvalFlow,
        status: current.status,
        approvers,
        approverStepMeta,
        approverSlaEnabled,
        groupSlaHours,
        slaByWorkCalendar,
        now: new Date(nowIso),
      });
      const patch: Partial<RequestInstance> = {
        approvers,
        approversSnapshot,
        approverStepMeta,
        history,
        updatedAt: nowIso,
        approvalTimeValues,
        viewedAt,
      };
      if (deadlineAt !== undefined) patch.deadlineAt = deadlineAt;
      await ref.update(patch);
      const updated: RequestInstance = { ...current, ...patch };
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

    const viewedAt = { ...current.viewedAt, [session.uid]: nowIso };
    const deadlineAt = recomputeDeadlineForNextStep({
      approvalFlow: current.approvalFlow,
      status,
      approvers,
      approverStepMeta: current.approverStepMeta,
      approverSlaEnabled,
      groupSlaHours,
      slaByWorkCalendar,
      now: new Date(nowIso),
    });
    const decisionPatch: Partial<RequestInstance> = {
      approvers,
      status,
      history,
      updatedAt: nowIso,
      approvalTimeValues,
      viewedAt,
    };
    if (deadlineAt !== undefined) decisionPatch.deadlineAt = deadlineAt;
    await ref.update(decisionPatch);

    const updated: RequestInstance = { ...current, ...decisionPatch };

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

      // Đồng bộ sang App Thu mua (module mua hàng) — NHÁNH SONG SONG với QLK CTR ở trên,
      // KHÔNG phụ thuộc lẫn nhau (một cái lỗi không cản cái kia). Khác QLK CTR: Thu mua nhận
      // MỌI đề xuất duyệt xong, có công trình hay không — xem lib/thumua-sync.ts.
      try {
        const payloadThuMua = await trichXuatPayloadThuMua(updated);
        if (payloadThuMua) {
          const ketQuaThuMua = await guiSangThuMua(payloadThuMua);
          const syncEntryThuMua = {
            at: new Date().toISOString(),
            actor: "Hệ thống",
            action: ketQuaThuMua.ok ? "Đã đồng bộ sang App Thu mua" : "Đồng bộ App Thu mua thất bại",
            note: ketQuaThuMua.ok ? `Mã đề nghị: ${ketQuaThuMua.maDeNghi ?? "—"}` : ketQuaThuMua.error,
          };
          updated.history = [...updated.history, syncEntryThuMua];
          updated.thuMuaSyncStatus = ketQuaThuMua.ok ? "synced" : "failed";
          await ref.update({ history: updated.history, thuMuaSyncStatus: updated.thuMuaSyncStatus });
        }
      } catch (syncError) {
        console.error("Đồng bộ App Thu mua lỗi (không ảnh hưởng thao tác duyệt):", syncError);
        // Đánh dấu "failed" dù lỗi xảy ra NGOÀI guiSangThuMua (vốn tự bắt hết lỗi rồi trả
        // { ok:false } — hiếm khi tới đây, nhưng nếu tới thì vẫn cần cờ này để lần sau có
        // người mở đề xuất, retryThuMuaSyncNeuLoi() còn biết mà tự thử lại.
        try {
          await ref.update({ thuMuaSyncStatus: "failed" });
        } catch {
          // Bỏ qua — không để lỗi ghi cờ phụ này làm hỏng response duyệt chính.
        }
      }
    }

    return NextResponse.json({ request: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
