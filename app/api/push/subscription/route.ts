import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { HPCORE_PUSH_SETTINGS_URL, PUSH_MOVED_MESSAGE } from "@/lib/constants";
import { isAllowedPushEndpoint, removeSubscription } from "@/lib/server/web-push";
import { rejectUnlessJsonSameOrigin } from "@/lib/server/push-request-guard";
import { requireSession } from "@/lib/session";

/**
 * NGỪNG NHẬN đăng ký mới (08/10/2026): thông báo ra màn hình chuyển sang App Tổng — bật ở
 * account.hpcore.vn/dashboard/thong-bao?caidat=man-hinh. Giữ route 1 bản phát hành.
 */
export async function POST() {
  return NextResponse.json({ error: `${PUSH_MOVED_MESSAGE}.`, settingsUrl: HPCORE_PUSH_SETTINGS_URL }, { status: 410 });
}

/** Gỡ đăng ký CŨ của trình duyệt này (trang tự gọi 1 lần khi thấy máy còn đăng ký trên
 * request.hpcore.vn — xem migrateLegacyPushSubscription). Chỉ gỡ đúng trình duyệt đó. */
export async function DELETE(request: Request) {
  try {
    const blocked = rejectUnlessJsonSameOrigin(request);
    if (blocked) return blocked;
    const session = await requireSession();
    const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
    if (!isAllowedPushEndpoint(body?.endpoint)) return NextResponse.json({ error: "Thiếu endpoint." }, { status: 400 });
    await removeSubscription(session.uid, body.endpoint);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
