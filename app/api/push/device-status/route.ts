import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { rejectUnlessJsonSameOrigin } from "@/lib/server/push-request-guard";
import { getWebPushConfig, isAllowedPushEndpoint, isDeviceRegisteredTo } from "@/lib/server/web-push";
import { requireSession } from "@/lib/session";

/**
 * Trình duyệt đã có đăng ký Web Push — hỏi máy chủ xem nó có đang gắn cho NGƯỜI ĐANG ĐĂNG
 * NHẬP không. Máy dùng chung (người trước chưa tắt) → `registered: false`, giao diện hiện
 * "Bật trên máy này" để người mới tự bấm; KHÔNG tự gắn ngầm. Chỉ đọc, không ghi.
 */
export async function POST(request: Request) {
  try {
    const blocked = rejectUnlessJsonSameOrigin(request);
    if (blocked) return blocked;
    const session = await requireSession();
    if (!getWebPushConfig()) return NextResponse.json({ registered: false });
    const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
    if (!isAllowedPushEndpoint(body?.endpoint)) return NextResponse.json({ registered: false });
    return NextResponse.json({ registered: await isDeviceRegisteredTo(session.uid, body.endpoint) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
