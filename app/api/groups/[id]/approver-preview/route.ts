import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { resolveApproverStepsDetailed, toProposalGroup } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";

/**
 * Xem trước "ai sẽ duyệt đề xuất này" cho NGƯỜI ĐANG ĐĂNG NHẬP, dùng đúng
 * resolveApproverStepsDetailed() — cùng logic thật sự chạy lúc gửi chính thức
 * (xem lib/server/requests.ts resolveApproverSteps(), dùng chung nền) — để
 * preview khớp 100% với kết quả thật, không lặp lại logic riêng có thể lệch
 * nhau. Trả thêm `steps` (chi tiết từng bước, không throw khi 1 bước lỗi) để
 * client biết chính xác bước nào là "submitter_manager" mà gắn nút đổi —
 * `approvers` (mảng phẳng) vẫn giữ để không phá vỡ chỗ khác đang đọc.
 *
 * POST (không phải GET) vì cần nhận kèm `values` hiện tại của form đang điền
 * — bước duyệt có `condition` chỉ được tính đúng khi có giá trị field liên
 * quan; thiếu `values` khiến mọi bước có điều kiện bị lọc bỏ khỏi preview dù
 * điều kiện thật sự đã thoả (bug đã gặp thật, preview luôn rỗng cho bước có
 * điều kiện trong khi gửi thật vẫn đúng vì route submit có truyền values).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const values = (body?.values ?? {}) as Record<string, unknown>;

    const snap = await adminDb.collection("groups").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Không tìm thấy nhóm đề xuất." }, { status: 404 });
    }
    const group = toProposalGroup(snap.id, snap.data()!);

    const steps = await resolveApproverStepsDetailed(group.approverSteps, session.uid, values, group.fields);
    const approvers = steps.filter((s) => s.user).map((s) => s.user!);
    return NextResponse.json({ approvers, steps });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
