import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import type { AdjustmentApprovalRules, ProposalGroup, RequestInstance } from "@/lib/types";

/**
 * Ai được bấm "Điều chỉnh đề nghị sau duyệt".
 *
 * 06/10/2026 (Sếp duyệt demo dieu-chinh-tu-chon-nguoi-duyet): BỎ bảng "nhánh
 * theo phòng ban" của PR #68 — mọi điều chỉnh đều phải qua ĐÚNG 2 người duyệt
 * do người điều chỉnh tự chọn. Phần còn giữ là quyền BẤM, giữ như trước:
 * - Người gửi đề xuất: luôn được (đề xuất đã duyệt).
 * - Người theo dõi: chỉ khi nhóm đã bật `adjustmentApprovalRules` VÀ
 *   `allowFollowers === true` (ô "Cho phép người theo dõi cũng bấm Điều
 *   chỉnh" — vẫn cài THEO NHÓM như cũ, dữ liệu sẵn có giữ nguyên nghĩa).
 *
 * Khác duy nhất so với PR #68: trước đây người theo dõi còn phải "khớp 1
 * nhánh phòng ban hoặc có nhánh mặc định" mới bấm được; nay bỏ nhánh nên chỉ
 * còn xét `allowFollowers`. `branches`/`catchAllApprovers` cũ KHÔNG bị xoá
 * khỏi Firestore, chỉ không đọc nữa.
 *
 * Hàm THUẦN — dùng chung route ghi điều chỉnh và GET đề xuất (hiện/ẩn nút).
 */
export function canAdjustAfterApproval(
  found: Pick<RequestInstance, "submittedBy" | "followers" | "status" | "deletedAt">,
  uid: string,
  rules: Pick<AdjustmentApprovalRules, "allowFollowers"> | null | undefined,
): boolean {
  if (found.status !== "approved" || found.deletedAt) return false;
  if (found.submittedBy.uid === uid) return true;
  const isFollower = found.followers.some((f) => f.id === uid);
  return isFollower && rules?.allowFollowers === true;
}

export type AdjustmentGroupSettings = Pick<
  ProposalGroup,
  "adjustmentApprovalRules" | "adjustmentFieldRules" | "notificationRules"
>;

/** Cài đặt nhóm cần cho điều chỉnh — đề xuất trực tiếp (không `groupId`) /
 * nhóm đã xoá → object rỗng (chỉ người gửi bấm được, ô theo mặc định). */
export async function loadAdjustmentGroupSettings(groupId: string | null): Promise<AdjustmentGroupSettings> {
  if (!groupId) return {};
  const snap = await adminDb.collection("groups").doc(groupId).get();
  const data = snap.data() as Partial<ProposalGroup> | undefined;
  if (!data) return {};
  return {
    adjustmentApprovalRules: data.adjustmentApprovalRules ?? null,
    adjustmentFieldRules: data.adjustmentFieldRules,
    notificationRules: data.notificationRules,
  };
}
