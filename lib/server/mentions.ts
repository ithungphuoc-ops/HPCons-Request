import "server-only";
import { unstable_cache } from "next/cache";
import { getHpcoreDb } from "@/lib/hpcore";
import { getCachedDepartments } from "@/lib/server/hpcore-org";
import { collectDescendantIds } from "@/lib/used-for-scope";
import type { TaggedUser } from "@/lib/types";

export type MentionableKind = "user" | "group";

export interface MentionableEntry extends TaggedUser {
  kind: MentionableKind;
}

/**
 * Danh sách người + phòng ban để @mention trong bình luận — đọc trực tiếp từ
 * Firestore hpcore (cùng nguồn `/api/directory` đang dùng cho users, thêm
 * departments). Từ 03/10/2026 BỎ HẲN "Nhóm thành viên" (memberGroups) — Sếp
 * duyệt demo bo-nhom-thanh-vien-pham-vi-nhom; @nhóm chỉ còn là phòng ban.
 * Dùng RIÊNG cho mention bình luận — KHÔNG dùng để mở rộng
 * approverSteps/followers (những chỗ đó vẫn chỉ nhận cá nhân).
 *
 * Cache 60 giây (thêm 21/08/2026) — đọc toàn bộ mỗi lần ô @mention hiện ra,
 * không có field Timestamp nên an toàn cache trực tiếp.
 */
export const listMentionableEntries = unstable_cache(
  async (): Promise<MentionableEntry[]> => {
  const db = getHpcoreDb();
  const [usersSnap, deptList] = await Promise.all([
    db.collection("users").where("isActive", "==", true).get(),
    getCachedDepartments(),
  ]);

  const users: MentionableEntry[] = usersSnap.docs.map((doc) => {
    const data = doc.data() as { fullName?: string; email?: string; username?: string | null };
    const name = data.fullName?.trim() || data.email?.split("@")[0] || doc.id;
    // Ưu tiên username ngắn kiểu "phucBM" (sinh ở hpcons-portal, xem
    // lib/username.ts bên đó, 28/07/2026) — người tạo trước khi có tính năng
    // này chưa có field này, fallback về phần trước "@" của email như cũ.
    return {
      kind: "user",
      id: doc.id,
      name,
      username: data.username || data.email?.split("@")[0] || doc.id,
      avatarInitial: name.charAt(0).toUpperCase(),
    };
  });

  const departments: MentionableEntry[] = deptList.map((dept) => {
    const name = dept.name;
    return {
      kind: "group",
      id: dept.id,
      name,
      username: name.toLowerCase().replace(/\s+/g, "-"),
      avatarInitial: name.charAt(0).toUpperCase(),
    };
  });

  return [...users, ...departments];
  },
  ["mentionable-entries"],
  { revalidate: 60 },
);

/**
 * Giãn `mentionIds` (uid người HOẶC id phòng ban) thành tập hợp uid người
 * thật — tra `users` trước; không phải người thì coi là phòng ban: gồm người
 * có ĐƠN VỊ CHÍNH hoặc KIÊM NHIỆM (secondaryDepartmentIds) ở phòng ban đó
 * hoặc ở bất kỳ nhóm con nào của nó (theo parentId). Id không tồn tại (vd id
 * "Nhóm thành viên" cũ trong bình luận cũ) → rỗng, không lỗi. Loại trùng +
 * loại trừ `excludeUid` (người vừa viết bình luận, tránh tự báo cho chính
 * mình — xem design.md Open Questions).
 */
export async function expandMentionsToUids(
  mentionIds: string[],
  excludeUid: string,
): Promise<string[]> {
  if (mentionIds.length === 0) return [];
  const db = getHpcoreDb();
  const result = new Set<string>();
  let departments: Awaited<ReturnType<typeof getCachedDepartments>> | null = null;

  for (const id of mentionIds) {
    const userDoc = await db.collection("users").doc(id).get();
    if (userDoc.exists) {
      result.add(id);
      continue;
    }

    departments ??= await getCachedDepartments();
    if (!departments.some((d) => d.id === id)) continue;
    const deptIds = [id, ...collectDescendantIds([id], departments)];
    // Firestore giới hạn "in"/"array-contains-any" 30 giá trị — chia lô.
    for (let i = 0; i < deptIds.length; i += 30) {
      const chunk = deptIds.slice(i, i + 30);
      const [mainSnap, secondarySnap] = await Promise.all([
        db.collection("users").where("departmentId", "in", chunk).get(),
        db.collection("users").where("secondaryDepartmentIds", "array-contains-any", chunk).get(),
      ]);
      // Bỏ tài khoản đã khoá (isActive: false) — khớp danh sách gợi ý chỉ có
      // người đang hoạt động; hồ sơ thiếu field vẫn tính như trước.
      for (const d of [...mainSnap.docs, ...secondarySnap.docs]) {
        if (d.data().isActive !== false) result.add(d.id);
      }
    }
  }

  result.delete(excludeUid);
  return Array.from(result);
}
