import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { MAX_PREVIEW_FILE_SIZE, MAX_PREVIEW_FILE_SIZE_LABEL } from "@/lib/constants";
import { downloadObject, headObjectSize } from "@/lib/r2";
import { canView, collectAttachmentPaths, loadRequest } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import { canManageGroupsAtAppScope } from "@/lib/permissions";

export const runtime = "nodejs";

/**
 * Nội dung THÔ của 1 tệp đính kèm để trình xem Excel/Word trong popup đọc
 * (components/request/office/*, Sếp chốt 02/10/2026). Khác `../route.ts` (GET
 * chuyển hướng sang link R2 ký sẵn để tải về/xem PDF, ảnh): trình duyệt cần ĐỌC
 * bytes bằng fetch, mà bucket R2 chưa bật CORS cho đọc thẳng, nên máy chủ đọc hộ.
 * Cùng luật quyền với tải về: phải xem được đề xuất + path phải thuộc đề xuất.
 * Giới hạn MAX_PREVIEW_FILE_SIZE vì phản hồi đi qua serverless của Vercel.
 * `Content-Disposition: attachment` + `nosniff`: mở thẳng link này chỉ tải tệp
 * về, trình duyệt không bao giờ hiển thị nội dung như một trang web.
 */
export async function GET(
  request: Request,
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

    const path = new URL(request.url).searchParams.get("path");
    if (!path || !collectAttachmentPaths(found, { includeRemoved: canManageGroupsAtAppScope(session.role) }).has(path)) {
      return NextResponse.json({ error: "Không tìm thấy tệp đính kèm." }, { status: 404 });
    }

    const size = await headObjectSize(path);
    if (size === null) {
      return NextResponse.json({ error: "Không tìm thấy tệp đính kèm." }, { status: 404 });
    }
    if (size > MAX_PREVIEW_FILE_SIZE) {
      return NextResponse.json(
        { error: `Tệp lớn hơn ${MAX_PREVIEW_FILE_SIZE_LABEL}, không xem nhanh được. Bấm "Tải về" để xem trên máy.` },
        { status: 413 },
      );
    }

    // Tệp có thể vừa bị xoá giữa lúc đo kích thước và lúc tải — báo như không tìm thấy,
    // không đưa lỗi thô của R2 ra cho người dùng.
    const body = await downloadObject(path).catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Không tìm thấy tệp đính kèm." }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.length),
        "Content-Disposition": "attachment",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
