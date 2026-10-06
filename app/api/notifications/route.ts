import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { loadNotificationFeed } from "@/lib/server/notification-feed";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Danh sách thông báo cho chuông (NotificationBell) — 1 lượt tải duy nhất, thay cho 7
 * lượt `/api/requests?scope=…` + `/api/notification-settings` trước đây. Xem
 * lib/notification-feed.ts (quy tắc) và lib/server/notification-feed.ts (đọc dữ liệu).
 * Sếp duyệt demo 06/10/2026. `no-store`: chuông luôn phải thấy dữ liệu mới nhất.
 */
export async function GET() {
  try {
    const session = await requireSession();
    const feed = await loadNotificationFeed(session);
    return NextResponse.json(feed, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
