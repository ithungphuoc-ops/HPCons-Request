import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { createSignedReadUrl } from "@/lib/r2";
import { apiErrorResponse } from "@/lib/http";
import { MAX_UPLOAD_FILE_SIZE } from "@/lib/constants";
import { canManageGroupsAtAppScope, canSupplementAfterApproval } from "@/lib/permissions";
import { canView, loadRequest } from "@/lib/server/requests";
import { isOwnUploadPath } from "@/lib/server/uploads";
import { requireSession } from "@/lib/session";
import { ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX } from "@/lib/request-history-labels";
import type { RequestAttachment, RequestHistoryEntry, RequestInstance } from "@/lib/types";

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
    // Đề xuất ĐÃ DUYỆT: chỉ CHÍNH submitter được thêm tài liệu — Owner/Admin
    // không được làm thay (siết chặt hơn quy tắc mặc định bên dưới, đặc thù
    // cho "xác nhận giữa 2 bên" — không phải ai cũng được xác nhận thay chủ
    // đề xuất). Trạng thái khác (draft/pending/returned) giữ nguyên hành vi
    // cũ. Dùng chung 1 hàm với route table-supplement + UI
    // (lib/permissions.ts) — đổi luật chỉ cần sửa 1 chỗ, xem design.md của
    // change add-post-approval-supplement.
    if (found.status === "approved") {
      if (!canSupplementAfterApproval(found, session.uid)) {
        return NextResponse.json(
          { error: "Đề xuất đã duyệt — chỉ chính người làm đề xuất mới thêm được tài liệu." },
          { status: 403 },
        );
      }
    } else if (!isOwnRequest && !canManageGroupsAtAppScope(session.role)) {
      return NextResponse.json(
        { error: "Chỉ chủ đề xuất hoặc Owner/Admin mới thêm được tài liệu." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as AddAttachmentBody;
    const { attachment } = body;
    // 2 góp ý Minor của CodeRabbit (lần review thứ 2, 24/08/2026): (1) chỉ
    // kiểm tra "truthy" không chặn được path/name kiểu KHÔNG PHẢI string
    // (vd number/boolean) — phải ép rõ typeof "string" trước khi gọi
    // isOwnUploadPath() (nếu không, .startsWith() trên non-string sẽ throw,
    // trả lỗi 500 thay vì 400 gọn gàng); (2) `/api/uploads` KHÔNG chặn file
    // 0 byte, nên chỗ này không được chặn chặt hơn (`size <= 0`) — sẽ tạo ra
    // tình huống tải lên thành công nhưng không đính kèm được — đổi thành
    // `size < 0` để 2 route thống nhất cùng 1 quy tắc.
    if (
      typeof attachment?.path !== "string" ||
      !attachment.path ||
      typeof attachment.name !== "string" ||
      !attachment.name
    ) {
      return NextResponse.json({ error: "Thiếu tệp cần thêm." }, { status: 400 });
    }
    if (!isOwnUploadPath(attachment.path, session.uid)) {
      return NextResponse.json(
        { error: "Tệp không hợp lệ — chỉ chấp nhận tệp bạn vừa tải lên." },
        { status: 400 },
      );
    }
    if (typeof attachment.size !== "number" || attachment.size < 0 || attachment.size > MAX_UPLOAD_FILE_SIZE) {
      return NextResponse.json({ error: "Kích thước tệp không hợp lệ." }, { status: 400 });
    }

    const attachments = [...(found.attachments ?? []), attachment];

    // Chỉ ghi nhật ký "sau duyệt" khi đúng là đang bổ sung sau duyệt — đính
    // file lúc còn draft/pending/returned là hành vi cũ, không cần đếm "lần
    // mấy" (không thuộc phạm vi "Bổ sung sau duyệt").
    const patch: { attachments: RequestAttachment[]; history?: RequestHistoryEntry[] } = { attachments };
    if (found.status === "approved") {
      const priorCount = found.history.filter((h) =>
        h.action.startsWith(ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX),
      ).length;
      const historyEntry: RequestHistoryEntry = {
        at: new Date().toISOString(),
        actor: session.name,
        action: `${ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX} (lần ${priorCount + 1}): ${attachment.name}`,
      };
      patch.history = [...found.history, historyEntry];
    }

    await adminDb.collection("requests").doc(id).update(patch);
    return NextResponse.json({ attachments, history: patch.history });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
