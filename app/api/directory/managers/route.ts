import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getHpcoreDb } from "@/lib/hpcore";
import { apiErrorResponse } from "@/lib/http";
import { requireSession } from "@/lib/session";
import type { TaggedUser } from "@/lib/types";

/**
 * Danh bạ "quản lý trực tiếp" — CHỈ gồm người hiện đang là `managerId` của ít
 * nhất 1 "Nhóm thành viên" (collection memberGroups ở app tổng, quản trị tại
 * account.hpcore.vn/dashboard/member-groups) — KHÔNG còn dùng
 * departments/{id}.leaderId nữa (đổi theo yêu cầu Sếp, 29/07/2026: nguồn
 * "quản lý trực tiếp" lấy từ Nhóm thành viên, không phải đơn vị org-chart).
 * Dùng cho picker "Chọn quản lý trực tiếp" ở bước duyệt submitter_manager —
 * xem openspec/changes/improve-request-approver-ux.
 *
 * Cache 60 giây (thêm 21/08/2026) — mỗi lần picker mở là 1 lượt đọc toàn bộ
 * memberGroups + 1 lượt đọc riêng cho MỖI quản lý (N+1), không có Timestamp
 * nên an toàn cache trực tiếp.
 */
const getCachedManagerDirectory = unstable_cache(
  async (): Promise<TaggedUser[]> => {
    const db = getHpcoreDb();
    const groupsSnap = await db.collection("memberGroups").get();

    const groupNamesByManagerId = new Map<string, string[]>();
    for (const doc of groupsSnap.docs) {
      const data = doc.data() as { name?: string; managerId?: string | null };
      if (!data.managerId) continue;
      const list = groupNamesByManagerId.get(data.managerId) ?? [];
      list.push(data.name?.trim() || "(Nhóm không tên)");
      groupNamesByManagerId.set(data.managerId, list);
    }

    const managerIds = Array.from(groupNamesByManagerId.keys());
    const managerSnaps = await Promise.all(managerIds.map((id) => db.collection("users").doc(id).get()));

    return managerSnaps
      .filter((snap) => snap.exists)
      .map((snap) => {
        const data = snap.data() as { fullName?: string; email?: string; username?: string | null };
        const name = data.fullName?.trim() || data.email?.split("@")[0] || snap.id;
        const groupNames = groupNamesByManagerId.get(snap.id) ?? [];
        return {
          id: snap.id,
          name,
          username: data.username || data.email?.split("@")[0] || snap.id,
          avatarInitial: name.charAt(0).toUpperCase(),
          title: groupNames.map((n) => `Quản lý nhóm "${n}"`).join(", "),
        };
      });
  },
  ["request-manager-directory"],
  { revalidate: 60 },
);

export async function GET() {
  try {
    await requireSession();
    const directory = await getCachedManagerDirectory();
    return NextResponse.json({ directory });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
