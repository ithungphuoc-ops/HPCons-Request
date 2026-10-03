/**
 * Luật "Phạm vi sử dụng" theo NHÓM (phòng ban App Tổng) — Sếp duyệt demo
 * tong-quan-demo/HPCons-portal/bo-nhom-thanh-vien-pham-vi-nhom-2026-10-03.
 * Hàm THUẦN (không import Firestore) để kiểm bằng dữ liệu giả trong bộ nhớ
 * (lib/used-for-scope.test.ts).
 *
 * - `usedFor` rỗng = toàn công ty (giữ nguyên như trước).
 * - Phần tử `kind: "group"` → `id` = departments/{id} của App Tổng. Chọn nhóm
 *   cha = GỒM mọi nhóm con: người dùng thuộc phạm vi nếu ĐƠN VỊ CHÍNH của họ
 *   là nhóm đã chọn HOẶC nằm dưới nhóm đã chọn (theo parentId).
 * - Người KIÊM NHIỆM (users.secondaryDepartmentIds) được tính mặc định; tắt
 *   riêng từng loại đề xuất bằng `usedForIncludeSecondary: false`.
 * - Phần tử còn lại (không có `kind`, hoặc `kind: "user"`) = người lẻ, so
 *   theo uid — dữ liệu cũ chỉ có người vẫn chạy y như trước.
 */
import type { ProposalGroup, TaggedUser } from "./types";

/** Số bậc tối đa khi đi lên nhóm cha — chặn treo nếu dữ liệu lỡ có vòng lặp. */
export const MAX_SCOPE_PARENT_HOPS = 10;

/** Thành viên nhóm của 1 người, tính sẵn ở máy chủ (xem lib/server/scope-membership.ts). */
export interface ScopeMembership {
  userId: string;
  /** Đơn vị chính + mọi nhóm cha của nó. */
  primaryGroupIds: string[];
  /** Mỗi đơn vị kiêm nhiệm + mọi nhóm cha của nó (không gồm primaryGroupIds). */
  secondaryGroupIds: string[];
}

