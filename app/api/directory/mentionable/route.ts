import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { listMentionableEntries } from "@/lib/server/mentions";
import { requireSession } from "@/lib/session";

/**
 * Danh sách người + phòng ban (App Tổng) để @mention trong bình luận —
 * route RIÊNG, không sửa `/api/directory` hiện có (giữ nguyên chỉ-người cho
 * usedFor/approverSteps/followers).
 */
export async function GET() {
  try {
    await requireSession();
    const directory = await listMentionableEntries();
    return NextResponse.json({ directory });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
