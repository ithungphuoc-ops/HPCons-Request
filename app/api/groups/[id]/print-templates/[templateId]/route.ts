import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { downloadObject, putObject } from "@/lib/r2";
import { apiErrorResponse } from "@/lib/http";
import { scanTemplateVariables } from "@/lib/server/print-engine";
import {
  deletePrintTemplate,
  getPrintTemplate,
  renamePrintTemplate,
  replacePrintTemplateFile,
  setDefaultPrintTemplate,
  updatePrintTemplateValidation,
} from "@/lib/server/print-templates";
import { requireWriteAccess } from "@/lib/session";
import type { ProposalGroup } from "@/lib/types";

export const runtime = "nodejs";

const MAX_TEMPLATE_SIZE = 5 * 1024 * 1024; // 5MB

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

interface PatchBody {
  name?: string;
  setDefault?: boolean;
  /** Quét lại biến/lỗi của file HIỆN CÓ theo field mới nhất của nhóm — dùng
   * khi field bị đổi kiểu dữ liệu/xoá sau khi mẫu in đã dùng biến đó, vì
   * việc đó không tự động quét lại (xem lib/server/print-templates.ts). */
  rescan?: boolean;
}

/** Đổi tên mẫu và/hoặc đặt làm mặc định. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    await requireWriteAccess();
    const { id, templateId } = await params;
    const body = (await request.json()) as PatchBody;

    const existing = await getPrintTemplate(id, templateId);
    if (!existing) {
      return NextResponse.json({ error: "Không tìm thấy mẫu in." }, { status: 404 });
    }

    if (typeof body.name === "string" && body.name.trim()) {
      await renamePrintTemplate(id, templateId, body.name.trim());
    }
    if (body.rescan) {
      const groupSnap = await adminDb.collection("groups").doc(id).get();
      if (!groupSnap.exists) {
        return NextResponse.json({ error: "Không tìm thấy nhóm đề xuất." }, { status: 404 });
      }
      const group = { id: groupSnap.id, ...groupSnap.data() } as ProposalGroup;
      const buffer = await downloadObject(existing.path);
      const scan = scanTemplateVariables(buffer, group);
      await updatePrintTemplateValidation(id, templateId, {
        detectedVariables: scan.detectedVariables,
        validation: { errors: scan.errors, warnings: scan.warnings },
      });
    }
    if (body.setDefault) {
      if (existing.validation.errors.length > 0) {
        return NextResponse.json(
          { error: "Không thể đặt làm mặc định — mẫu này còn lỗi nghiêm trọng, sửa file mẫu rồi thử lại." },
          { status: 400 },
        );
      }
      await setDefaultPrintTemplate(id, templateId);
    }

    const updated = await getPrintTemplate(id, templateId);
    return NextResponse.json({ template: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Thay file .docx của mẫu đã có — giữ nguyên id/tên/mặc định, tăng version. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    await requireWriteAccess();
    const { id, templateId } = await params;

    const existing = await getPrintTemplate(id, templateId);
    if (!existing) {
      return NextResponse.json({ error: "Không tìm thấy mẫu in." }, { status: 404 });
    }
    const groupSnap = await adminDb.collection("groups").doc(id).get();
    if (!groupSnap.exists) {
      return NextResponse.json({ error: "Không tìm thấy nhóm đề xuất." }, { status: 404 });
    }
    const group = { id: groupSnap.id, ...groupSnap.data() } as ProposalGroup;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Chưa chọn tệp mẫu in." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json({ error: "Chỉ nhận file Word (.docx)." }, { status: 400 });
    }
    if (file.size > MAX_TEMPLATE_SIZE) {
      return NextResponse.json({ error: "File mẫu in vượt quá 5MB." }, { status: 400 });
    }

    const path = `print-templates/${id}/${Date.now()}-${sanitizeFileName(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      await putObject(path, buffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    } catch {
      return NextResponse.json(
        { error: "Không đọc được file — có thể file bị hỏng hoặc không phải .docx hợp lệ." },
        { status: 400 },
      );
    }

    const scan = scanTemplateVariables(buffer, group);
    const template = await replacePrintTemplateFile(id, templateId, {
      fileName: file.name,
      path,
      detectedVariables: scan.detectedVariables,
      validation: { errors: scan.errors, warnings: scan.warnings },
    });

    return NextResponse.json({ template });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; templateId: string }> },
) {
  try {
    await requireWriteAccess();
    const { id, templateId } = await params;
    await deletePrintTemplate(id, templateId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
