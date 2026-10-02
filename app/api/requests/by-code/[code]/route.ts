import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { canView, findRequestsByCode } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";

/** Đổi mã đề xuất → id cho trang `/request/<mã>`. Quyền xem kiểm y hệt GET /api/requests/[id]. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const session = await requireSession();
    const { code } = await params;
    const found = await findRequestsByCode(code);
    if (found.length === 0) {
      return NextResponse.json({ error: `Không tìm thấy đề xuất mã ${code}.` }, { status: 404 });
    }
    const visible = found.filter((r) => canView(r, session.uid, session.role));
    if (visible.length === 0) {
      return NextResponse.json({ error: "Bạn không có quyền xem đề xuất này." }, { status: 403 });
    }
    return NextResponse.json({
      matches: visible.map((r) => ({
        id: r.id,
        code: r.code,
        groupName: r.groupNameSnapshot,
        submittedAt: r.submittedAt,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
