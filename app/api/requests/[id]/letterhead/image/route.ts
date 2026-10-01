import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { createSignedReadUrl } from "@/lib/r2";
import { canView, loadRequest, resolveCategoryLetterheadPath } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Ảnh logo + tên công ty của đề xuất — mỗi lần trình duyệt tải là ký 1 link
 * R2 MỚI rồi chuyển hướng sang đó, nên `<img src>` trỏ vào đây không bao giờ
 * "hết hạn" dù trang để mở lâu rồi mới in. `no-store` để trình duyệt không
 * nhớ bước chuyển hướng cũ (đổi logo xong là thấy logo mới). Kiểm quyền xem
 * đề xuất giống route ../route.ts. Sếp chốt 01/10/2026.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const found = await loadRequest(id);
    if (!found) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    if (!canView(found, session.uid, session.role)) {
      return NextResponse.json({ error: "Bạn không có quyền xem đề xuất này." }, { status: 403 });
    }
    const path = await resolveCategoryLetterheadPath(found.groupId);
    if (!path) {
      return NextResponse.json({ error: "Công ty này chưa cài ảnh tiêu đề." }, { status: 404 });
    }
    const res = NextResponse.redirect(await createSignedReadUrl(path));
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
