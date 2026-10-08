import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { getWebPushConfig, isAllowedPushEndpoint, parseSubscriptionInput, removeSubscription, saveSubscription } from "@/lib/server/web-push";
import { requireSession } from "@/lib/session";

/** Lưu đăng ký Web Push của trình duyệt đang dùng (sau khi người dùng bấm "Bật trên máy này"). */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    if (!getWebPushConfig()) return NextResponse.json({ error: "Thông báo ra màn hình chưa được bật." }, { status: 404 });
    const sub = parseSubscriptionInput(await request.json().catch(() => null));
    if (!sub) return NextResponse.json({ error: "Đăng ký thông báo không hợp lệ." }, { status: 400 });
    await saveSubscription(session.uid, sub, request.headers.get("user-agent") ?? "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Tắt trên máy này — chỉ gỡ đúng trình duyệt đó, các máy khác của người này vẫn nhận. */
export async function DELETE(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
    if (!isAllowedPushEndpoint(body?.endpoint)) return NextResponse.json({ error: "Thiếu endpoint." }, { status: 400 });
    await removeSubscription(session.uid, body.endpoint);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
