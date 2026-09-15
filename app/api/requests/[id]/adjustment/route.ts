import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { canSupplementAfterApproval } from "@/lib/permissions";
import { loadRequest } from "@/lib/server/requests";
import { requireSession, ForbiddenError } from "@/lib/session";
import { ADJUSTMENT_HISTORY_PREFIX, ADJUSTMENT_MAX_LENGTH } from "@/lib/request-history-labels";
import { MAX_DIRECT_UPLOAD_FILE_SIZE } from "@/lib/constants";
import { verifyUploadedAttachment } from "@/lib/server/verify-upload";
import type { RequestAttachment, RequestHistoryEntry, RequestInstance } from "@/lib/types";

export const runtime = "nodejs";

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
 * Quyền: DÙNG CHUNG `canSupplementAfterApproval` với route table-supplement và
 * attachments — chỉ CHÍNH người làm đề xuất, Owner/Admin cũng không thao tác
 * thay. Đổi luật thì sửa một chỗ ở lib/permissions.ts.
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
    if (!canSupplementAfterApproval(found, session.uid)) {
      throw new ForbiddenError("Chỉ chính người làm đề xuất mới ghi được điều chỉnh.");
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

    const nowIso = new Date().toISOString();
    const ref = adminDb.collection("requests").doc(id);

    /**
     * 🔴 GHI TRONG GIAO DỊCH, không đọc-rồi-ghi-đè (CodeRabbit bắt trên PR #27).
     *
     * Trước đó `soLan` tính từ bản đọc lúc đầu rồi ghi đè CẢ mảng `history`.
     * Hai lần gửi chạy song song — người dùng mở 2 tab, hoặc bấm "Cập nhật
     * điều chỉnh" cùng lúc với "Thêm tệp tin" ở khối ngay dưới — sẽ cùng đọc
     * một bản, cùng tính ra "lần N", rồi lần ghi sau XOÁ MẤT lần ghi trước.
     * Mất hẳn một dòng điều chỉnh mà không có dấu vết nào.
     *
     * Giao dịch Firestore tự chạy lại khi tài liệu đổi giữa chừng, nên cả hai
     * dòng đều được giữ và đánh số đúng thứ tự.
     */
    const ketQua = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { loi: "Không tìm thấy đề xuất." as const, ma: 404 };
      const moiNhat = { id: snap.id, ...snap.data() } as RequestInstance;

      // Kiểm lại trên bản MỚI NHẤT: giữa lúc tải tệp lên R2 (mất vài giây với
      // tệp lớn) đề xuất có thể đã bị xoá, hoặc trạng thái đã đổi.
      if (moiNhat.deletedAt) return { loi: "Đề xuất này đã bị xoá." as const, ma: 409 };
      if (moiNhat.status !== "approved") {
        return { loi: "Chỉ ghi điều chỉnh được cho đề xuất đã duyệt." as const, ma: 400 };
      }

      const lichSuCu = moiNhat.history ?? [];
      const soLan = lichSuCu.filter((h) => h.action.startsWith(ADJUSTMENT_HISTORY_PREFIX)).length + 1;
      const entry: RequestHistoryEntry = {
        at: nowIso,
        actor: session.name,
        action: `${ADJUSTMENT_HISTORY_PREFIX} (lần ${soLan})`,
        note: noiDung || "(chỉ đính tệp)",
        ...(attachmentMoi ? { attachmentName: attachmentMoi.name } : {}),
      };
      const history = [...lichSuCu, entry];
      const attachments = attachmentMoi
        ? [...(moiNhat.attachments ?? []), attachmentMoi]
        : (moiNhat.attachments ?? []);

      tx.update(ref, { history, attachments, updatedAt: nowIso });
      return { request: { ...moiNhat, history, attachments, updatedAt: nowIso } };
    });

    if ("loi" in ketQua) {
      return NextResponse.json({ error: ketQua.loi }, { status: ketQua.ma });
    }
    return NextResponse.json({ request: ketQua.request });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
