import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
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
    return NextResponse.json({ settings });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
