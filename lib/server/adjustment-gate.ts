import "server-only";
import { getHpcoreDb } from "@/lib/hpcore";
import { getCachedDepartments, getScopeMembership } from "@/lib/server/hpcore-org";
import type { RequestInstance } from "@/lib/types";

/**
 * "Thi công"/"Thu mua cung ứng" hay bất kỳ phòng nào khác — luồng duyệt mới
 * cho "Điều chỉnh đề nghị sau duyệt" (change add-adjustment-approval-gate) CHỈ
 * áp dụng cho 2 phòng ban này, mọi phòng khác (hoặc tra lỗi) rơi về `"other"`
 * = hành vi cũ (chỉ submitter, lưu thẳng ngay) — xem design.md Decision 2/3.
 */
export type AdjustmentGateDepartment = "thi_cong" | "thu_mua_cung_ung" | "other";

function chuanHoaTenPhong(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Tra phòng ban của 1 uid — so khớp tên KHÔNG phân biệt hoa/thường và khoảng
 * trắng dư (Decision 2: tên phòng ban trong Firestore có thể lệch chút so với
 * "Thi công"/"Thu mua cung ứng" Sếp đọc trên UI). KHÔNG BAO GIỜ throw — lỗi gì
 * cũng rơi về `"other"`, giữ đúng nguyên tắc "tra lỗi = không chặn tính năng".
 */
export async function resolveGateDepartment(uid: string): Promise<AdjustmentGateDepartment> {
  try {
    const [depts, membership] = await Promise.all([getCachedDepartments(), getScopeMembership(uid)]);
    const thiCong = depts.find((d) => chuanHoaTenPhong(d.name) === "thi công");
    const thuMuaCungUng = depts.find((d) => chuanHoaTenPhong(d.name) === "thu mua cung ứng");
    if (!thiCong) console.warn('[adjustment-gate] Không tìm thấy phòng ban tên "Thi công".');
    if (!thuMuaCungUng) console.warn('[adjustment-gate] Không tìm thấy phòng ban tên "Thu mua cung ứng".');

    const ids = new Set([...membership.primaryGroupIds, ...membership.secondaryGroupIds]);
    if (thuMuaCungUng && ids.has(thuMuaCungUng.id)) return "thu_mua_cung_ung";
    if (thiCong && ids.has(thiCong.id)) return "thi_cong";
    return "other";
  } catch (err) {
    console.warn("[adjustment-gate] Tra phòng ban lỗi, coi như phòng khác:", err);
    return "other";
  }
}

/** Tên hiển thị của 1 uid trong App Tổng — rỗng/lỗi thì trả `null` (gọi nơi
 * dùng tự quyết định fallback, không tự bịa tên). */
async function resolveDisplayName(uid: string): Promise<string | null> {
  try {
    const snap = await getHpcoreDb().collection("users").doc(uid).get();
    const data = snap.data();
    const fullName = (data?.fullName as string | undefined)?.trim();
    return fullName || null;
  } catch {
    return null;
  }
}

/**
 * Người duyệt cho 1 điều chỉnh "gated" — `null` = thiếu dữ liệu cần thiết
 * (phòng "Thu mua cung ứng" chưa có `leaderId`, hoặc đề xuất chưa có
 * `originalFirstApprover`) → nơi gọi (route adjustment) PHẢI coi như "other"
 * (Decision 2/3), KHÔNG được chặn người dùng.
 */
export async function resolveAdjustmentApprover(
  department: Extract<AdjustmentGateDepartment, "thi_cong" | "thu_mua_cung_ung">,
  request: Pick<RequestInstance, "originalFirstApprover">,
): Promise<{ approverUid: string; approverName: string } | null> {
  if (department === "thu_mua_cung_ung") {
    const chiHuyTruong = request.originalFirstApprover;
    if (!chiHuyTruong) return null;
    return { approverUid: chiHuyTruong.id, approverName: chiHuyTruong.name };
  }

  // department === "thi_cong" → Trưởng phòng "Thu mua cung ứng".
  const depts = await getCachedDepartments();
  const thuMuaCungUng = depts.find((d) => chuanHoaTenPhong(d.name) === "thu mua cung ứng");
  if (!thuMuaCungUng?.leaderId) return null;
  const name = await resolveDisplayName(thuMuaCungUng.leaderId);
  return { approverUid: thuMuaCungUng.leaderId, approverName: name ?? "Trưởng phòng Thu mua cung ứng" };
}
