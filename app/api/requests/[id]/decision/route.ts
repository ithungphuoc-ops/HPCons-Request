import { after, NextResponse } from "next/server";
import { missingRequiredNote } from "@/lib/approval-logic";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { sanitizeDecisionNoteInput } from "@/lib/decision-note";
import { apiErrorResponse } from "@/lib/http";
import {
  notifyFollowersFullyApproved,
  notifyPendingApprovers,
  notifySubmitterResult,
  notifySubmitterReturned,
} from "@/lib/server/notification-emails";
import { applyDecisionToRequest, type DecisionGroupSettings, type DecisionKind } from "@/lib/server/decision-apply";
import { bumpNotificationSignal } from "@/lib/server/notification-signal";
import { sanitizeDecisionAttachmentsInput } from "@/lib/server/decision-attachments";
import { verifyUploadedAttachment } from "@/lib/server/verify-upload";
import { MAX_DIRECT_UPLOAD_FILE_SIZE } from "@/lib/constants";
import { requireSession } from "@/lib/session";
import type {
  GroupNotificationRules,
  ProposalGroup,
  RequestAttachment,
  RequestInstance,
  TaggedUser,
} from "@/lib/types";
import { guiCacViec, taoViecDongBo } from "@/lib/dong-bo/hang-cho";

// Gửi sang Kho / Thu mua chạy trong after() của chính lần gọi này — cho đủ thời gian (gói miễn phí
// cho tối đa 60 giây). Xem lib/dong-bo/hang-cho.ts.
export const maxDuration = 60;

interface DecisionBody {
  decision: DecisionKind;
  /** Chỉ dùng khi decision = "approve_and_forward"/"forward_then_approve" — người được thêm vào duyệt. */
  target?: TaggedUser;
  /** Bắt buộc khi decision = "rejected" hoặc "returned" (§4.4 quy định phải có lý do). */
  note?: string;
  /** "Mẫu form phê duyệt" — CHỈ tham khảo, server tự xác định lại field thật
   * khớp (bước × hành động) của người đang quyết định, không tin nguyên giá
   * trị 2 field này từ client (xem applyDecisionToRequest). */
  approvalTimeFieldId?: string;
  approvalTimeValue?: unknown;
  /** "Đính kèm tệp khi duyệt" — tệp đã tải THẲNG lên R2 (link ký sẵn, qua
   * lib/upload-client.ts) TRƯỚC khi gọi route này, giống luồng "Điều chỉnh
   * sau duyệt". Server kiểm lại path + đo kích thước thật. */
  attachments?: unknown;
}

