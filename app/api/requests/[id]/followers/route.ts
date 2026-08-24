import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { canView, loadRequest } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import type { TaggedUser } from "@/lib/types";

interface AddFollowerBody {
  user: TaggedUser;
}

/** Thêm 1 người theo dõi vào đề xuất ĐÃ TỒN TẠI, bất kể trạng thái (kể cả đã
 * "approved"/"rejected") — khác PATCH sửa nháp hiện có (chỉ sửa được followers
 * khi còn nháp/bị trả lại/đang chờ CỦA CHÍNH CHỦ). Ai xem được đề xuất cũng
 * thêm được, xem design.md của change add-request-detail-base-parity,
 * capability request-followers-management. */
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
    if (!canView(found, session.uid, session.role)) {
      return NextResponse.json({ error: "Bạn không có quyền trên đề xuất này." }, { status: 403 });
    }

    const body = (await request.json()) as AddFollowerBody;
    if (!body.user?.id) {
      return NextResponse.json({ error: "Thiếu người cần thêm." }, { status: 400 });
    }

    const followers = found.followers.some((f) => f.id === body.user.id)
      ? found.followers
      : [...found.followers, body.user];

    await adminDb.collection("requests").doc(id).update({ followers });
    return NextResponse.json({ followers });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
