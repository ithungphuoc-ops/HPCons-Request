import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { getPushPreferences, getWebPushConfig, updatePushPreferences } from "@/lib/server/web-push";
import { rejectUnlessJsonSameOrigin } from "@/lib/server/push-request-guard";
import { requireSession } from "@/lib/session";

/**
 * Thông báo ra màn hình (Web Push) — 1 lượt GET rẻ duy nhất khi mở Cài đặt thông báo / dải
 * nhắc trong chuông: cho biết tính năng có bật trên máy chủ không, khoá công khai VAPID để
 * trình duyệt đăng ký, và 3 công tắc của người đang đăng nhập.
 * Khoá công khai đưa qua đây (không dùng NEXT_PUBLIC_) để chỉ cần 1 bộ biến môi trường phía
 * máy chủ; thiếu biến → `enabled: false`, giao diện tự ẩn mục bật.
 */
export async function GET() {
  try {
    const session = await requireSession();
    const config = getWebPushConfig();
    if (!config) return NextResponse.json({ enabled: false });
    const prefs = await getPushPreferences(session.uid);
    return NextResponse.json({ enabled: true, publicKey: config.publicKey, prefs });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const blocked = rejectUnlessJsonSameOrigin(request);
    if (blocked) return blocked;
    const session = await requireSession();
    if (!getWebPushConfig()) return NextResponse.json({ error: "Thông báo ra màn hình chưa được bật." }, { status: 404 });
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Dữ liệu không hợp lệ." }, { status: 400 });
    }
    const prefs = await updatePushPreferences(session.uid, body as Record<string, unknown>);
    return NextResponse.json({ prefs });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
