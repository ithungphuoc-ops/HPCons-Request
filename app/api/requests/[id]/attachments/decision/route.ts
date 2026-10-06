import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { MAX_DIRECT_UPLOAD_FILE_SIZE } from "@/lib/constants";
import { canManageGroupsAtAppScope } from "@/lib/permissions";
import { checkDecisionAttachmentEdit } from "@/lib/decision-attachment-edit";
import { canView, loadRequest } from "@/lib/server/requests";
import { parseDecisionAttachmentEditBody, planDecisionAttachmentEdit } from "@/lib/server/decision-attachment-edit";
import { verifyUploadedAttachment } from "@/lib/server/verify-upload";
import { requireSession } from "@/lib/session";
import type { ProposalGroup, RequestInstance } from "@/lib/types";

export const runtime = "nodejs";

/**
 * "Sửa tệp đính kèm khi duyệt" (Sếp duyệt demo
 * tong-quan-demo/base-request-app/sua-tep-dinh-kem-khi-duyet-2026-10-06):
 * thay (`action: "replace"`) hoặc gỡ (`action: "remove"`) 1 tệp người duyệt
 * đã gửi kèm quyết định. Giữ dấu vết — không xoá phần tử nào khỏi
 * `attachments`, ghi 1 dòng lịch sử "Đã thay/Đã gỡ tệp đính kèm".
 *
 * Kiểm: đăng nhập; xem được đề xuất; đề xuất đang chờ duyệt/bị trả lại; tệp
 * tồn tại, là tệp quyết định, chưa gỡ; người gọi là người đính kèm hoặc
 * Owner/Admin; tệp mới là tệp CHÍNH người gọi vừa tải (≤ 24 giờ), đo kích
 * thước thật trên R2; không gỡ tệp cuối của hành động bắt buộc đính kèm.
 * Không gửi thông báo/email (giống thêm tài liệu khi đề xuất chưa duyệt).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const parsed = parseDecisionAttachmentEditBody(await request.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const input = parsed.input;
    const isAdmin = canManageGroupsAtAppScope(session.role);

    const found = await loadRequest(id);
    if (!found || found.deletedAt) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    if (!canView(found, session.uid, session.role)) {
      return NextResponse.json({ error: "Bạn không có quyền trên đề xuất này." }, { status: 403 });
    }
    // Kiểm sớm (ngoài transaction) để không đo R2 vô ích; transaction kiểm lại.
    const pre = checkDecisionAttachmentEdit({
      status: found.status,
      att: (found.attachments ?? []).find((a) => a.path === input.path),
      uid: session.uid,
      isAdmin,
    });
    if (!pre.ok) return NextResponse.json({ error: pre.error }, { status: pre.status });

    let verifiedSize: number | undefined;
    if (input.action === "replace") {
      const verified = await verifyUploadedAttachment(input.file, session.uid, MAX_DIRECT_UPLOAD_FILE_SIZE);
      if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 });
      verifiedSize = verified.size;
    }

    let group: Partial<ProposalGroup> | null = null;
    if (found.groupId) {
      const groupSnap = await adminDb.collection("groups").doc(found.groupId).get();
      group = (groupSnap.data() as Partial<ProposalGroup> | undefined) ?? null;
    }

    const ref = adminDb.collection("requests").doc(id);
    // Đọc – kiểm – ghi `attachments` + `history` trong CÙNG 1 transaction để
    // 2 thao tác song song (vd 1 người thay, người khác vừa duyệt) không đè nhau.
    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: false as const, status: 404, error: "Không tìm thấy đề xuất." };
      const latest = { id: snap.id, ...snap.data() } as RequestInstance;
      const nowIso = new Date().toISOString();
      const plan = planDecisionAttachmentEdit({
        request: latest,
        input,
        actor: { uid: session.uid, name: session.name, isAdmin },
        group: group
          ? {
              decisionAttachmentEnabled: group.decisionAttachmentEnabled,
              requireDecisionAttachment: group.requireDecisionAttachment,
            }
          : null,
        nowIso,
        verifiedSize,
      });
      if (!plan.ok) return plan;
      tx.update(ref, { attachments: plan.attachments, history: plan.history, updatedAt: nowIso });
      return plan;
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ attachments: result.attachments, history: result.history });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
