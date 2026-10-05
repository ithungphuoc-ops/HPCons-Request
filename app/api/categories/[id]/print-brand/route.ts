import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { FILE_NAME_FORBIDDEN_CHARS, PRINT_BRAND_MAX_LENGTH } from "@/lib/letterhead";
import { requireWriteAccess } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Lưu "Tên hiển thị khi in / tải file" của 1 công ty (category) — vd "HPCons
 * Request". Dùng cho tên tệp PDF/Word/Excel khi in/tải đề xuất và chân trang
 * Word/Excel (xem resolvePrintBrand ở lib/letterhead.ts). Để TRỐNG = ẩn. Chỉ
 * Owner/Admin, cùng chỗ cài logo ("⚙ Cài đặt thông tin" ở trang Tất cả nhóm đề
 * xuất). Sếp chốt 05/10/2026.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireWriteAccess();
    const { id } = await params;
    const snap = await adminDb.collection("categories").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Không tìm thấy công ty." }, { status: 404 });
    }

    const body = (await request.json().catch(() => ({}))) as { printBrandName?: unknown };
    if (typeof body.printBrandName !== "string") {
      return NextResponse.json({ error: "Thiếu tên hiển thị." }, { status: 400 });
    }
    const printBrandName = body.printBrandName.replace(/\s+/g, " ").trim();
    if (printBrandName.length > PRINT_BRAND_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Tên hiển thị tối đa ${PRINT_BRAND_MAX_LENGTH} ký tự.` },
        { status: 400 },
      );
    }
    if (FILE_NAME_FORBIDDEN_CHARS.test(printBrandName)) {
      return NextResponse.json(
        { error: 'Tên hiển thị không được chứa các ký tự \\ / : * ? " < > | (dùng làm tên tệp).' },
        { status: 400 },
      );
    }

    await snap.ref.update({ printBrandName });
    return NextResponse.json({ printBrandName });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
