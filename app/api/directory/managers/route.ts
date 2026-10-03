import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { prioritizeDirectManagers, readDirectManagerIds } from "@/lib/direct-manager";
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
 * Từ 03/10/2026 (change quan-ly-truc-tiep): người trong
 * users/{uid}.directManagerIds của chính người đang mở picker được đưa lên ĐẦU
 * danh sách — xem getCachedOwnDirectManagers bên dưới.
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

/**
 * Người trong `users/{uid}.directManagerIds` (quản lý trực tiếp gán tay ở hồ
 * sơ App Tổng, hợp đồng 03/10/2026) của CHÍNH người đang mở picker — đưa lên
 * đầu danh sách. Cache 60 giây KHOÁ THEO UID (unstable_cache gộp đối số `uid`
 * vào khoá cache), không bao giờ trả danh sách của người này cho người khác.
 */
const getCachedOwnDirectManagers = unstable_cache(
  async (uid: string): Promise<{ ids: string[]; users: TaggedUser[] }> => {
    const db = getHpcoreDb();
    const meSnap = await db.collection("users").doc(uid).get();
    const ids = readDirectManagerIds(meSnap.data()).filter((id) => id !== uid);
    if (ids.length === 0) return { ids: [], users: [] };
    const snaps = await Promise.all(ids.map((id) => db.collection("users").doc(id).get()));
    const users = snaps
      .filter((snap) => snap.exists)
      .map((snap) => {
        const data = snap.data() as { fullName?: string; email?: string; username?: string | null };
        const name = data.fullName?.trim() || data.email?.split("@")[0] || snap.id;
        return {
          id: snap.id,
          name,
          username: data.username || data.email?.split("@")[0] || snap.id,
          avatarInitial: name.charAt(0).toUpperCase(),
        };
      });
    return { ids, users };
  },
  ["request-own-direct-managers"],
  { revalidate: 60 },
);

export async function GET() {
  try {
    const session = await requireSession();
    const [base, own] = await Promise.all([
      getCachedManagerDirectory(),
      getCachedOwnDirectManagers(session.uid),
    ]);
    // Giữ nguồn memberGroups như cũ, chỉ đưa người trong directManagerIds lên
    // đầu (đúng thứ tự). Người đã có trong danh sách gốc vẫn giữ chức danh
    // "Quản lý nhóm ..." và thêm nhãn "Quản lý trực tiếp".
    const ownIds = new Set(own.ids);
    const extra = own.users.map((u) => ({ ...u, title: "Quản lý trực tiếp" }));
    const directory = prioritizeDirectManagers(base, own.ids, extra).map((u) =>
      ownIds.has(u.id) && u.title !== "Quản lý trực tiếp"
        ? { ...u, title: u.title ? `Quản lý trực tiếp · ${u.title}` : "Quản lý trực tiếp" }
        : u,
    );
    return NextResponse.json({ directory });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
