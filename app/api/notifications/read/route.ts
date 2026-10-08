import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { computeAndStoreFeedForSession, loadNotificationFeed } from "@/lib/server/notification-feed";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * "Đánh dấu đã đọc hết" trên chuông: ghi `viewedAt[uid]` = bây giờ cho mọi đề xuất đang
 * có dòng CHƯA ĐỌC của người này — cùng cách trang chi tiết ghi khi mở đề xuất
 * (app/api/requests/[id]/view). Chỉ lấy đề xuất từ chính danh sách thông báo của người
 * đó (đã đúng quyền), không nhận id tuỳ ý từ client. Ghi theo đường dẫn
 * `viewedAt.<uid>` nên không đụng `updatedAt` (không làm chuông người khác báo lại)
 * và không ghi đè lượt xem của người khác. Việc "Cần bạn duyệt" vẫn giữ trên chuông
 * tới khi duyệt xong.
 */
export async function POST() {
  try {
    const session = await requireSession();
    const feed = await loadNotificationFeed(session);
    const ids = feed.entries.filter((e) => e.unread).map((e) => e.requestId);
    const nowIso = new Date().toISOString();
    for (let i = 0; i < ids.length; i += 400) {
      const batch = adminDb.batch();
      for (const id of ids.slice(i, i + 400)) {
        batch.update(adminDb.collection("requests").doc(id), { [`viewedAt.${session.uid}`]: nowIso });
      }
      await batch.commit();
    }
    // Ghi lại chuông của chính mình — trình duyệt đang nghe nhận ngay bản "đã đọc hết".
    if (ids.length > 0) await computeAndStoreFeedForSession(session);
    return NextResponse.json({ ok: true, marked: ids.length });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
