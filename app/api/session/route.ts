import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { requireSession } from "@/lib/session";

/** Danh tính phiên hiện tại cho client component (biết "đây có phải tôi không"). */
export async function GET() {
  try {
    // Chỉ đọc danh tính để hiện UI — không duyệt, không đổi quyền, không dữ
    // liệu nhạy cảm → cho phép cache 60s xác minh phiên (xem lib/hpcore.ts).
    const session = await requireSession({ fresh: false });
    return NextResponse.json({
      uid: session.uid,
      email: session.email,
      name: session.name,
      role: session.role,
      avatarUrl: session.avatarUrl,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
