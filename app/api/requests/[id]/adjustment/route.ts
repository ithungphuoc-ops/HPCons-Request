import { after, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { canAdjustAfterApproval, loadAdjustmentGroupSettings } from "@/lib/server/adjustment-approval-rules";
import { sanitizeAdjustmentFilesInput } from "@/lib/server/adjustment";
import {
  getAdjustmentGuide,
  loadActiveUsers,
  resolveAdjustmentSuggestions,
} from "@/lib/server/adjustment-reviewers";
import { notifyAdjustmentApprovers } from "@/lib/server/notification-emails";
import { collectAttachmentPaths, loadRequest } from "@/lib/server/requests";
import { requireSession, ForbiddenError } from "@/lib/session";
import { ADJUSTMENT_MAX_LENGTH } from "@/lib/request-history-labels";
import { MAX_DIRECT_UPLOAD_FILE_SIZE } from "@/lib/constants";
import { verifyUploadedAttachment } from "@/lib/server/verify-upload";
import {
  ADJUSTMENT_APPROVER_COUNT,
  checkAdjustmentContent,
  resolveAdjustmentFieldRules,
  validateAdjustmentApproverPick,
} from "@/lib/adjustment-settings";
import type { RequestAttachment, RequestInstance } from "@/lib/types";

export const runtime = "nodejs";
// Gửi email cho 2 người duyệt chạy trong after().
export const maxDuration = 60;

const NO_ACCESS = "Bạn không có quyền ghi điều chỉnh cho đề xuất này.";

/**
 * Dữ liệu cho hộp "Điều chỉnh đề nghị sau duyệt" — chỉ người được bấm Điều
 * chỉnh mới lấy được: hướng dẫn chung (cảnh báo vàng), quy tắc ô Ghi chú /
 * Đính kèm của nhóm, 2 gợi ý nhanh (Người duyệt cuối, Trưởng phòng Thu mua).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const found = await loadRequest(id);
    if (!found) return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    const settings = await loadAdjustmentGroupSettings(found.groupId);
    if (!canAdjustAfterApproval(found, session.uid, settings.adjustmentApprovalRules)) {
      throw new ForbiddenError(NO_ACCESS);
    }
    const [guide, suggestions] = await Promise.all([
      getAdjustmentGuide(),
      resolveAdjustmentSuggestions(found, session.uid),
    ]);
    return NextResponse.json({
      guide: guide.guide,
      fieldRules: resolveAdjustmentFieldRules(settings),
      approverCount: ADJUSTMENT_APPROVER_COUNT,
      suggestions,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

interface AdjustmentBody {
  noiDung?: unknown;
  /** uid ĐÚNG 2 người duyệt điều chỉnh (máy chủ tự tra tên ở App Tổng). */
  approverIds?: unknown;
  /** Các tệp đã tải lên R2 TRƯỚC khi gọi route này (lib/upload-client.ts). */
  attachments?: unknown;
  /** Dạng cũ 1 tệp — client bản cũ còn cache. */
  attachment?: unknown;
}

