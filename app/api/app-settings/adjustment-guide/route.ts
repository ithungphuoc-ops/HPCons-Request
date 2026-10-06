import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { ADJUSTMENT_GUIDE_MAX_LENGTH, DEFAULT_ADJUSTMENT_GUIDE } from "@/lib/adjustment-settings";
import { getAdjustmentGuide, saveAdjustmentGuide } from "@/lib/server/adjustment-reviewers";
import { requireSession, requireWriteAccess } from "@/lib/session";

/**
 * "Hướng dẫn điều chỉnh sau duyệt" — 1 nội dung CHUNG toàn app (Sếp chốt
 * 06/10/2026), hiện thành cảnh báo vàng trong hộp "Điều chỉnh". Ai đăng nhập
 * cũng đọc được; chỉ Owner/Admin sửa được (`requireWriteAccess`).
 * Lưu ở `appSettings/adjustment` (Firestore project của app Đề xuất).
 */
export async function GET() {
  try {
    await requireSession();
    const data = await getAdjustmentGuide();
    return NextResponse.json({ ...data, defaultGuide: DEFAULT_ADJUSTMENT_GUIDE });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireWriteAccess();
    const body = (await request.json()) as { guide?: unknown };
    if (typeof body.guide !== "string") {
      return NextResponse.json({ error: "Nội dung hướng dẫn không hợp lệ." }, { status: 400 });
    }
    // Giữ xuống dòng; bỏ khoảng trắng thừa 2 đầu.
    const guide = body.guide.replace(/\r\n/g, "\n").trim();
    if (guide.length > ADJUSTMENT_GUIDE_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Hướng dẫn tối đa ${ADJUSTMENT_GUIDE_MAX_LENGTH} ký tự.` },
        { status: 400 },
      );
    }
    await saveAdjustmentGuide(guide, session.name);
    const data = await getAdjustmentGuide();
    return NextResponse.json({ ...data, defaultGuide: DEFAULT_ADJUSTMENT_GUIDE });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
