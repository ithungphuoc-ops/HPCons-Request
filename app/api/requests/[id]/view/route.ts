import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { canView, loadRequest } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";

/**
 * Đánh dấu người dùng hiện tại vừa MỞ trang chi tiết đề xuất này — ghi
 * `viewedAt[uid]` để chuông thông báo biết còn thông báo "mới" hay không cho
 * 3 loại vốn không có khái niệm đã đọc (được nhắc tên/đang theo dõi/đã xử lý
 * xong phần mình) — xem design.md của change fix-notification-bell-stale-gaps.
 * Không trả lại toàn bộ đề xuất (client không cần), chỉ xác nhận đã ghi.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const found = await loadRequest(id);
    if (!found) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    if (!canView(found, session.uid, session.role)) {
      return NextResponse.json({ error: "Bạn không có quyền xem đề xuất này." }, { status: 403 });
    }

    await adminDb
      .collection("requests")
      .doc(id)
      .update({ [`viewedAt.${session.uid}`]: new Date().toISOString() });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
