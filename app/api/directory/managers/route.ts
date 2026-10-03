import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { prioritizeDirectManagers, readDirectManagerIds } from "@/lib/direct-manager";
import { getHpcoreDb } from "@/lib/hpcore";
import { getCachedDepartments } from "@/lib/server/hpcore-org";
import { apiErrorResponse } from "@/lib/http";
import { requireSession } from "@/lib/session";
import type { TaggedUser } from "@/lib/types";

/**
 * Danh bạ "quản lý trực tiếp" cho picker "Chọn quản lý trực tiếp" ở bước
 * duyệt submitter_manager — xem openspec/changes/improve-request-approver-ux.
 *
 * Từ 03/10/2026 (Sếp duyệt demo bo-nhom-thanh-vien-pham-vi-nhom): BỎ HẲN
 * nguồn "Nhóm thành viên" (memberGroups). Danh sách gốc = các TRƯỞNG ĐƠN VỊ
 * (departments/{id}.leaderId) của App Tổng, chức danh "Trưởng đơn vị <tên>"
 * (1 người làm trưởng nhiều đơn vị → nối các chức danh). Người trong
 * users/{uid}.directManagerIds của chính người đang mở picker được đưa lên
 * ĐẦU — xem getCachedOwnDirectManagers bên dưới. Gõ @ vẫn tìm được BẤT KỲ ai
 * (browseAllDirectoryUrl ở submit/page.tsx dùng /api/directory).
 *
 * Cache 60 giây — 1 lượt đọc departments (dùng chung cache) + 1 lượt đọc
 * riêng cho MỖI trưởng đơn vị, không có Timestamp nên an toàn cache.
 */
const getCachedManagerDirectory = unstable_cache(
  async (): Promise<TaggedUser[]> => {
    const db = getHpcoreDb();
    const departments = await getCachedDepartments();

    const deptNamesByLeaderId = new Map<string, string[]>();
    for (const dept of departments) {
      if (!dept.leaderId) continue;
      const list = deptNamesByLeaderId.get(dept.leaderId) ?? [];
      list.push(dept.name);
      deptNamesByLeaderId.set(dept.leaderId, list);
    }

    const leaderIds = Array.from(deptNamesByLeaderId.keys());
    const leaderSnaps = await Promise.all(leaderIds.map((id) => db.collection("users").doc(id).get()));

    return leaderSnaps
      .filter((snap) => snap.exists && snap.data()?.isActive !== false)
      .map((snap) => {
        const data = snap.data() as { fullName?: string; email?: string; username?: string | null };
        const name = data.fullName?.trim() || data.email?.split("@")[0] || snap.id;
        const deptNames = deptNamesByLeaderId.get(snap.id) ?? [];
        return {
          id: snap.id,
          name,
          username: data.username || data.email?.split("@")[0] || snap.id,
          avatarInitial: name.charAt(0).toUpperCase(),
          title: deptNames.map((n) => `Trưởng đơn vị ${n}`).join(", "),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  },
  ["request-manager-directory-departments"],
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
    // Đưa người trong directManagerIds lên đầu (đúng thứ tự). Người đã có
    // trong danh sách gốc vẫn giữ chức danh "Trưởng đơn vị ..." và thêm nhãn
    // "Quản lý trực tiếp".
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
