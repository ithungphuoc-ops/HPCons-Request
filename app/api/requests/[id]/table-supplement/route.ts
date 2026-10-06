import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { planTableSupplement, type TableSupplementInput } from "@/lib/server/request-supplement";
import { RequestTxError } from "@/lib/server/request-write-guard";
import { requireSession } from "@/lib/session";
import type { RequestInstance } from "@/lib/types";

/**
 * Nối thêm dòng vào field kiểu "table"/"base_table" của 1 đề xuất ĐÃ DUYỆT —
 * tách hẳn khỏi `PATCH /api/requests/[id]` (route đó giữ nguyên chặn tuyệt
 * đối sửa `values` khi đã duyệt). Route này CHỈ cho nối thêm dòng, không có
 * đường nào để sửa/xoá dòng đã có — xem design.md của change
 * add-post-approval-supplement, Decision 1.
 *
 * 06/10/2026 (làm tiếp sau PR #82): đọc–kiểm–ghi trong transaction (không gọi
 * mạng nào nên cả route nằm gọn trong tx) — trước đây đọc ngoài rồi ghi đè cả
 * `values`/`fieldsSnapshot`/`history` từ bản đọc cũ, 2 lần bổ sung song song
 * hoặc dòng "Đã đồng bộ…" của hàng chờ có thể bị mất. Dòng lịch sử NỐI bằng
 * arrayUnion. Đề xuất đã xoá mềm → 409. Logic tính ở planTableSupplement().
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = ((await request.json().catch(() => null)) ?? {}) as Partial<TableSupplementInput>;
    const input: TableSupplementInput = {
      fieldId: body.fieldId,
      newRows: body.newRows,
      newColumns: body.newColumns,
    };

    // KHÔNG cập nhật `updatedAt` — giống hành vi route attachments khi đính
    // file, field này chỉ dành cho các mốc "sửa nháp/gửi/quyết định duyệt"
    // (xem comment tại RequestInstance.updatedAt, lib/types.ts).
    const ref = adminDb.collection("requests").doc(id);
    const updated = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new RequestTxError(404, "Không tìm thấy đề xuất.");
      const latest = { id: snap.id, ...snap.data() } as RequestInstance;
      const plan = planTableSupplement(latest, input, { uid: session.uid, name: session.name }, new Date().toISOString());
      if (!plan.ok) throw new RequestTxError(plan.status, plan.error);
      tx.update(ref, { ...plan.patch, history: FieldValue.arrayUnion(plan.historyEntry) });
      return plan.updated;
    });

    return NextResponse.json({ request: updated });
  } catch (error) {
    if (error instanceof RequestTxError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return apiErrorResponse(error);
  }
}
