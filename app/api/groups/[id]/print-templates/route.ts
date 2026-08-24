import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { putObject } from "@/lib/r2";
import { apiErrorResponse } from "@/lib/http";
import { scanTemplateVariables } from "@/lib/server/print-engine";
import { createPrintTemplate, listPrintTemplates } from "@/lib/server/print-templates";
import { requireSession, requireWriteAccess } from "@/lib/session";
import type { GroupPermissionRules, GroupPrintOptions, ProposalGroup } from "@/lib/types";

export const runtime = "nodejs";

const MAX_TEMPLATE_SIZE = 5 * 1024 * 1024; // 5MB

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Danh sách mẫu in của 1 nhóm — dùng cho trang cài đặt VÀ hộp thoại "In theo
 * mẫu". Trả kèm `printOptions` (nếu có) để trang chi tiết đề xuất tự ẩn/hiện
 * dropdown "In theo mẫu" theo cờ `allowPrintToWord` — gộp vào response này
 * (không tạo route riêng) vì cùng phục vụ đúng 1 khu vực UI. Trả kèm luôn
 * `permissionRules` (thêm 24/08/2026) vì `RequestDetailView.tsx` đã gọi sẵn
 * route này lúc mount — dùng lại đúng chỗ để biết `approversCanDelegateApproval`
 * (ẩn/hiện tuỳ chọn "Chuyển tiếp và Duyệt" trong `ForwardModal`), không thêm
 * round-trip mới. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const [templates, groupSnap] = await Promise.all([
      listPrintTemplates(id),
      adminDb.collection("groups").doc(id).get(),
    ]);
    const groupData = groupSnap.data() as
      | { printOptions?: GroupPrintOptions; permissionRules?: GroupPermissionRules }
      | undefined;
    return NextResponse.json({
      templates,
      printOptions: groupData?.printOptions,
      permissionRules: groupData?.permissionRules,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Tải mẫu in (.docx) mới lên cho 1 nhóm — quét biến thật ngay khi tải lên. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;

    const groupSnap = await adminDb.collection("groups").doc(id).get();
    if (!groupSnap.exists) {
      return NextResponse.json({ error: "Không tìm thấy nhóm đề xuất." }, { status: 404 });
    }
    const group = { id: groupSnap.id, ...groupSnap.data() } as ProposalGroup;

    const formData = await request.formData();
    const file = formData.get("file");
    const name = (formData.get("name") as string | null)?.trim();
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

    const template = await createPrintTemplate(id, {
      name: name || file.name.replace(/\.docx$/i, ""),
      fileName: file.name,
      path,
      createdBy: { uid: session.uid, name: session.name },
      detectedVariables: scan.detectedVariables,
      validation: { errors: scan.errors, warnings: scan.warnings },
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