export interface ScopeUserDoc {
  departmentId?: unknown;
  secondaryDepartmentIds?: unknown;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Nhóm `startId` + mọi nhóm cha (theo `parentOf`), tối đa
 * MAX_SCOPE_PARENT_HOPS bậc, dừng khi gặp lại nhóm đã đi qua (vòng lặp).
 * `parentOf` trả `undefined` = nhóm không tồn tại → vẫn giữ chính nó (id cũ
 * đã xoá không làm lỗi, chỉ không khớp được nhóm cha nào).
 */
export function collectGroupAndAncestors(
  startId: string,
  parentOf: (id: string) => string | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let current: string | null = startId;
  for (let hop = 0; hop <= MAX_SCOPE_PARENT_HOPS && current && !seen.has(current); hop++) {
    seen.add(current);
    out.push(current);
    current = asNonEmptyString(parentOf(current));
  }
  return out;
}

/** Tính ScopeMembership từ hồ sơ users/{uid} + bảng parentId của departments. */
export function buildScopeMembership(
  userId: string,
  user: ScopeUserDoc | null | undefined,
  parentOf: (id: string) => string | null | undefined,
): ScopeMembership {
  const primary = asNonEmptyString(user?.departmentId);
  const primaryGroupIds = primary ? collectGroupAndAncestors(primary, parentOf) : [];
  const primarySet = new Set(primaryGroupIds);

  const rawSecondary = Array.isArray(user?.secondaryDepartmentIds) ? user.secondaryDepartmentIds : [];
  const secondary = new Set<string>();
  for (const raw of rawSecondary) {
    const id = asNonEmptyString(raw);
    if (!id) continue;
    for (const g of collectGroupAndAncestors(id, parentOf)) {
      if (!primarySet.has(g)) secondary.add(g);
    }
  }
  return { userId, primaryGroupIds, secondaryGroupIds: Array.from(secondary) };
}

export function isGroupScopeEntry(entry: Pick<TaggedUser, "kind">): boolean {
  return entry.kind === "group";
}

/** Thiếu field = true (mặc định tính người kiêm nhiệm). */
export function includesSecondary(group: Pick<ProposalGroup, "usedForIncludeSecondary">): boolean {
  return group.usedForIncludeSecondary !== false;
}

/**
 * Người dùng có nằm trong "Phạm vi sử dụng" của loại đề xuất không.
 * `membership` chỉ cần khi usedFor có phần tử nhóm — để trống cũng được
 * (coi như không thuộc nhóm nào).
 */
export function isInUsedForScope(
  group: Pick<ProposalGroup, "usedFor" | "usedForIncludeSecondary">,
  userId: string,
  membership?: Pick<ScopeMembership, "primaryGroupIds" | "secondaryGroupIds"> | null,
): boolean {
  const usedFor = group.usedFor ?? [];
  if (usedFor.length === 0) return true;

  const scopeGroupIds = new Set<string>();
  for (const entry of usedFor) {
    if (isGroupScopeEntry(entry)) scopeGroupIds.add(entry.id);
    else if (entry.id === userId) return true;
  }
  if (scopeGroupIds.size === 0 || !membership) return false;

  if (membership.primaryGroupIds.some((id) => scopeGroupIds.has(id))) return true;
  if (includesSecondary(group) && membership.secondaryGroupIds.some((id) => scopeGroupIds.has(id))) {
    return true;
  }
  return false;
}

/** usedFor có phần tử nhóm không — không có thì khỏi đọc hồ sơ App Tổng. */
export function usedForNeedsMembership(usedFor: TaggedUser[] | undefined): boolean {
  return (usedFor ?? []).some(isGroupScopeEntry);
}

/**
 * Danh sách id nhóm "đã gồm" (con cháu của nhóm đang chọn, không tính chính
 * nó) — dùng ở giao diện chọn phạm vi để khoá ô nhóm con.
 */
export function collectDescendantIds(
  selectedIds: Iterable<string>,
  departments: { id: string; parentId?: string | null }[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const d of departments) {
    if (!d.parentId) continue;
    const list = children.get(d.parentId) ?? [];
    list.push(d.id);
    children.set(d.parentId, list);
  }
  const out = new Set<string>();
  const stack = [...selectedIds];
  const visited = new Set<string>(stack);
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const child of children.get(id) ?? []) {
      if (visited.has(child)) continue;
      visited.add(child);
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

export interface DepartmentTreeRow<T> {
  dept: T;
  depth: number;
}

/**
 * Xếp phòng ban thành cây phẳng (cha trước, con thụt vào ngay dưới), anh em
 * theo tên tiếng Việt. Nhóm có parentId trỏ tới nhóm không tồn tại → coi là
 * gốc; vòng lặp parentId → phần còn lại đưa ra gốc, không lặp vô hạn.
 */
export function flattenDepartmentTree<T extends { id: string; name: string; parentId?: string | null }>(
  departments: T[],
): DepartmentTreeRow<T>[] {
  const byId = new Map(departments.map((d) => [d.id, d]));
  const children = new Map<string | null, T[]>();
  for (const d of departments) {
    const parent = d.parentId && byId.has(d.parentId) && d.parentId !== d.id ? d.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(d);
    children.set(parent, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name, "vi"));

  const out: DepartmentTreeRow<T>[] = [];
  const visited = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const d of children.get(parent) ?? []) {
      if (visited.has(d.id)) continue;
      visited.add(d.id);
      out.push({ dept: d, depth });
      if (depth < MAX_SCOPE_PARENT_HOPS) walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  // Phần còn sót (nằm trong vòng lặp parentId) — đưa ra gốc.
  for (const d of [...departments].sort((a, b) => a.name.localeCompare(b.name, "vi"))) {
    if (!visited.has(d.id)) {
      visited.add(d.id);
      out.push({ dept: d, depth: 0 });
    }
  }
  return out;
}
