import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import type { ProposalGroup } from "@/lib/types";

/** Hàm thuần đã chuyển sang lib/adjustment-settings.ts (dùng được cả ở client
 * — trang danh sách tự tính nút Điều chỉnh từ cài đặt nhóm đã tải sẵn). */
export { canAdjustAfterApproval } from "@/lib/adjustment-settings";

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
