import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { canManageGroupsAtAppScope } from "@/lib/permissions";
import { isAdjustmentReviewer } from "@/lib/adjustment-settings";
import { requireSession } from "@/lib/session";
import type { RequestInstance } from "@/lib/types";

/**
 * Tìm kiếm/lọc đề xuất, tôn trọng phạm vi quyền xem — thành viên thường chỉ
 * thấy đề xuất họ tạo/được giao duyệt/đang theo dõi, owner/app_admin thấy
 * toàn bộ. Đợt này quét toàn collection rồi lọc trong bộ nhớ (quy mô công ty
 * nội bộ, chưa cần composite index) — xem design.md nếu cần tối ưu sau.
 */
export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const groupId = url.searchParams.get("groupId");
    const creator = url.searchParams.get("creator");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const snap = await adminDb.collection("requests").orderBy("submittedAt", "desc").get();
    let requests = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as RequestInstance)
      .filter((r) => r.status !== "draft");

    if (!canManageGroupsAtAppScope(session.role)) {
      requests = requests.filter(
        (r) =>
          r.submittedBy.uid === session.uid ||
          r.approversSnapshot.some((a) => a.id === session.uid) ||
          r.followers.some((f) => f.id === session.uid) ||
          isAdjustmentReviewer(r, session.uid),
      );
    }

    if (status) requests = requests.filter((r) => r.status === status);
    if (groupId) requests = requests.filter((r) => r.groupId === groupId);
    if (creator) requests = requests.filter((r) => r.submittedBy.uid === creator);
    if (from) requests = requests.filter((r) => r.submittedAt >= from);
    if (to) requests = requests.filter((r) => r.submittedAt <= to);

    return NextResponse.json({ requests });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
