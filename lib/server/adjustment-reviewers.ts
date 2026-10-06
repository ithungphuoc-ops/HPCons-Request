import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { getHpcoreDb } from "@/lib/hpcore";
import { getCachedDepartments } from "@/lib/server/hpcore-org";
import {
  DEFAULT_ADJUSTMENT_GUIDE,
  findLastApprover,
  findPurchasingDepartment,
} from "@/lib/adjustment-settings";
import type { RequestInstance } from "@/lib/types";

export interface ActiveUser {
  uid: string;
  name: string;
}

/**
 * Tra người dùng ĐANG HOẠT ĐỘNG ở App Tổng (`users/{uid}.isActive === true`)
 * — nguồn tên duy nhất cho người duyệt điều chỉnh (KHÔNG tin tên client gửi
 * lên). Người không tồn tại / đã khoá → không có trong Map trả về.
 */
export async function loadActiveUsers(uids: string[]): Promise<Map<string, ActiveUser>> {
  const out = new Map<string, ActiveUser>();
  const unique = Array.from(new Set(uids.filter(Boolean)));
  if (unique.length === 0) return out;
  const db = getHpcoreDb();
  const snaps = await db.getAll(...unique.map((uid) => db.collection("users").doc(uid)));
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data() as { isActive?: unknown; fullName?: string; email?: string } | undefined;
    if (data?.isActive !== true) continue;
    const name = data.fullName?.trim() || data.email?.split("@")[0] || snap.id;
    out.set(snap.id, { uid: snap.id, name });
  }
  return out;
}

export interface AdjustmentSuggestion {
  key: "last_approver" | "purchasing_leader";
  /** "Người duyệt cuối" / "Trưởng phòng Thu mua" */
  label: string;
  user: { id: string; name: string };
}

/**
 * 2 nút gợi ý nhanh trong hộp điều chỉnh:
 * - "Người duyệt cuối" — `findLastApprover()` (người thực tế bấm duyệt cuối).
 * - "Trưởng phòng Thu mua" — `leaderId` của phòng có tên chứa "Thu mua" ở App
 *   Tổng; không tìm thấy thì không có gợi ý này.
 * Bỏ gợi ý trùng chính người điều chỉnh / người không còn hoạt động. Lỗi tra
 * cứu App Tổng → bỏ gợi ý đó (không chặn tính năng — vẫn gõ @ chọn được).
 */
export async function resolveAdjustmentSuggestions(
  found: Pick<RequestInstance, "history" | "approversSnapshot" | "approvers">,
  requesterUid: string,
): Promise<AdjustmentSuggestion[]> {
  const candidates: { key: AdjustmentSuggestion["key"]; label: string; uid: string }[] = [];
  const last = findLastApprover(found);
  if (last) candidates.push({ key: "last_approver", label: "Người duyệt cuối", uid: last.id });
  try {
    const dept = findPurchasingDepartment(await getCachedDepartments());
    if (dept?.leaderId) candidates.push({ key: "purchasing_leader", label: "Trưởng phòng Thu mua", uid: dept.leaderId });
  } catch (err) {
    console.warn("[adjustment] Tra phòng Thu mua ở App Tổng lỗi, bỏ gợi ý:", err);
  }
  const usable = candidates.filter((c) => c.uid !== requesterUid);
  if (usable.length === 0) return [];
  let active: Map<string, ActiveUser>;
  try {
    active = await loadActiveUsers(usable.map((c) => c.uid));
  } catch (err) {
    console.warn("[adjustment] Tra người dùng App Tổng lỗi, bỏ gợi ý:", err);
    return [];
  }
  return usable
    .filter((c) => active.has(c.uid))
    .map((c) => ({ key: c.key, label: c.label, user: { id: c.uid, name: active.get(c.uid)!.name } }));
}

/* ------------------------- Hướng dẫn chung toàn app ------------------------ */

/** Cài đặt cấp APP (không theo nhóm) — collection riêng, 1 doc. */
const GUIDE_DOC = () => adminDb.collection("appSettings").doc("adjustment");

/** Nội dung "Hướng dẫn điều chỉnh sau duyệt" — chưa từng lưu → mặc định như
 * demo. Chuỗi rỗng (Owner/Admin cố ý xoá hết) → không hiện cảnh báo. */
export async function getAdjustmentGuide(): Promise<{ guide: string; isDefault: boolean; updatedAt: string | null; updatedBy: string | null }> {
  const snap = await GUIDE_DOC().get();
  const data = snap.data() as { guide?: unknown; updatedAt?: string; updatedBy?: string } | undefined;
  if (!data || typeof data.guide !== "string") {
    return { guide: DEFAULT_ADJUSTMENT_GUIDE, isDefault: true, updatedAt: null, updatedBy: null };
  }
  return { guide: data.guide, isDefault: false, updatedAt: data.updatedAt ?? null, updatedBy: data.updatedBy ?? null };
}

export async function saveAdjustmentGuide(guide: string, actorName: string): Promise<void> {
  await GUIDE_DOC().set({ guide, updatedAt: new Date().toISOString(), updatedBy: actorName }, { merge: true });
}
