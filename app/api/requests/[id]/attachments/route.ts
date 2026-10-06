import { after, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { guiCacViec, taoViecDongBo } from "@/lib/dong-bo/hang-cho";
import { createSignedReadUrl } from "@/lib/r2";
import { apiErrorResponse } from "@/lib/http";
import { MAX_DIRECT_UPLOAD_FILE_SIZE } from "@/lib/constants";
import { canManageGroupsAtAppScope } from "@/lib/permissions";
import { canView, collectAttachmentPaths, loadRequest } from "@/lib/server/requests";
import { checkAddAttachmentAccess, planAddAttachment } from "@/lib/server/request-supplement";
import { RequestTxError } from "@/lib/server/request-write-guard";
import { verifyUploadedAttachment } from "@/lib/server/verify-upload";
import { requireSession } from "@/lib/session";
import type { RequestAttachment, RequestInstance } from "@/lib/types";

export const runtime = "nodejs";
// Báo Kho / Thu mua chạy trong after() — cho đủ thời gian gửi (gói miễn phí tối đa 60 giây).
export const maxDuration = 60;

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
    if (!path || !collectAttachmentPaths(found, { includeRemoved: canManageGroupsAtAppScope(session.role) }).has(path)) {
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
    // Đề xuất ĐÃ DUYỆT: chỉ CHÍNH submitter được thêm tài liệu — Owner/Admin
    // không được làm thay (đặc thù "xác nhận giữa 2 bên"). Trạng thái khác
    // (draft/pending/returned): chủ đề xuất hoặc Owner/Admin. Đã xoá mềm → 409.
    // Kiểm sớm ở đây để không đo R2 vô ích; transaction bên dưới kiểm lại trên
    // bản mới nhất. Xem checkAddAttachmentAccess (lib/server/request-supplement.ts).
    const denied = checkAddAttachmentAccess(found, session.uid, session.role);
    if (denied) {
      return NextResponse.json({ error: denied.error }, { status: denied.status });
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
    // Gộp luôn kiểm tra "path có đúng của chính người gọi không" vào
    // verifyUploadedAttachment() — 1 luật, 1 chỗ.
    // Đo kích thước THẬT trên R2 thay vì tin con số client gửi — từ 13/09/2026
    // trình duyệt tải thẳng lên R2 bằng link ký sẵn, người dùng có thể xin link
    // cho "1MB" rồi đẩy file 500MB.
    const verified = await verifyUploadedAttachment(
      attachment,
      session.uid,
      MAX_DIRECT_UPLOAD_FILE_SIZE,
    );
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: 400 });
    }
    // Chỉ giữ 3 trường chuẩn — không lưu trường lạ client tự thêm (vd giả
    // `source: "decision"` để mạo nhãn "Đính kèm khi duyệt").
    const cleanAttachment: RequestAttachment = { name: attachment.name, path: attachment.path, size: verified.size };

    // Đọc – kiểm – ghi trong transaction (06/10/2026, làm tiếp sau PR #82):
    // kiểm lại quyền/xoá mềm trên bản MỚI NHẤT, đếm "lần N" trên bản mới nhất,
    // rồi NỐI tệp + dòng lịch sử bằng arrayUnion — không ghi đè cả mảng
    // `history` từ bản đọc cũ (trước đây có thể xoá mất dòng của quyết định
    // duyệt / hàng chờ đồng bộ ghi xen giữa). Callback có thể chạy lại — chỉ
    // đọc/tính/ghi, việc báo Kho/Thu mua làm SAU khi commit.
    const ref = adminDb.collection("requests").doc(id);
    const { plan, latest } = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new RequestTxError(404, "Không tìm thấy đề xuất.");
      const fresh = { id: snap.id, ...snap.data() } as RequestInstance;
      const freshDenied = checkAddAttachmentAccess(fresh, session.uid, session.role);
      if (freshDenied) throw new RequestTxError(freshDenied.status, freshDenied.error);
      const plan = planAddAttachment(fresh, cleanAttachment, session.name, new Date().toISOString());
      tx.update(ref, {
        attachments: FieldValue.arrayUnion(cleanAttachment),
        ...(plan.historyEntry ? { history: FieldValue.arrayUnion(plan.historyEntry) } : {}),
      });
      return { plan, latest: fresh };
    });
    /* ★ 03/10/2026 (đợt 1 "liên kết 4 app", L09/L10) — thêm tài liệu sau duyệt thì báo Kho + Thu mua
       lưu thêm file. Lỗi tạo việc không được làm hỏng thao tác thêm tài liệu. */
    if (latest.status === "approved") {
      try {
        const ids = await taoViecDongBo({
          requestId: id,
          requestCode: latest.code ?? null,
          loai: "them_file",
          nguoi: session.name,
          taiLieu: [{ name: attachment.name, path: attachment.path }],
        });
        after(() => guiCacViec(ids));
      } catch (err) {
        console.error(`Tạo việc báo thêm tài liệu đề xuất ${id} sang Kho / Thu mua lỗi:`, err);
      }
    }
    return NextResponse.json({ attachments: plan.attachments, history: plan.history });
  } catch (error) {
    if (error instanceof RequestTxError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return apiErrorResponse(error);
  }
}
