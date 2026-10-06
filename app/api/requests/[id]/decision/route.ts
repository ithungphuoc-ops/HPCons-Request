import { after, NextResponse } from "next/server";
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
import { sanitizeDecisionNoteInput } from "@/lib/decision-note";
import { apiErrorResponse } from "@/lib/http";
import { notifyFollowersFullyApproved, notifyPendingApprovers, notifySubmitterResult } from "@/lib/server/notification-emails";
import { recomputeDeadlineForNextStep } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import type { ApprovalTimeField, GroupNotificationRules, ProposalGroup, RequestInstance, TaggedUser } from "@/lib/types";
import { guiCacViec, taoViecDongBo } from "@/lib/dong-bo/hang-cho";

// Gửi sang Kho / Thu mua chạy trong after() của chính lần gọi này — cho đủ thời gian (gói miễn phí
// cho tối đa 60 giây). Xem lib/dong-bo/hang-cho.ts.
export const maxDuration = 60;

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

    // "Ý kiến khi phê duyệt" theo nhóm (có ô / bắt buộc cho 4 hành động) —
    // "returned" LUÔN bắt buộc, "rejected" mặc định bắt buộc như cũ, ô đã tắt
    // thì không bắt buộc (xem missingRequiredNote + lib/decision-note.ts).
    const isForwardDecision =
      body.decision === "approve_and_forward" || body.decision === "forward_then_approve";
    let requireDecisionNote: ProposalGroup["requireDecisionNote"];
    let decisionNoteEnabled: ProposalGroup["decisionNoteEnabled"];
    let approvalTimeFields: ApprovalTimeField[] = [];
    // 3 field dùng để TÍNH LẠI deadlineAt khi chuyển sang bước duyệt tiếp
    // theo — xem recomputeDeadlineForNextStep() (lib/server/requests.ts).
    let approverSlaEnabled: boolean | undefined;
    let slaByWorkCalendar: boolean | undefined;
    let groupSlaHours: number | null = null;
    // Mặc định `true` — trước 24/08/2026 KHÔNG có cờ nào cả, "Chuyển tiếp và
    // Duyệt" luôn cho phép mọi nhóm; giữ đúng hành vi cũ cho nhóm chưa từng
    // đụng vào cờ này (khớp DEFAULT_GROUP_PERMISSION_RULES ở lib/types.ts).
    let approversCanDelegateApproval = true;
    // Dùng để gửi email thông báo thật (Sếp chốt 24/08/2026) — chỉ cần đúng
    // field này, xem GroupNotificationSource ở lib/server/notification-emails.ts.
    let notificationRules: GroupNotificationRules | undefined;
    // Tải nhóm 1 LẦN nếu có groupId — cần cho cả requireDecisionNote (đã có
    // từ trước) VÀ "Mẫu form phê duyệt" (mới) — trước đây chỉ tải khi
    // approved/forward, giờ tải luôn cả "rejected" vì field cũng áp dụng
    // được cho hành động Từ chối.
    if (current.groupId) {
      const groupSnap = await adminDb.collection("groups").doc(current.groupId).get();
      const groupData = groupSnap.data() as Partial<ProposalGroup> | undefined;
      requireDecisionNote = groupData?.requireDecisionNote;
      decisionNoteEnabled = groupData?.decisionNoteEnabled;
      approvalTimeFields = groupData?.approvalTimeFields ?? [];
      approverSlaEnabled = groupData?.approverSlaEnabled;
      slaByWorkCalendar = groupData?.slaByWorkCalendar;
      groupSlaHours = groupData?.slaHours ?? null;
      notificationRules = groupData?.notificationRules;
      if (groupData?.permissionRules?.approversCanDelegateApproval === false) {
        approversCanDelegateApproval = false;
      }
    }
    // Chuẩn hoá ghi chú: không phải chuỗi → 400; ô của hành động này đã tắt
    // trong nhóm → bỏ note (trừ Trả lại). Xem sanitizeDecisionNoteInput.
    const noteInput = sanitizeDecisionNoteInput(body.decision, body.note, { requireDecisionNote, decisionNoteEnabled });
    if (!noteInput.ok) {
      return NextResponse.json({ error: noteInput.error }, { status: 400 });
    }
    body.note = noteInput.note;
    if (missingRequiredNote(body.decision, body.note, requireDecisionNote, decisionNoteEnabled)) {
      const message =
        body.decision === "rejected" || body.decision === "returned"
          ? "Cần nhập lý do khi từ chối hoặc trả lại đề xuất."
          : `Nhóm này yêu cầu nhập ý kiến khi ${body.decision === "approved" ? "chấp thuận" : "chuyển tiếp"}.`;
      return NextResponse.json({ error: message }, { status: 400 });
    }
    // Chặn server-side, không chỉ ẩn UI — nhóm tắt cờ này (Sếp chốt
    // 24/08/2026, xem ForwardModal.tsx) không cho "Chuyển tiếp và Duyệt"
    // (người nhận xử lý trước rồi mới quay lại người chuyển).
    if (body.decision === "forward_then_approve" && !approversCanDelegateApproval) {
      return NextResponse.json(
        { error: "Nhóm này không cho phép chuyển tiếp cho người khác duyệt trước." },
        { status: 403 },
      );
    }

    // "Mẫu form phê duyệt" — server TỰ xác định lại field khớp (bước × hành
    // động của NGƯỜI ĐANG QUYẾT ĐỊNH), không tin `body.approvalTimeFieldId`
    // — chỉ dùng để biết field nào, còn có áp dụng được không do server tính.
    // `current.approverStepMeta` cùng thứ tự với `current.approvers`.
    let matchedApprovalTimeField: ApprovalTimeField | undefined;
    const decisionAction = DECISION_TO_APPROVAL_TIME_ACTION[body.decision];
    // Chỉ tin `approverStepMeta` theo index khi độ dài KHỚP ĐÚNG `approvers` —
    // đề xuất từng bị "Chuyển tiếp" TRƯỚC bản vá lỗi lệch mảng (xem
    // recomputeDeadlineForNextStep() ở lib/server/requests.ts) có thể có mảng
    // ngắn hơn/lệch thứ tự, tra theo index sẽ ra field/bước SAI. Lệch độ dài →
    // coi như không có meta, an toàn hơn là đoán nhầm bước.
    const alignedStepMeta =
      current.approverStepMeta?.length === current.approvers.length ? current.approverStepMeta : undefined;
    if (decisionAction) {
      const myIndex = current.approvers.findIndex((a) => a.id === session.uid);
      const myStepCode = myIndex >= 0 ? alignedStepMeta?.[myIndex]?.code : undefined;
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

      // Email thông báo thật (Sếp chốt 24/08/2026) — người vừa được chuyển
      // tới (hoặc người kế tiếp theo thứ tự) đang chờ xử lý.
      //
      // ⚠️ ĐỔI 21/09/2026 — dùng after() (next/server), lý do đầy đủ xem
      // comment ở app/api/requests/route.ts (cùng thay đổi, cùng ngày).
      after(async () => {
        try {
          await notifyPendingApprovers(updated, { notificationRules });
        } catch (mailError) {
          console.error("Gửi email thông báo lúc chuyển tiếp thất bại (không ảnh hưởng thao tác chính):", mailError);
        }
      });

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

    // Email thông báo thật (Sếp chốt 24/08/2026): còn "pending" → báo người
    // kế tiếp đang tới lượt; đã xong (approved/rejected) → báo người tạo
    // (luôn báo) + người theo dõi (chỉ khi approved hoàn toàn).
    //
    // ⚠️ ĐỔI 21/09/2026 — dùng after() (next/server) thay vì await trước khi
    // trả response, lý do đầy đủ xem comment ở app/api/requests/route.ts
    // (cùng thay đổi, cùng ngày). Từ 03/10/2026 phần đồng bộ QLK CTR / Thu mua
    // ngay dưới đây CŨNG chạy trong after() qua hàng chờ (lib/dong-bo/hang-cho.ts)
    // — nên dòng nhật ký "Đã đồng bộ…" không còn nằm trong response duyệt này,
    // hàng chờ ghi thẳng vào Firestore khi gửi xong.
    after(async () => {
      try {
        if (status === "pending") {
          await notifyPendingApprovers(updated, { notificationRules });
        } else {
          await notifySubmitterResult(updated, { notificationRules });
          if (status === "approved") await notifyFollowersFullyApproved(updated, { notificationRules });
        }
      } catch (mailError) {
        console.error("Gửi email thông báo sau quyết định thất bại (không ảnh hưởng thao tác chính):", mailError);
      }
    });

    // 📌 (03/10/2026) Đoạn đồng bộ ngay dưới KHÔNG còn mutate `updated` nữa — kết quả gửi Kho /
    // Thu mua được hàng chờ ghi thẳng vào Firestore sau (arrayUnion vào history), nên `updated`
    // mà callback email ở trên nhìn thấy giữ nguyên như lúc gọi after().

    // ★★ (03/10/2026, Sếp chốt — đợt 1 "liên kết 4 app") Đồng bộ sang Kho (QLK CTR) + Thu mua đi qua
    // HÀNG CHỜ (lib/dong-bo/hang-cho.ts) thay cho gọi thẳng + chờ kết quả như trước:
    //   · Người duyệt không phải đợi 2 lượt gọi mạng (trước đây tới ~16 giây) — gửi chạy trong after().
    //   · Lỗi thì tự gửi lại theo lịch 1p · 5p · 30p · 2h, quá 5 lần / 1 ngày thì dừng + báo — thay cho
    //     cách cũ "chỉ gửi lại khi có người mở đúng đề xuất đó" (ca 4 đề nghị mất tích ở kho 18/09).
    //   · Nhật ký "Đã đồng bộ sang QLK CTR / App Thu mua" + cờ qlkCtrSyncStatus/thuMuaSyncStatus vẫn
    //     được ghi như cũ, chỉ là ghi SAU (khi gửi xong), không nằm trong response duyệt này nữa.
    // Bọc try/catch riêng: lỗi ở đây tuyệt đối không được làm hỏng response duyệt chính.
    if (status === "approved") {
      try {
        const ids = await taoViecDongBo({
          requestId: id,
          requestCode: updated.code ?? null,
          loai: "duyet",
          nguoi: session.name,
        });
        after(() => guiCacViec(ids));
      } catch (syncError) {
        console.error("Tạo việc đồng bộ Kho / Thu mua lỗi (không ảnh hưởng thao tác duyệt):", syncError);
      }
    }

    return NextResponse.json({ request: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
