import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { MAX_UPLOAD_FILE_SIZE } from "@/lib/constants";
import { deleteObject, headObjectMeta } from "@/lib/r2";
import { isOwnUploadPath } from "@/lib/server/uploads";
import { requireWriteAccess } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Lưu ảnh "tiêu đề công văn" (logo + tên công ty, đã thiết kế sẵn thành 1 ảnh
 * duy nhất) RIÊNG cho từng category — 1 app Request này đang dùng CHUNG cho
 * nhiều công ty (vd "02 - HPCons", "03 - EQUI"), mỗi công ty cần đúng
 * logo/tên của mình khi in đề xuất. Ảnh tải lên trước qua `/api/uploads`,
 * route này chỉ ghi path vào doc `categories/{id}`. Đọc ra để in: xem
 * `resolveCategoryLetterheadPath` (lib/server/requests.ts). Chỉ Owner/Admin
 * (`requireWriteAccess`) — khớp trang "Tất cả nhóm đề xuất" nơi đặt nút này
 * đã bọc RequireAdminRole. Sếp chốt 01/10/2026.
 */

// Không nhận SVG: ảnh này được trả thẳng cho trình duyệt, SVG chứa được
// script — không đáng rủi ro cho 1 logo in giấy.
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const ALLOWED_IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

interface PatchBody {
  path?: unknown;
  name?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const snap = await adminDb.collection("categories").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Không tìm thấy công ty." }, { status: 404 });
    }

    const body = (await request.json()) as PatchBody;
    if (typeof body.path !== "string" || !body.path || typeof body.name !== "string" || !body.name) {
      return NextResponse.json({ error: "Thiếu ảnh cần lưu." }, { status: 400 });
    }
    if (!isOwnUploadPath(body.path, session.uid)) {
      return NextResponse.json(
        { error: "Ảnh không hợp lệ — chỉ chấp nhận ảnh vừa tải lên." },
        { status: 400 },
      );
    }
    if (!ALLOWED_IMAGE_EXT.test(body.name) || !ALLOWED_IMAGE_EXT.test(body.path)) {
      return NextResponse.json(
        { error: "Chỉ nhận ảnh PNG, JPG, WEBP hoặc GIF." },
        { status: 400 },
      );
    }
    // Kiểm lại trên R2 — không tin kích thước/loại file client khai: file phải
    // tồn tại thật, đúng loại ảnh, không quá giới hạn tải lên.
    const meta = await headObjectMeta(body.path);
    if (!meta) {
      return NextResponse.json({ error: "Không tìm thấy ảnh vừa tải lên." }, { status: 400 });
    }
    if (!meta.contentType || !ALLOWED_IMAGE_TYPES.includes(meta.contentType.toLowerCase())) {
      return NextResponse.json(
        { error: "Chỉ nhận ảnh PNG, JPG, WEBP hoặc GIF." },
        { status: 400 },
      );
    }
    if (meta.size > MAX_UPLOAD_FILE_SIZE) {
      return NextResponse.json({ error: "Kích thước ảnh không hợp lệ." }, { status: 400 });
    }

    const oldPath = (snap.data() as { letterheadImagePath?: string }).letterheadImagePath;
    await snap.ref.update({ letterheadImagePath: body.path, letterheadImageName: body.name });
    // Xoá ảnh cũ sau khi đã ghi ảnh mới — ảnh logo chỉ được tham chiếu ở đúng
    // doc category này. deleteObject tự nuốt lỗi, không chặn việc đổi logo.
    if (oldPath && oldPath !== body.path) {
      await deleteObject(oldPath);
    }
    return NextResponse.json({ letterheadImagePath: body.path, letterheadImageName: body.name });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
