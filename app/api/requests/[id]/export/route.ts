import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { downloadObject } from "@/lib/r2";
import { apiErrorResponse } from "@/lib/http";
import { renderPrintTemplate } from "@/lib/server/print-engine";
import { logPrintExport } from "@/lib/server/print-exports";
import { getDefaultPrintTemplate, getPrintTemplate } from "@/lib/server/print-templates";
import { canView, loadRequest } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import { resolveRequestTitle } from "@/lib/request-title";
import type { ProposalGroup } from "@/lib/types";

// Cần Node runtime (không phải Edge) để dùng firebase-admin/storage + docxtemplater.
export const runtime = "nodejs";

/** Tên file: "Mã đề xuất - Tên đề xuất - Ngày xuất.docx", loại ký tự không hợp lệ trong tên file. */
function sanitizeForFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "").trim();
}

/** Điền dữ liệu THẬT của đề xuất vào mẫu in đã chọn (hoặc mẫu mặc định) và trả về file .docx tải xuống. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const templateId = new URL(request.url).searchParams.get("templateId");

  try {
    const session = await requireSession();
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
    if (!found.groupId) {
      return NextResponse.json(
        { error: "Đề xuất trực tiếp không có mẫu in tuỳ chỉnh." },
        { status: 404 },
      );
    }

    const groupSnap = await adminDb.collection("groups").doc(found.groupId).get();
    if (!groupSnap.exists) {
      return NextResponse.json({ error: "Không tìm thấy nhóm đề xuất." }, { status: 404 });
    }
    const group = { id: groupSnap.id, ...groupSnap.data() } as ProposalGroup;

    if (group.printRequireFullyApproved && found.status !== "approved") {
      return NextResponse.json(
        { error: "Nhóm này chỉ cho phép \"In theo mẫu\" khi đề xuất đã được duyệt hoàn toàn." },
        { status: 403 },
      );
    }

    const template = templateId
      ? await getPrintTemplate(found.groupId, templateId)
      : await getDefaultPrintTemplate(found.groupId);
    if (!template) {
      return NextResponse.json(
        { error: "Nhóm đề xuất này chưa có mẫu in nào (hoặc chưa đặt mẫu mặc định)." },
        { status: 404 },
      );
    }

    let resultBuffer: Buffer;
    try {
      const templateBuffer = await downloadObject(template.path);
      resultBuffer = renderPrintTemplate(templateBuffer, group, found);
    } catch (renderError) {
      await logPrintExport({
        requestId: found.id,
        requestCode: found.code,
        groupId: group.id,
        templateId: template.id,
        templateVersion: template.version,
        format: "docx",
        performedBy: { uid: session.uid, name: session.name },
        performedAt: new Date().toISOString(),
        status: "failed",
        resultPath: null,
        errorMessage:
          renderError instanceof Error ? renderError.message.slice(0, 300) : "Lỗi không xác định",
      });
      return NextResponse.json(
        { error: "Không tạo được file — mẫu in có thể đang lỗi. Kiểm tra lại ở Thiết lập nhóm > In đề xuất." },
        { status: 422 },
      );
    }

    await logPrintExport({
      requestId: found.id,
      requestCode: found.code,
      groupId: group.id,
      templateId: template.id,
      templateVersion: template.version,
      format: "docx",
      performedBy: { uid: session.uid, name: session.name },
      performedAt: new Date().toISOString(),
      status: "success",
      resultPath: null,
    });

    const titlePart = resolveRequestTitle(found);
    // Định dạng dd-mm-yyyy theo đúng ví dụ đặc tả ("... - 20-07-2026").
    const datePart = new Date().toLocaleDateString("vi-VN").split("/").join("-");
    const fileName =
      sanitizeForFileName(`${found.code ?? found.id} - ${titlePart} - ${datePart}`) + ".docx";

    return new NextResponse(new Uint8Array(resultBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
