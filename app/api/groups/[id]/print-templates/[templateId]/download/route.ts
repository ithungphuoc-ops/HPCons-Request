import { NextResponse } from "next/server";
import { createSignedReadUrl } from "@/lib/r2";
import { apiErrorResponse } from "@/lib/http";
import { getPrintTemplate } from "@/lib/server/print-templates";
import { requireWriteAccess } from "@/lib/session";

export const runtime = "nodejs";

/** Tải mẫu gốc (.docx) xuống — chỉ người quản lý mẫu in mới xem/tải được. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    await requireWriteAccess();
    const { id, templateId } = await params;
    const template = await getPrintTemplate(id, templateId);
    if (!template) {
      return NextResponse.json({ error: "Không tìm thấy mẫu in." }, { status: 404 });
    }

    const signedUrl = await createSignedReadUrl(template.path);

    return NextResponse.redirect(signedUrl);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
