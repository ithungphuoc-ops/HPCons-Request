import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { rejectUnlessJsonSameOrigin } from "@/lib/server/push-request-guard";
import { allowTestPush, isAllowedPushEndpoint, sendTestPush } from "@/lib/server/web-push";
import { requireSession } from "@/lib/session";
import { buildTestPushPayload } from "@/lib/web-push-payload";

/** "Gửi thử" — đẩy 1 thông báo mẫu tới ĐÚNG trình duyệt đang bấm, để người dùng tự kiểm. */
export async function POST(request: Request) {
  try {
    const blocked = rejectUnlessJsonSameOrigin(request);
    if (blocked) return blocked;
    const session = await requireSession();
    if (!allowTestPush(session.uid)) {
      return NextResponse.json({ error: "Vừa gửi thử rồi — đợi 10 giây rồi bấm lại." }, { status: 429 });
    }
    const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
    if (!isAllowedPushEndpoint(body?.endpoint)) return NextResponse.json({ error: "Thiếu endpoint." }, { status: 400 });
    const result = await sendTestPush(session.uid, body.endpoint, buildTestPushPayload());
    if (result === "ok") return NextResponse.json({ ok: true });
    if (result === "disabled") return NextResponse.json({ error: "Thông báo ra màn hình chưa được bật." }, { status: 404 });
    if (result === "not_found" || result === "gone") {
      return NextResponse.json({ error: "Máy này chưa đăng ký hoặc đăng ký đã hết hạn — bấm \"Bật trên máy này\" lại." }, { status: 409 });
    }
    return NextResponse.json({ error: "Dịch vụ đẩy của trình duyệt chưa nhận thư, thử lại sau." }, { status: 502 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
