import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { canSupplementAfterApproval } from "@/lib/permissions";
import { loadRequest } from "@/lib/server/requests";
import { requireSession, ForbiddenError } from "@/lib/session";
import { ADJUSTMENT_HISTORY_PREFIX, ADJUSTMENT_MAX_LENGTH } from "@/lib/request-history-labels";
import type { RequestHistoryEntry } from "@/lib/types";

interface AdjustmentBody {
  noiDung?: unknown;
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
    if (!noiDung) {
      return NextResponse.json({ error: "Chưa nhập nội dung điều chỉnh." }, { status: 400 });
    }
    // Chặn dài phía MÁY CHỦ chứ không chỉ maxLength của ô nhập: ô nhập chỉ
    // ngăn người gõ tay, ai gọi thẳng API vẫn đẩy được chuỗi vài trăm KB vào
    // history và làm phình mọi lần đọc đề xuất về sau.
    if (noiDung.length > ADJUSTMENT_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Nội dung điều chỉnh tối đa ${ADJUSTMENT_MAX_LENGTH} ký tự.` },
        { status: 400 },
      );
    }

    const nowIso = new Date().toISOString();
    const soLan = found.history.filter((h) => h.action.startsWith(ADJUSTMENT_HISTORY_PREFIX)).length + 1;
    const entry: RequestHistoryEntry = {
      at: nowIso,
      actor: session.name,
      action: `${ADJUSTMENT_HISTORY_PREFIX} (lần ${soLan})`,
      note: noiDung,
    };
    const history = [...found.history, entry];
    await adminDb.collection("requests").doc(id).update({ history, updatedAt: nowIso });
    return NextResponse.json({ request: { ...found, history, updatedAt: nowIso } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
