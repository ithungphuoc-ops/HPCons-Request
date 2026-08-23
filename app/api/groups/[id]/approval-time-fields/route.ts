import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireSession } from "@/lib/session";
import type { ApprovalTimeField } from "@/lib/types";

/**
 * "Mẫu form phê duyệt" của 1 nhóm — đọc LIVE (không snapshot vào đề xuất),
 * dùng cho hộp thoại quyết định ở trang chi tiết đề xuất (chỉ người duyệt
 * bước `fixed` khớp mới thấy field tương ứng, xem RequestDetailView.tsx) và
 * trang cài đặt nhóm. Cùng pattern quyền với print-templates (chỉ cần đăng
 * nhập, không cần Owner/Admin — ai xem được đề xuất cũng cần đọc được cấu
 * hình này để hộp thoại quyết định hiện đúng field).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const snap = await adminDb.collection("groups").doc(id).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Không tìm thấy nhóm đề xuất." }, { status: 404 });
    }
    const fields = (snap.data()?.approvalTimeFields as ApprovalTimeField[] | undefined) ?? [];
    return NextResponse.json({ fields });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
