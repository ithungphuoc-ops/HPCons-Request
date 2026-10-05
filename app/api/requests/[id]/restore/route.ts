import { after, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { guiCacViec, taoViecDongBo } from "@/lib/dong-bo/hang-cho";
import { apiErrorResponse } from "@/lib/http";
import { canManageGroupsAtAppScope } from "@/lib/permissions";
import { loadRequest } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";

// Báo Kho / Thu mua chạy trong after() — cho đủ thời gian gửi (gói miễn phí tối đa 60 giây).
export const maxDuration = 60;

/** Khôi phục đề xuất đã xóa mềm — chỉ Owner/Admin (tránh nhân viên tự khôi
 * phục lại đề xuất đã bị xóa vì lý do quản trị). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    if (!canManageGroupsAtAppScope(session.role)) {
      return NextResponse.json(
        { error: "Chỉ Owner hoặc Admin mới khôi phục được đề xuất." },
        { status: 403 },
      );
    }
    const { id } = await params;
    const found = await loadRequest(id);
    if (!found) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    if (!found.deletedAt) {
      return NextResponse.json({ request: found });
    }

    const nowIso = new Date().toISOString();
    const history = [
      ...found.history,
      { at: nowIso, actor: session.name, action: "Đã khôi phục đề xuất" },
    ];
    await adminDb.collection("requests").doc(id).update({ deletedAt: null, history });
    /* ★ 03/10/2026 (đợt 1 "liên kết 4 app", L05/L06) — khôi phục đề xuất ĐÃ DUYỆT thì báo Kho + Thu
       mua hiện lại đề nghị. Lỗi tạo việc không được làm hỏng thao tác khôi phục. */
    if (found.status === "approved") {
      try {
        const ids = await taoViecDongBo({ requestId: id, requestCode: found.code ?? null, loai: "khoi_phuc", nguoi: session.name });
        after(() => guiCacViec(ids));
      } catch (err) {
        console.error(`Tạo việc báo khôi phục đề xuất ${id} sang Kho / Thu mua lỗi:`, err);
      }
    }
    return NextResponse.json({ request: { ...found, deletedAt: null, history } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
