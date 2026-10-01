import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { canView, loadRequest, resolveCategoryLetterheadPath } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Cho biết công ty của đề xuất này đã cài logo + tên công ty (ảnh "tiêu đề
 * công văn") chưa — RequestDetailView.tsx gọi khi mở, hiện ở đầu bản in.
 * Tách route riêng thay vì nhét vào GET /api/requests/[id] vì khung chi
 * tiết còn được dùng ở trang danh sách (app/request/list/page.tsx), nơi
 * dữ liệu đề xuất lấy từ API danh sách chứ không qua GET chi tiết.
 * `url` là đường dẫn CỐ ĐỊNH của app (./letterhead/image), không phải link
 * R2 ký sẵn — để trang mở bao lâu rồi in cũng không vỡ ảnh. `{ url: null }`
 * (không lỗi) khi công ty chưa cài ảnh. Sếp chốt 01/10/2026.
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
    return NextResponse.json({ url: path ? `/api/requests/${id}/letterhead/image` : null });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
