/**
 * Luật xác định "Quản lý trực tiếp" — DÙNG CHUNG cho mọi app trong hệ sinh
 * thái HP Cons (hợp đồng dữ liệu Sếp duyệt 03/10/2026, change
 * openspec/changes/quan-ly-truc-tiep). Hàm THUẦN: không import Firestore, chỉ
 * nhận 2 hàm đọc dữ liệu (`getUser`/`getDepartment`) để kiểm được bằng dữ liệu
 * giả trong bộ nhớ (lib/direct-manager.test.ts).
 *
 *   1. users/{uid}.directManagerIds (có thứ tự): id đầu tiên khác chính mình
 *      VÀ users/{id} tồn tại → trả id.
 *   2. Đi từ đơn vị chính users/{uid}.departmentId lên các nhóm cha
 *      (departments/{d}.parentId), tối đa 10 bậc: gặp leaderId khác chính
 *      mình → trả leaderId.
 *   3. Không có gì → null (nơi gọi tự quyết: chặn gửi / bỏ qua).
 */

export interface DirectManagerUserDoc {
  directManagerIds?: unknown;
  departmentId?: unknown;
}

export interface DirectManagerDepartmentDoc {
  leaderId?: unknown;
  parentId?: unknown;
}

export interface DirectManagerSource {
  /** null nếu users/{uid} không tồn tại. */
  getUser(uid: string): Promise<DirectManagerUserDoc | null>;
  /** null nếu departments/{id} không tồn tại. */
  getDepartment(id: string): Promise<DirectManagerDepartmentDoc | null>;
}

/** Số bậc tối đa khi đi lên nhóm cha — chặn treo nếu dữ liệu lỡ có vòng lặp. */
export const MAX_PARENT_HOPS = 10;

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Đọc `directManagerIds` an toàn (dữ liệu cũ không có trường → mảng rỗng). */
export function readDirectManagerIds(user: DirectManagerUserDoc | null | undefined): string[] {
  const raw = user?.directManagerIds;
  if (!Array.isArray(raw)) return [];
  return raw.map(asNonEmptyString).filter((id): id is string => id !== null);
}

export async function resolveDirectManagerIdWith(
  uid: string,
  source: DirectManagerSource,
): Promise<string | null> {
  const user = await source.getUser(uid);
  if (!user) return null;

  // Bước 1 — quản lý trực tiếp gán tay trong hồ sơ.
  for (const id of readDirectManagerIds(user)) {
    if (id === uid) continue;
    if (await source.getUser(id)) return id;
  }

  // Bước 2 — trưởng đơn vị chính, rồi đi lên nhóm cha.
  let d = asNonEmptyString(user.departmentId);
  for (let hop = 0; hop < MAX_PARENT_HOPS && d; hop++) {
    const dept = await source.getDepartment(d);
    if (!dept) break;
    const leader = asNonEmptyString(dept.leaderId);
    if (leader && leader !== uid) return leader;
    d = asNonEmptyString(dept.parentId);
  }

  // Bước 3.
  return null;
}

/**
 * Đưa người trong `directManagerIds` (đúng thứ tự) lên đầu danh sách chọn,
 * phần còn lại giữ nguyên thứ tự gốc. `extra` = hồ sơ của người trong
 * directManagerIds mà danh sách gốc chưa có (được chèn vào đúng vị trí ưu tiên).
 */
export function prioritizeDirectManagers<T extends { id: string }>(
  list: T[],
  directManagerIds: string[],
  extra: T[] = [],
): T[] {
  const byId = new Map<string, T>();
  for (const item of [...extra, ...list]) byId.set(item.id, item);
  const head: T[] = [];
  const seen = new Set<string>();
  for (const id of directManagerIds) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      head.push(item);
      seen.add(id);
    }
  }
  return [...head, ...list.filter((item) => !seen.has(item.id))];
}
