import { NextResponse } from "next/server";
import { getHpcoreDb } from "@/lib/hpcore";
import { apiErrorResponse } from "@/lib/http";
import { requireSession } from "@/lib/session";
import type { TaggedUser } from "@/lib/types";

/**
 * Danh bạ "quản lý trực tiếp" — CHỈ gồm người hiện đang là leaderId của ít
 * nhất 1 phòng ban (suy trực tiếp từ departments/{id}.leaderId, không phải
 * bảng/nhóm riêng nào). Dùng cho picker "Chọn quản lý trực tiếp" ở bước duyệt
 * submitter_manager — xem openspec/changes/improve-request-approver-ux.
 */
export async function GET() {
  try {
    await requireSession();
    const db = getHpcoreDb();
    const deptsSnap = await db.collection("departments").get();

    const namesByLeaderId = new Map<string, string[]>();
    for (const doc of deptsSnap.docs) {
      const data = doc.data() as { name?: string; leaderId?: string | null };
      if (!data.leaderId) continue;
      const list = namesByLeaderId.get(data.leaderId) ?? [];
      list.push(data.name?.trim() || "(Phòng ban không tên)");
      namesByLeaderId.set(data.leaderId, list);
    }

    const leaderIds = Array.from(namesByLeaderId.keys());
    const leaderSnaps = await Promise.all(leaderIds.map((id) => db.collection("users").doc(id).get()));

    const directory: TaggedUser[] = leaderSnaps
      .filter((snap) => snap.exists)
      .map((snap) => {
        const data = snap.data() as { fullName?: string; email?: string; username?: string | null };
        const name = data.fullName?.trim() || data.email?.split("@")[0] || snap.id;
        const deptNames = namesByLeaderId.get(snap.id) ?? [];
        return {
          id: snap.id,
          name,
          username: data.username || data.email?.split("@")[0] || snap.id,
          avatarInitial: name.charAt(0).toUpperCase(),
          title: deptNames.map((n) => `Trưởng phòng ${n}`).join(", "),
        };
      });

    return NextResponse.json({ directory });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
