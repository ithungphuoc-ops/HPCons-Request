import { NextResponse } from "next/server";
import { createSignedUploadUrl } from "@/lib/r2";
import { apiErrorResponse } from "@/lib/http";
import { MAX_DIRECT_UPLOAD_FILE_SIZE, MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL } from "@/lib/constants";
import { requireSession } from "@/lib/session";
import { buildUploadPath } from "@/lib/server/uploads";

export const runtime = "nodejs";

const MAX_FILES = 6;

type SignItem = { name?: unknown; size?: unknown; type?: unknown };

/**
 * Cấp link ký sẵn để trình duyệt PUT THẲNG file lên R2 — KHÔNG đẩy file qua
 * đây, nên không dính trần body 4,5MB của serverless function Vercel (nguyên
 * nhân thật của lỗi "file hơn 6MB không thêm được", đo ngày 13/09/2026).
 *
 * Dung lượng client khai được KÝ THẲNG vào link (`ContentLength`), nên đó cũng
 * là dung lượng tối đa ghi được — khai 1MB thì không đẩy 500MB lên được. Máy
 * chủ vẫn đo lại bằng `verifyUploadedAttachment()` lúc đính tệp vào đề xuất
 * (phòng thủ 2 lớp).
 */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as { files?: SignItem[] };
    const files = Array.isArray(body.files) ? body.files : [];

    if (files.length === 0) {
      return NextResponse.json({ error: "Chưa chọn tệp nào." }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Chỉ được đính kèm tối đa ${MAX_FILES} tệp mỗi lần.` },
        { status: 400 },
      );
    }

    const items = [];
    for (const file of files) {
      const name = typeof file.name === "string" ? file.name.trim() : "";
      const size = typeof file.size === "number" ? file.size : -1;
      if (!name || size < 0) {
        return NextResponse.json({ error: "Thông tin tệp không hợp lệ." }, { status: 400 });
      }
      if (size > MAX_DIRECT_UPLOAD_FILE_SIZE) {
        return NextResponse.json(
          { error: `Tệp "${name}" vượt quá ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}.` },
          { status: 400 },
        );
      }
      if (!Number.isInteger(size)) {
        return NextResponse.json({ error: "Dung lượng tệp không hợp lệ." }, { status: 400 });
      }
      const contentType = typeof file.type === "string" && file.type ? file.type : "application/octet-stream";
      const path = buildUploadPath(session.uid, name);
      // Ký kèm ĐÚNG dung lượng client khai: khai bao nhiêu chỉ ghi được bấy
      // nhiêu byte, khai xong đẩy tệp to hơn là R2 từ chối (403).
      items.push({
        name,
        path,
        contentType,
        size,
        url: await createSignedUploadUrl(path, contentType, size),
      });
    }

    return NextResponse.json({ items });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
