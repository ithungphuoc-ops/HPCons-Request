import { after, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { computeAndStoreFeedForSession } from "@/lib/server/notification-feed";
import { getNotificationSettings, updateNotificationSettings } from "@/lib/server/notificationSettings";
import { requireSession } from "@/lib/session";
import type { NotificationSettings } from "@/lib/types";

export async function GET() {
  try {
    const session = await requireSession();
    const settings = await getNotificationSettings(session.uid);
    return NextResponse.json({ settings });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as Partial<NotificationSettings>;
    await updateNotificationSettings(session.uid, body);
    const settings = await getNotificationSettings(session.uid);
    // Tắt/bật loại thông báo → tính lại chuông của chính mình (tài liệu notification-feed
    // lưu kèm cài đặt để sự kiện của người khác tính lại không phải đọc App Tổng).
    after(() => computeAndStoreFeedForSession(session).catch(() => {}));
    return NextResponse.json({ settings });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
