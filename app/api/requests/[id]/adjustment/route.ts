import { after, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { guiCacViec, taoViecDongBo } from "@/lib/dong-bo/hang-cho";
import { loadAdjustmentApprovalRules, resolveAdjustmentPlanForActor } from "@/lib/server/adjustment-approval-rules";
import { ghiDieuChinhVaoLichSu } from "@/lib/server/adjustment";
import { loadRequest } from "@/lib/server/requests";
import { requireSession, ForbiddenError } from "@/lib/session";
import { ADJUSTMENT_MAX_LENGTH } from "@/lib/request-history-labels";
import { MAX_DIRECT_UPLOAD_FILE_SIZE } from "@/lib/constants";
import { verifyUploadedAttachment } from "@/lib/server/verify-upload";
import type { RequestAttachment, RequestInstance } from "@/lib/types";

export const runtime = "nodejs";
// Báo Kho / Thu mua chạy trong after() — cho đủ thời gian gửi (gói miễn phí tối đa 60 giây).
export const maxDuration = 60;

interface AdjustmentBody {
  noiDung?: unknown;
  /** Tệp đã tải lên R2 TRƯỚC khi gọi route này (qua lib/upload-client.ts),
   * giống hệt luồng của route attachments. Không bắt buộc. */
  attachment?: unknown;
}

/**
 * Ghi một dòng "điều chỉnh sau duyệt" vào lịch sử của đề xuất ĐÃ DUYỆT.
 *
 * ★ Sếp chốt 15/09/2026, thay cho khối bảng cũ. Trước đó chỗ này là một bảng
 * trống đủ 5 cột nhìn y hệt bảng lúc tạo đề xuất, nên người dùng hiểu nhầm là
 * chỗ khai THÊM MẶT HÀNG MỚI — trong khi ý nghĩa thật chỉ là sửa số lượng /
 * quy cách của hàng ĐÃ đề xuất.
 *
 * 🔴 CỐ Ý KHÔNG SỬA `values`. Bảng gốc là thứ người duyệt đã đọc và đã đồng ý;
 * ghi đè vào đó là xoá dấu vết của cái đã được duyệt, sau này không ai đối
 * chiếu được "duyệt cái gì" với "cuối cùng lấy cái gì". Nội dung điều chỉnh đi
 * vào `history` — có tên người, có giờ, không bao giờ mất.
 *
 * Quyền (từ change add-adjustment-approval-conditions, 05/10/2026): nhóm đề
 * xuất TỰ CẤU HÌNH bảng "nhánh" phòng ban → người duyệt (`ProposalGroup.
 * adjustmentApprovalRules`, tab "Điều chỉnh sau duyệt"). Nhóm KHÔNG cấu hình
 * (hoặc đề xuất trực tiếp, không có nhóm) → hành vi CŨ Y NGUYÊN (chỉ
 * submitter, lưu thẳng ngay) — route table-supplement/attachments KHÔNG đổi,
 * vẫn dùng riêng `canSupplementAfterApproval`, không đụng.
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

    const isSubmitter = found.submittedBy.uid === session.uid;
    const isFollower = found.followers.some((f) => f.id === session.uid);
    if (!isSubmitter && !isFollower) {
      throw new ForbiddenError("Bạn không có quyền ghi điều chỉnh cho đề xuất này.");
    }

    const rules = await loadAdjustmentApprovalRules(found.groupId);
    const plan = await resolveAdjustmentPlanForActor(found, session.uid, rules);
    if (plan.kind === "none") {
      throw new ForbiddenError("Bạn không có quyền ghi điều chỉnh cho đề xuất này.");
    }

    const body = (await request.json()) as AdjustmentBody;
    const noiDung = typeof body.noiDung === "string" ? body.noiDung.trim() : "";
    // Chặn dài phía MÁY CHỦ chứ không chỉ maxLength của ô nhập: ô nhập chỉ
    // ngăn người gõ tay, ai gọi thẳng API vẫn đẩy được chuỗi vài trăm KB vào
    // history và làm phình mọi lần đọc đề xuất về sau.
    if (noiDung.length > ADJUSTMENT_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Nội dung điều chỉnh tối đa ${ADJUSTMENT_MAX_LENGTH} ký tự.` },
        { status: 400 },
      );
    }

    // Tệp đi KÈM lần điều chỉnh này (Sếp chốt 15/09/2026, "cách 1"): nó vẫn
    // vào `attachments` như mọi tài liệu khác, nhưng history ghi thêm tên tệp
    // nên sau này đọc "đổi 120 xuống 90 cây" là thấy ngay chứng từ đi cùng.
    const att = body.attachment as Partial<RequestAttachment> | undefined;
    let attachmentMoi: RequestAttachment | null = null;
    if (att) {
      if (typeof att.path !== "string" || !att.path || typeof att.name !== "string" || !att.name) {
        return NextResponse.json({ error: "Tệp đính kèm không hợp lệ." }, { status: 400 });
      }
      // Đo kích thước THẬT trên R2 thay vì tin con số client gửi — cùng lý do
      // và cùng hàm với route attachments (xem chú thích ở đó).
      const verified = await verifyUploadedAttachment(
        att as RequestAttachment,
        session.uid,
        MAX_DIRECT_UPLOAD_FILE_SIZE,
      );
      if (!verified.ok) {
        return NextResponse.json({ error: verified.error }, { status: 400 });
      }
      attachmentMoi = { name: att.name, path: att.path, size: verified.size };
    }

    if (!noiDung && !attachmentMoi) {
      return NextResponse.json({ error: "Chưa nhập nội dung điều chỉnh." }, { status: 400 });
    }

    if (plan.kind === "gated") {
      // CHƯA ghi history, CHƯA báo Kho/Thu mua — chỉ tạo trạng thái chờ đủ
      // người duyệt (AND). Đọc lại bản MỚI NHẤT trong transaction (không tin
      // `found` đọc trước khi tải tệp lên R2) để tránh 2 điều chỉnh chồng nhau.
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
          noiDung,
          attachment: attachmentMoi,
          requestedByUid: session.uid,
          requestedByName: session.name,
          createdAt: nowIso,
          approvers: plan.approvers.map((a) => ({ uid: a.uid, name: a.name, approvedAt: null })),
        };
        tx.update(ref, { pendingAdjustment, updatedAt: nowIso });
        return { request: { ...moiNhat, pendingAdjustment, updatedAt: nowIso } };
      });
      if ("loi" in ketQua) {
        return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
      }
      return NextResponse.json({ request: ketQua.request });
    }

    // plan.kind === "direct" — hành vi CŨ Y NGUYÊN: ghi thẳng vào history
    // ngay, báo Kho/Thu mua ngay (★ 03/10/2026, đợt 1 "liên kết 4 app").
    const ketQua = await ghiDieuChinhVaoLichSu(id, {
      noiDung,
      attachment: attachmentMoi,
      actorName: session.name,
    });
    if ("loi" in ketQua) {
      return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
    }
    try {
      const ids = await taoViecDongBo({
        requestId: id,
        requestCode: ketQua.request.code ?? null,
        loai: "dieu_chinh",
        nguoi: session.name,
        noiDung: noiDung || (attachmentMoi ? `(chỉ đính tệp: ${attachmentMoi.name})` : ""),
        taiLieu: attachmentMoi ? [{ name: attachmentMoi.name, path: attachmentMoi.path }] : [],
      });
      after(() => guiCacViec(ids));
    } catch (err) {
      console.error(`Tạo việc báo điều chỉnh đề xuất ${id} sang Kho / Thu mua lỗi:`, err);
    }
    return NextResponse.json({ request: ketQua.request });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
