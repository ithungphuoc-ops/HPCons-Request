import "server-only";
import { unstable_cache } from "next/cache";
import { getHpcoreDb } from "@/lib/hpcore";
import {
  buildScopeMembership,
  isInUsedForScope,
  usedForNeedsMembership,
  type ScopeMembership,
} from "@/lib/used-for-scope";
import type { ProposalGroup } from "@/lib/types";

/**
 * Cơ cấu tổ chức đọc từ App Tổng (project hpcons-portal) — NGUỒN DUY NHẤT
 * cho "nhóm" trong app Đề xuất từ 03/10/2026 (bỏ hẳn "Nhóm thành viên"
 * memberGroups, Sếp duyệt demo bo-nhom-thanh-vien-pham-vi-nhom-2026-10-03).
 */
export interface OrgDepartment {
  id: string;
  name: string;
  parentId: string | null;
  leaderId: string | null;
}

/**
 * Toàn bộ departments (~20 document) — cache 60 giây dùng chung mọi người
 * (không phụ thuộc người xem, không có Timestamp nên an toàn cache).
 */
export const getCachedDepartments = unstable_cache(
  async (): Promise<OrgDepartment[]> => {
    const snap = await getHpcoreDb().collection("departments").get();
    return snap.docs
      .map((doc) => {
        const data = doc.data() as { name?: string; parentId?: unknown; leaderId?: unknown };
        return {
          id: doc.id,
          name: data.name?.trim() || "(Phòng ban không tên)",
          parentId: typeof data.parentId === "string" && data.parentId ? data.parentId : null,
          leaderId: typeof data.leaderId === "string" && data.leaderId ? data.leaderId : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  },
  ["hpcore-departments"],
  { revalidate: 60 },
);

/**
 * Thành viên nhóm của 1 người (đơn vị chính + kiêm nhiệm, đã gồm nhóm cha).
 * Cache 60 giây KHOÁ THEO UID (unstable_cache gộp đối số `uid` vào khoá) —
 * không bao giờ trả kết quả của người này cho người khác.
 */
const getCachedScopeMembership = unstable_cache(
  async (uid: string): Promise<ScopeMembership> => {
    const [userSnap, departments] = await Promise.all([
      getHpcoreDb().collection("users").doc(uid).get(),
      getCachedDepartments(),
    ]);
    const parentById = new Map(departments.map((d) => [d.id, d.parentId]));
    return buildScopeMembership(uid, userSnap.exists ? userSnap.data() : null, (id) => parentById.get(id));
  },
  ["request-scope-membership"],
  { revalidate: 60 },
);

export async function getScopeMembership(uid: string): Promise<ScopeMembership> {
  return getCachedScopeMembership(uid);
}

/**
 * Người dùng có được TẠO đề xuất ở loại này không (phạm vi sử dụng). Chỉ đọc
 * hồ sơ App Tổng khi usedFor thật sự có chọn nhóm — loại đề xuất toàn công
 * ty hoặc chỉ có người lẻ không tốn thêm lượt đọc nào.
 */
export async function isUserInGroupScope(
  group: Pick<ProposalGroup, "usedFor" | "usedForIncludeSecondary">,
  uid: string,
): Promise<boolean> {
  const usedFor = group.usedFor ?? [];
  if (!usedForNeedsMembership(usedFor)) return isInUsedForScope({ ...group, usedFor }, uid, null);
  const membership = await getScopeMembership(uid);
  return isInUsedForScope({ ...group, usedFor }, uid, membership);
}

/**
 * Bộ kiểm phạm vi cho NHIỀU loại đề xuất của cùng 1 người trong 1 lượt gọi
 * (danh sách nhóm, cài đặt email) — đọc hồ sơ App Tổng tối đa 1 lần.
 */
export function createScopeChecker(
  uid: string,
): (group: Pick<ProposalGroup, "usedFor" | "usedForIncludeSecondary">) => Promise<boolean> {
  let membership: Promise<ScopeMembership> | null = null;
  return async (group) => {
    const usedFor = group.usedFor ?? [];
    if (!usedForNeedsMembership(usedFor)) return isInUsedForScope({ ...group, usedFor }, uid, null);
    membership ??= getScopeMembership(uid);
    return isInUsedForScope({ ...group, usedFor }, uid, await membership);
  };
}

export const OUT_OF_SCOPE_MESSAGE = "Bạn không nằm trong phạm vi sử dụng của nhóm đề xuất này.";
