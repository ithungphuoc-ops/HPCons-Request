import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { letterheadVersion } from "@/lib/letterhead";
import { downloadObjectWithType } from "@/lib/r2";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

// Khớp đúng danh sách PATCH ../route.ts nhận khi lưu ảnh (không SVG).
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Ảnh "tiêu đề công văn" (logo + tên công ty) của 1 công ty — trả THẲNG file
 * (không chuyển hướng sang link R2 ký sẵn) để trình duyệt NHỚ được ảnh: mọi
 * đề xuất cùng công ty dùng lại đúng 1 ảnh, bấm In là có logo liền (Sếp chốt
 * 02/10/2026 — trước đó mỗi lần mở đề xuất phải tải lại 1–3 giây, bấm In
 * sớm thì bản in thiếu logo). URL do lib/letterhead.ts dựng, có `?v=` đổi
 * theo path R2: `v` khớp ảnh hiện tại thì cho nhớ lâu (immutable — đổi logo
 * là URL đổi), lệch/thiếu `v` thì không cho nhớ.
 *
 * Mọi người đã đăng nhập đều tải được: logo công ty không phải dữ liệu riêng
 * tư, và GET /api/groups vốn đã trả danh sách công ty + path ảnh cho mọi
 * người đăng nhập. `private` để CDN Vercel không giữ bản chung.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession();
    const { id } = await params;
    const snap = await adminDb.collection("categories").doc(id).get();
    const path = snap.exists
      ? (snap.data() as { letterheadImagePath?: string }).letterheadImagePath
      : undefined;
    if (!path) {
      return NextResponse.json({ error: "Công ty này chưa cài ảnh tiêu đề." }, { status: 404 });
    }

    const file = await downloadObjectWithType(path);
    const contentType = file?.contentType?.toLowerCase() ?? "";
    if (!file || !ALLOWED_IMAGE_TYPES.includes(contentType)) {
      return NextResponse.json({ error: "Không đọc được ảnh tiêu đề." }, { status: 404 });
    }

    const requestedVersion = new URL(request.url).searchParams.get("v");
    const isCurrentVersion = requestedVersion === letterheadVersion(path);
    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(file.body.length),
        "Cache-Control": isCurrentVersion ? "private, max-age=31536000, immutable" : "private, no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