/** Ném từ trong transaction để huỷ ghi + trả đúng mã lỗi cho client. */
class DecisionTxError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Trình tự (06/10/2026 — chuyển sang transaction, Sếp duyệt "sửa luôn"):
 *   1. NGOÀI transaction: đọc đề xuất 1 lần để biết nhóm, đọc cài đặt nhóm,
 *      kiểm ghi chú / tệp / cờ chuyển tiếp (chỉ phụ thuộc nhóm), chạy THỬ
 *      applyDecisionToRequest trên bản đọc này để báo lỗi 400/409 sớm, rồi mới
 *      đo tệp thật trên R2 (gọi mạng — không làm trong transaction).
 *   2. TRONG transaction: tx.get đề xuất MỚI NHẤT → applyDecisionToRequest
 *      (kiểm lại tới lượt chưa, tệp trùng, field theo bước, tính hạn) →
 *      tx.update. Firestore chạy lại cả khối nếu đề xuất bị ghi xen giữa, nên
 *      2 người duyệt song song / thay tệp + duyệt cùng lúc không còn đè nhau.
 *   3. SAU khi transaction ghi xong (đúng 1 lần, không nằm trong callback có
 *      thể chạy lại): email, hàng chờ đồng bộ Kho / Thu mua.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = (await request.json()) as DecisionBody;

    const ref = adminDb.collection("requests").doc(id);
    const preSnap = await ref.get();
    if (!preSnap.exists) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    const pre = { id: preSnap.id, ...preSnap.data() } as RequestInstance;
    const nowIso = new Date().toISOString();

    // "Ý kiến khi phê duyệt" theo nhóm (có ô / bắt buộc cho 4 hành động) —
    // "returned" LUÔN bắt buộc, "rejected" mặc định bắt buộc như cũ, ô đã tắt
    // thì không bắt buộc (xem missingRequiredNote + lib/decision-note.ts).
    let requireDecisionNote: ProposalGroup["requireDecisionNote"];
    let decisionNoteEnabled: ProposalGroup["decisionNoteEnabled"];
    let decisionAttachmentEnabled: ProposalGroup["decisionAttachmentEnabled"];
    let requireDecisionAttachment: ProposalGroup["requireDecisionAttachment"];
    // Cài đặt nhóm dùng TRONG transaction ("Mẫu form phê duyệt" + 3 field
    // tính lại deadlineAt khi sang bước tiếp — recomputeDeadlineForNextStep()).
    // Đọc 1 lần trước transaction: đây là cấu hình nhóm, không phải dữ liệu
    // đề xuất; transaction chỉ khoá document đề xuất.
    const groupSettings: DecisionGroupSettings = {
      approvalTimeFields: [],
      approverSlaEnabled: undefined,
      slaByWorkCalendar: undefined,
      groupSlaHours: null,
    };
    // Mặc định `true` — trước 24/08/2026 KHÔNG có cờ nào cả, "Chuyển tiếp và
    // Duyệt" luôn cho phép mọi nhóm; giữ đúng hành vi cũ cho nhóm chưa từng
    // đụng vào cờ này (khớp DEFAULT_GROUP_PERMISSION_RULES ở lib/types.ts).
    let approversCanDelegateApproval = true;
    // Dùng để gửi email thông báo thật (Sếp chốt 24/08/2026) — chỉ cần đúng
    // field này, xem GroupNotificationSource ở lib/server/notification-emails.ts.
    let notificationRules: GroupNotificationRules | undefined;
    if (pre.groupId) {
      const groupSnap = await adminDb.collection("groups").doc(pre.groupId).get();
      const groupData = groupSnap.data() as Partial<ProposalGroup> | undefined;
      requireDecisionNote = groupData?.requireDecisionNote;
      decisionNoteEnabled = groupData?.decisionNoteEnabled;
      decisionAttachmentEnabled = groupData?.decisionAttachmentEnabled;
      requireDecisionAttachment = groupData?.requireDecisionAttachment;
      groupSettings.approvalTimeFields = groupData?.approvalTimeFields ?? [];
      groupSettings.approverSlaEnabled = groupData?.approverSlaEnabled;
      groupSettings.slaByWorkCalendar = groupData?.slaByWorkCalendar;
      groupSettings.groupSlaHours = groupData?.slaHours ?? null;
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
    const note = noteInput.note;
    if (missingRequiredNote(body.decision, note, requireDecisionNote, decisionNoteEnabled)) {
      const message =
        body.decision === "rejected" || body.decision === "returned"
          ? "Cần nhập lý do khi từ chối hoặc trả lại đề xuất."
          : `Nhóm này yêu cầu nhập ý kiến khi ${body.decision === "approved" ? "chấp thuận" : "chuyển tiếp"}.`;
      return NextResponse.json({ error: message }, { status: 400 });
    }
    // "Đính kèm tệp khi duyệt" — kiểm dạng/path/số tệp/bắt buộc (hàm thuần),
    // ô đã tắt → bỏ tệp. "Trả lại" luôn có ô, không bắt buộc. Tệp trùng với
    // tệp đã có được kiểm lại trong transaction trên bản mới nhất.
    const attachmentInput = sanitizeDecisionAttachmentsInput({
      decision: body.decision,
      raw: body.attachments,
      group: { decisionAttachmentEnabled, requireDecisionAttachment },
      uid: session.uid,
      existingPaths: (pre.attachments ?? []).map((a) => a.path),
      nowMs: Date.now(),
    });
    if (!attachmentInput.ok) {
      return NextResponse.json({ error: attachmentInput.error }, { status: 400 });
    }

    // Chặn server-side, không chỉ ẩn UI — nhóm tắt cờ này (Sếp chốt
    // 24/08/2026, xem ForwardModal.tsx) không cho "Chuyển tiếp và Duyệt".
    if (body.decision === "forward_then_approve" && !approversCanDelegateApproval) {
      return NextResponse.json(
        { error: "Nhóm này không cho phép chuyển tiếp cho người khác duyệt trước." },
        { status: 403 },
      );
    }

    const baseInput = {
      decision: body.decision,
      target: body.target,
      note,
      approvalTimeValue: body.approvalTimeValue,
      actor: { uid: session.uid, name: session.name },
      group: groupSettings,
      nowIso,
    };

    // Chạy THỬ trên bản đọc trước (không ghi gì) — báo sớm lỗi 400/409 (thiếu
    // field theo bước, chưa tới lượt…) trước khi tốn công đo tệp trên R2.
    const dryRun = applyDecisionToRequest(pre, { ...baseInput, decisionAttachments: [] });
    if (!dryRun.ok) {
      return NextResponse.json({ error: dryRun.error }, { status: dryRun.status });
    }

    // Đo kích thước THẬT trên R2 (không tin số client gửi) — cùng hàm với
    // route attachments/adjustment. Làm TRƯỚC transaction (gọi mạng ngoài):
    // tệp lỗi → 400, quyết định chưa được ghi.
    const decisionAttachments: RequestAttachment[] = [];
    for (const att of attachmentInput.attachments) {
      const verified = await verifyUploadedAttachment(att, session.uid, MAX_DIRECT_UPLOAD_FILE_SIZE);
      if (!verified.ok) {
        return NextResponse.json({ error: verified.error }, { status: 400 });
      }
      decisionAttachments.push({
        name: att.name,
        path: att.path,
        size: verified.size,
        source: "decision",
        addedBy: session.name,
        addedByUid: session.uid,
        addedAt: nowIso,
      });
    }
    // Ghi CÙNG lần cập nhật với quyết định: mảng `attachments` nối thêm bằng
    // arrayUnion (dòng lịch sử nhận tên tệp — xem applyDecisionToRequest).
    const attachmentsWrite = decisionAttachments.length
      ? { attachments: FieldValue.arrayUnion(...decisionAttachments) }
      : {};

    // Callback có thể bị Firestore chạy lại nhiều lần — chỉ đọc/tính/ghi, KHÔNG
    // gửi email hay tạo việc đồng bộ trong này.
    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new DecisionTxError(404, "Không tìm thấy đề xuất.");
      const latest = { id: snap.id, ...snap.data() } as RequestInstance;
      // Cài đặt nhóm đã đọc theo groupId của bản đọc trước — nhóm đổi giữa
      // chừng (hiếm) thì không áp cài đặt cũ, bảo người dùng tải lại.
      if ((latest.groupId ?? null) !== (pre.groupId ?? null)) {
        throw new DecisionTxError(409, "Đề xuất vừa được thay đổi, vui lòng tải lại trang rồi thử lại.");
      }
      const plan = applyDecisionToRequest(latest, { ...baseInput, decisionAttachments });
      if (!plan.ok) throw new DecisionTxError(plan.status, plan.error);
      tx.update(ref, { ...plan.patch, ...attachmentsWrite });
      return plan;
    });
    const { updated, status } = result;
    // Mọi effect (none/forward/decision) đều ghi updatedAt trong transaction ở trên — báo chuông
    // thông báo tự tải lại (Sếp duyệt 06/10/2026, xem lib/server/notification-signal.ts).
    after(() => bumpNotificationSignal());

    // Đề xuất TRỰC TIẾP (không groupId) không đọc `notificationRules` ở trên
    // (`notificationRules` giữ nguyên `undefined`) — truyền thẳng `null` để
    // emailNotifyEnabled() nhận đúng tín hiệu "đề xuất trực tiếp, mặc định
    // BẬT" thay vì tín hiệu "nhóm thật nhưng chưa cấu hình, mặc định TẮT"
    // (2 tín hiệu này khác nhau — xem GroupNotificationSource, Đợt 3 Email,
    // Sếp chốt 06/10/2026).
    const notifyGroup = pre.groupId ? { notificationRules } : null;

    if (result.effect === "forward") {
      // Email thông báo thật (Sếp chốt 24/08/2026) — người vừa được chuyển
      // tới (hoặc người kế tiếp theo thứ tự) đang chờ xử lý. Dùng after() —
      // lý do xem comment ở app/api/requests/route.ts (21/09/2026).
      after(async () => {
        try {
          await notifyPendingApprovers(updated, notifyGroup);
        } catch (mailError) {
          console.error("Gửi email thông báo lúc chuyển tiếp thất bại (không ảnh hưởng thao tác chính):", mailError);
        }
      });
    } else if (result.effect === "none") {
      // "Trả lại" (Đợt 3 Email, Sếp chốt 06/10/2026) — trước đây luồng này
      // không gửi email nào cả, chỉ có chuông trong app. Báo người tạo kèm
      // lý do trả lại.
      after(async () => {
        try {
          await notifySubmitterReturned(updated, notifyGroup, note);
        } catch (mailError) {
          console.error("Gửi email thông báo lúc trả lại đề xuất thất bại (không ảnh hưởng thao tác chính):", mailError);
        }
      });
    } else if (result.effect === "decision") {
      // Email thông báo thật (Sếp chốt 24/08/2026): còn "pending" → báo người
      // kế tiếp đang tới lượt; đã xong (approved/rejected) → báo người tạo
      // (luôn báo) + người theo dõi (chỉ khi approved hoàn toàn).
      after(async () => {
        try {
          if (status === "pending") {
            await notifyPendingApprovers(updated, notifyGroup);
          } else {
            await notifySubmitterResult(updated, notifyGroup);
            if (status === "approved") await notifyFollowersFullyApproved(updated, notifyGroup);
          }
        } catch (mailError) {
          console.error("Gửi email thông báo sau quyết định thất bại (không ảnh hưởng thao tác chính):", mailError);
        }
      });

      // ★★ (03/10/2026, Sếp chốt — đợt 1 "liên kết 4 app") Đồng bộ sang Kho (QLK CTR) + Thu mua đi qua
      // HÀNG CHỜ (lib/dong-bo/hang-cho.ts): gửi chạy trong after(), lỗi tự gửi lại theo lịch; nhật ký
      // "Đã đồng bộ…" + cờ qlkCtrSyncStatus/thuMuaSyncStatus do hàng chờ ghi SAU (arrayUnion vào history).
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
    }

    return NextResponse.json({ request: updated });
  } catch (error) {
    if (error instanceof DecisionTxError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return apiErrorResponse(error);
  }
}
