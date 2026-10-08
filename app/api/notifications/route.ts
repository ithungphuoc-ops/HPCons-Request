import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { computeAndStoreFeedForSession } from "@/lib/server/notification-feed";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Danh sách thông báo cho chuông (NotificationBell). Từ "cấp 2" (Sếp duyệt 08/10/2026)
 * chuông KHÔNG hỏi vòng route này nữa — nó nghe tài liệu `notification-feed/{uid}` mà
 * máy chủ ghi sẵn lúc có sự kiện (lib/server/notification-feed.ts). Route này chỉ còn là
 * đường tường minh: lần đầu (chưa có tài liệu → tính + ghi, bù dần người dùng cũ), tài
 * liệu quá hạn/khác phiên bản, nút "Thử lại", hoặc trình duyệt không nghe được Firestore.
 * `no-store`: luôn tính mới.
 */
export async function GET() {
  try {
    const session = await requireSession();
    const feed = await computeAndStoreFeedForSession(session);
    return NextResponse.json(feed, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
