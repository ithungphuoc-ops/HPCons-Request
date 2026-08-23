import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { createSignedReadUrl } from "@/lib/r2";
import { apiErrorResponse } from "@/lib/http";
import { canManageGroupsAtAppScope } from "@/lib/permissions";
import { canView, loadRequest } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import type { RequestAttachment, RequestInstance } from "@/lib/types";

export const runtime = "nodejs";

/** Chỉ cho tải về đúng path đang thật sự nằm trong values HOẶC `attachments`
 * (cấp đề xuất, mới — xem capability request-level-attachments) của đề xuất
 * này — chặn đoán/truy cập path tuỳ ý dù đã qua canView. */
function collectAttachmentPaths(found: RequestInstance): Set<string> {
  const paths = new Set<string>();
  for (const value of Object.values(found.values)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const path = (item as Partial<RequestAttachment> | undefined)?.path;
      if (typeof path === "string") paths.add(path);
    }
  }
  for (const att of found.attachments ?? []) {
    if (att?.path) paths.add(att.path);
  }
  return paths;
}

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
      return NextResponse.json(
        { error: "Bạn không có quyền xem đề xuất này." },
        { status: 403 },
      );
    }

    const path = new URL(request.url).searchParams.get("path");
    if (!path || !collectAttachmentPaths(found).has(path)) {
      return NextResponse.json({ error: "Không tìm thấy tệp đính kèm." }, { status: 404 });
    }

    const signedUrl = await createSignedReadUrl(path);

    return NextResponse.redirect(signedUrl);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

interface AddAttachmentBody {
  attachment: RequestAttachment;
}

/** Thêm 1 tài liệu đính kèm CẤP ĐỀ XUẤT (khác file đính kèm trong `values`
 * của field kiểu "Tệp tin") — file đã tải lên qua `POST /api/uploads` TRƯỚC
 * khi gọi route này. Chỉ chủ đề xuất hoặc Owner/Admin được thêm — người xem
 * thường chỉ xem, xem design.md của change add-request-detail-base-parity,
 * capability request-level-attachments. */
export async function POST(
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
      return NextResponse.json({ error: "Bạn không có quyền trên đề xuất này." }, { status: 403 });
    }
    const isOwnRequest = found.submittedBy.uid === session.uid;
    if (!isOwnRequest && !canManageGroupsAtAppScope(session.role)) {
      return NextResponse.json(
        { error: "Chỉ chủ đề xuất hoặc Owner/Admin mới thêm được tài liệu." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as AddAttachmentBody;
    if (!body.attachment?.path) {
      return NextResponse.json({ error: "Thiếu tệp cần thêm." }, { status: 400 });
    }

    const attachments = [...(found.attachments ?? []), body.attachment];
    await adminDb.collection("requests").doc(id).update({ attachments });
    return NextResponse.json({ attachments });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
