import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { canView, loadRequest } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";

/** Toggle "đánh dấu đề xuất" — THEO TỪNG NGƯỜI XEM (uid), không phải cờ chung.
 * Ai xem được đề xuất (`canView()`) cũng đánh dấu được, bất kể trạng thái
 * (nháp/đang chờ/đã duyệt/đã từ chối) — xem design.md của change
 * add-request-detail-base-parity, capability request-bookmark. */
export async function POST(
  _request: Request,
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

    const current = found.bookmarkedByUids ?? [];
    const isBookmarked = current.includes(session.uid);
    const bookmarkedByUids = isBookmarked
      ? current.filter((uid) => uid !== session.uid)
      : [...current, session.uid];

    await adminDb.collection("requests").doc(id).update({ bookmarkedByUids });
    return NextResponse.json({ bookmarkedByUids });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