/**
 * Gửi 1 "điều chỉnh sau duyệt" — từ 06/10/2026 (Sếp duyệt demo
 * dieu-chinh-tu-chon-nguoi-duyet) MỌI điều chỉnh đều chờ ĐÚNG 2 người duyệt
 * do người điều chỉnh tự chọn (AND, duyệt cùng lúc). Chưa ghi history, chưa
 * báo Kho/Thu mua — chỉ tạo `pendingAdjustment`; khi đủ 2 người duyệt route
 * `adjustment/decision` mới ghi thật + báo Kho/Thu mua (giữ luồng cũ).
 *
 * 🔴 CỐ Ý KHÔNG SỬA `values` (bảng gốc là thứ người duyệt đã đồng ý) — nội
 * dung điều chỉnh đi vào `history` khi có hiệu lực.
 *
 * Quyền bấm: người gửi; người theo dõi nếu nhóm cho phép — xem
 * `canAdjustAfterApproval`. Bảng nhánh phòng ban (PR #68) không còn đọc.
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
    if (found.status !== "approved") {
      return NextResponse.json(
        { error: "Chỉ ghi điều chỉnh được cho đề xuất đã duyệt." },
        { status: 400 },
      );
    }

    const settings = await loadAdjustmentGroupSettings(found.groupId);
    if (!canAdjustAfterApproval(found, session.uid, settings.adjustmentApprovalRules)) {
      throw new ForbiddenError(NO_ACCESS);
    }
    if (found.pendingAdjustment) {
      return NextResponse.json(
        { error: "Đã có 1 điều chỉnh khác đang chờ duyệt, vui lòng đợi xử lý xong." },
        { status: 409 },
      );
    }

    const body = (await request.json()) as AdjustmentBody;
    const rawNoiDung = typeof body.noiDung === "string" ? body.noiDung.trim() : "";
    // Chặn dài phía MÁY CHỦ chứ không chỉ maxLength của ô nhập.
    if (rawNoiDung.length > ADJUSTMENT_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Nội dung điều chỉnh tối đa ${ADJUSTMENT_MAX_LENGTH} ký tự.` },
        { status: 400 },
      );
    }

    // 2 người duyệt: đúng 2, khác nhau, không phải chính mình…
    const pick = validateAdjustmentApproverPick(body.approverIds, session.uid);
    if (!pick.ok) return NextResponse.json({ error: pick.error }, { status: 400 });
    // …và còn hoạt động ở App Tổng (tên lấy từ App Tổng, không tin client).
    const active = await loadActiveUsers(pick.uids);
    const missing = pick.uids.filter((u) => !active.has(u));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: "Người duyệt đã chọn không còn hoạt động ở App Tổng — chọn người khác." },
        { status: 400 },
      );
    }
    const approvers = pick.uids.map((u) => active.get(u)!);

    const fieldRules = resolveAdjustmentFieldRules(settings);
    const filesInput = sanitizeAdjustmentFilesInput({
      attachments: fieldRules.attachment.enabled ? body.attachments : undefined,
      legacyAttachment: fieldRules.attachment.enabled ? body.attachment : undefined,
      uid: session.uid,
      existingPaths: collectAttachmentPaths(found, { includeRemoved: true }),
      nowMs: Date.now(),
    });
    if (!filesInput.ok) return NextResponse.json({ error: filesInput.error }, { status: 400 });

    const content = checkAdjustmentContent(fieldRules, { noiDung: rawNoiDung, fileCount: filesInput.files.length });
    if (!content.ok) return NextResponse.json({ error: content.error }, { status: 400 });

    // Đo kích thước THẬT trên R2 thay vì tin con số client gửi.
    const files: RequestAttachment[] = [];
    for (const f of content.keepFiles ? filesInput.files : []) {
      const verified = await verifyUploadedAttachment(f, session.uid, MAX_DIRECT_UPLOAD_FILE_SIZE);
      if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 });
      files.push({ name: f.name, path: f.path, size: verified.size });
    }

    // Đọc lại bản MỚI NHẤT trong transaction (không tin `found` đọc trước khi
    // đo R2) để tránh 2 điều chỉnh chồng nhau.
    const nowIso = new Date().toISOString();
    const ref = adminDb.collection("requests").doc(id);
    const ketQua = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { loi: "Không tìm thấy đề xuất." as const, ma: 404 };
      const moiNhat = { id: snap.id, ...snap.data() } as RequestInstance;
      if (moiNhat.deletedAt) return { loi: "Đề xuất này đã bị xoá." as const, ma: 409 };
      if (moiNhat.status !== "approved") {
        return { loi: "Chỉ ghi điều chỉnh được cho đề xuất đã duyệt." as const, ma: 400 };
      }
      if (moiNhat.pendingAdjustment) {
        return {
          loi: "Đã có 1 điều chỉnh khác đang chờ duyệt, vui lòng đợi xử lý xong." as const,
          ma: 409,
        };
      }
      const pendingAdjustment: NonNullable<RequestInstance["pendingAdjustment"]> = {
        noiDung: content.noiDung,
        attachment: null,
        attachments: files,
        requestedByUid: session.uid,
        requestedByName: session.name,
        createdAt: nowIso,
        approvers: approvers.map((a) => ({ uid: a.uid, name: a.name, approvedAt: null })),
      };
      tx.update(ref, {
        pendingAdjustment,
        // Lưu dấu "từng được giao duyệt điều chỉnh" — họ còn mở lại được đề
        // xuất sau khi điều chỉnh xong (canView), không thành người theo dõi.
        adjustmentReviewerUids: FieldValue.arrayUnion(...approvers.map((a) => a.uid)),
        updatedAt: nowIso,
      });
      const reviewerUids = Array.from(
        new Set([...(moiNhat.adjustmentReviewerUids ?? []), ...approvers.map((a) => a.uid)]),
      );
      return {
        request: { ...moiNhat, pendingAdjustment, adjustmentReviewerUids: reviewerUids, updatedAt: nowIso },
      };
    });
    if ("loi" in ketQua) {
      return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
    }
    const saved = ketQua.request;
    after(() =>
      notifyAdjustmentApprovers(
        approvers.map((a) => a.uid),
        saved,
        session.name,
        settings,
      ),
    );
    return NextResponse.json({ request: saved });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
