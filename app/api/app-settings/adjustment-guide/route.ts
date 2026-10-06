import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { getDefaultAdjustmentGuide } from "@/lib/server/adjustment-reviewers";
import { requireWriteAccess } from "@/lib/session";

/**
 * Nội dung hướng dẫn điều chỉnh MẶC ĐỊNH — CHỈ ĐỌC.
 *
 * Từ 06/10/2026 (Sếp chốt) mỗi nhóm có hướng dẫn riêng, soạn trong tab "Điều
 * chỉnh sau duyệt" của nhóm (lưu qua PATCH /api/groups/[id], field
 * `adjustmentGuide`). Route này chỉ còn phục vụ tab đó: xem trước nội dung
 * mặc định khi nhóm chưa soạn riêng + nút "Dùng nội dung mặc định". Đã bỏ PUT
 * (trang "Cài đặt chung" đã xoá) — doc `appSettings/adjustment` cũ chỉ còn
 * được đọc làm mặc định.
 */
export async function GET() {
  try {
    await requireWriteAccess();
    return NextResponse.json({ defaultGuide: await getDefaultAdjustmentGuide() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
