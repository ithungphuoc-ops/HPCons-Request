import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { getHpcoreDb } from "@/lib/hpcore";
import { getCachedDepartments } from "@/lib/server/hpcore-org";
import {
  findLastApprover,
  findPurchasingDepartment,
  resolveAdjustmentGuide,
  resolveDefaultAdjustmentGuide,
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

/* ------------------- Nội dung hướng dẫn MẶC ĐỊNH (fallback) ------------------- */

/** Hướng dẫn CHUNG cũ (PR #85, `appSettings/adjustment` — Firestore project
 * của app Đề xuất). Từ 06/10/2026 mỗi nhóm có hướng dẫn riêng
 * (`group.adjustmentGuide`); doc này KHÔNG còn chỗ sửa, chỉ còn được ĐỌC làm
 * nội dung mặc định cho nhóm chưa soạn riêng — để không mất nội dung Admin đã
 * soạn trước đó. */
const GUIDE_DOC = () => adminDb.collection("appSettings").doc("adjustment");

/** Nội dung mặc định cho nhóm chưa soạn riêng — xem
 * `resolveDefaultAdjustmentGuide` (doc cũ nếu từng lưu, không thì mặc định
 * trong code). */
export async function getDefaultAdjustmentGuide(): Promise<string> {
  const snap = await GUIDE_DOC().get();
  const data = snap.data() as { guide?: unknown } | undefined;
  return resolveDefaultAdjustmentGuide(typeof data?.guide === "string" ? data.guide : null);
}

/** Hướng dẫn hiện trong hộp Điều chỉnh của 1 nhóm — nhóm đã soạn riêng (kể
 * cả chuỗi rỗng) thì KHÔNG tốn lượt đọc doc mặc định. */
export async function getAdjustmentGuideForGroup(groupGuide: string | null | undefined): Promise<string> {
  if (typeof groupGuide === "string") return resolveAdjustmentGuide(groupGuide, null);
  return getDefaultAdjustmentGuide();
}
