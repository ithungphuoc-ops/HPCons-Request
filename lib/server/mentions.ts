import "server-only";
import { unstable_cache } from "next/cache";
import { getHpcoreDb } from "@/lib/hpcore";
import type { TaggedUser } from "@/lib/types";

export type MentionableKind = "user" | "group";

export interface MentionableEntry extends TaggedUser {
  kind: MentionableKind;
}

/**
 * Danh sách người + nhóm thành viên/phòng ban để @mention trong bình luận —
 * đọc trực tiếp từ Firestore hpcore (cùng nguồn `/api/directory` đang dùng
 * cho users, mở rộng thêm memberGroups + departments). Dùng RIÊNG cho mention
 * bình luận — KHÔNG dùng để mở rộng usedFor/approverSteps/followers (những
 * chỗ đó vẫn chỉ nhận cá nhân qua /api/directory hiện có).
 *
 * Cache 60 giây (thêm 21/08/2026) — đọc 3 collection toàn bộ mỗi lần ô @mention
 * hiện ra, không có field Timestamp nên an toàn cache trực tiếp.
 */
export const listMentionableEntries = unstable_cache(
  async (): Promise<MentionableEntry[]> => {
  const db = getHpcoreDb();
  const [usersSnap, groupsSnap, deptsSnap] = await Promise.all([
    db.collection("users").where("isActive", "==", true).get(),
    db.collection("memberGroups").get(),
    db.collection("departments").get(),
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

  const groups: MentionableEntry[] = groupsSnap.docs.map((doc) => {
    const data = doc.data() as { name?: string };
    const name = data.name?.trim() || "(Nhóm không tên)";
    return {
      kind: "group",
      id: doc.id,
      name,
      username: name.toLowerCase().replace(/\s+/g, "-"),
      avatarInitial: name.charAt(0).toUpperCase(),
    };
  });

  const departments: MentionableEntry[] = deptsSnap.docs.map((doc) => {
    const data = doc.data() as { name?: string };
    const name = data.name?.trim() || "(Phòng ban không tên)";
    return {
      kind: "group",
      id: doc.id,
      name,
      username: name.toLowerCase().replace(/\s+/g, "-"),
      avatarInitial: name.charAt(0).toUpperCase(),
    };
  });

  return [...users, ...groups, ...departments];
  },
  ["mentionable-entries"],
  { revalidate: 60 },
);

/**
 * Giãn `mentionIds` (uid người HOẶC id nhóm thành viên/phòng ban) thành tập
 * hợp uid người thật — tra `users` trước, không thấy thì `memberGroups`
 * (memberIds), không thấy nữa thì `departments` (users.departmentId == id).
 * Loại trùng + loại trừ `excludeUid` (người vừa viết bình luận, tránh tự báo
 * cho chính mình — xem design.md Open Questions).
 */
export async function expandMentionsToUids(
  mentionIds: string[],
  excludeUid: string,
): Promise<string[]> {
  if (mentionIds.length === 0) return [];
  const db = getHpcoreDb();
  const result = new Set<string>();

  for (const id of mentionIds) {
    const userDoc = await db.collection("users").doc(id).get();
    if (userDoc.exists) {
      result.add(id);
      continue;
    }

    const groupDoc = await db.collection("memberGroups").doc(id).get();
    if (groupDoc.exists) {
      const memberIds = (groupDoc.data()?.memberIds as string[] | undefined) ?? [];
      memberIds.forEach((uid) => result.add(uid));
      continue;
    }

    const deptUsers = await db.collection("users").where("departmentId", "==", id).get();
    deptUsers.docs.forEach((d) => result.add(d.id));
  }

  result.delete(excludeUid);
  return Array.from(result);
}
