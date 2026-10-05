import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import { getHpcoreDb } from "@/lib/hpcore";
import { getCachedDepartments, getScopeMembership } from "@/lib/server/hpcore-org";
import type {
  AdjustmentApprovalBranch,
  AdjustmentApprovalRules,
  AdjustmentApproverRef,
  RequestInstance,
} from "@/lib/types";

/**
 * Hạt nhân xét "Điều chỉnh sau duyệt" theo bảng nhánh Admin tự cấu hình RIÊNG
 * từng nhóm đề xuất (`ProposalGroup.adjustmentApprovalRules`) — thay bản
 * hard-code "Thi công"/"Thu mua cung ứng" ở PR #67 (đã đóng 05/10/2026). Xem
 * design.md của change add-adjustment-approval-conditions.
 */

export type AdjustmentApprovalPlan =
  | { kind: "direct" }
  | { kind: "gated"; refs: AdjustmentApproverRef[] }
  | { kind: "none" };

/**
 * Tìm nhánh ĐẦU TIÊN (xét theo thứ tự) có phòng ban giao với `actorDepartmentIds`
 * — hàm THUẦN, không đọc Firestore, test bằng dữ liệu giả được.
 */
export function matchAdjustmentBranch(
  branches: Pick<AdjustmentApprovalBranch, "departments" | "requiredApprovers">[],
  actorDepartmentIds: string[],
): { requiredApprovers: AdjustmentApproverRef[] } | null {
  const deptIdSet = new Set(actorDepartmentIds);
  const matched = branches.find((b) => b.departments.some((d) => deptIdSet.has(d.id)));
  return matched ? { requiredApprovers: matched.requiredApprovers } : null;
}

/**
 * Quyết định "direct" (lưu thẳng, hành vi cũ) / "gated" (cần danh sách approver
 * ref, chưa resolve thành người thật) / "none" (không được bấm) — hàm THUẦN,
 * test bằng dữ liệu giả được, KHÔNG đọc Firestore.
 *
 * Luật (Sếp chốt 05/10/2026):
 * - Nhóm không có `rules` → submitter luôn "direct", follower luôn "none".
 * - `allowFollowers === false` → follower luôn "none" (bất kể phòng ban).
 * - Khớp 1 nhánh → dùng approvers của nhánh đó (rỗng = "direct").
 * - Không khớp nhánh nào: submitter LUÔN "direct"; follower dùng `catchAllApprovers`
 *   (rỗng = "none").
 */
export function planAdjustmentApproval(
  rules: AdjustmentApprovalRules | undefined,
  actor: { isSubmitter: boolean; departmentIds: string[] },
): AdjustmentApprovalPlan {
  if (!rules) return actor.isSubmitter ? { kind: "direct" } : { kind: "none" };
  if (!actor.isSubmitter && !rules.allowFollowers) return { kind: "none" };

  const matched = matchAdjustmentBranch(rules.branches, actor.departmentIds);
  if (matched) {
    return matched.requiredApprovers.length > 0
      ? { kind: "gated", refs: matched.requiredApprovers }
      : { kind: "direct" };
  }
  if (actor.isSubmitter) return { kind: "direct" };
  return rules.catchAllApprovers.length > 0
    ? { kind: "gated", refs: rules.catchAllApprovers }
    : { kind: "none" };
}

/** Phòng ban (đơn vị chính + kiêm nhiệm) của 1 uid — KHÔNG throw, lỗi gì cũng
 * trả mảng rỗng (coi như không thuộc phòng nào, an toàn — không chặn tính
 * năng vì lỗi tra cứu). */
export async function resolveActorDepartmentIds(uid: string): Promise<string[]> {
  try {
    const membership = await getScopeMembership(uid);
    return [...membership.primaryGroupIds, ...membership.secondaryGroupIds];
  } catch (err) {
    console.warn("[adjustment-approval-rules] Tra phòng ban lỗi, coi như không thuộc phòng nào:", err);
    return [];
  }
}

async function resolveDisplayName(uid: string): Promise<string | null> {
  try {
    const snap = await getHpcoreDb().collection("users").doc(uid).get();
    const fullName = (snap.data()?.fullName as string | undefined)?.trim();
    return fullName || null;
  } catch {
    return null;
  }
}

/**
 * Resolve danh sách `AdjustmentApproverRef[]` thành người thật `{uid, name}[]`
 * — `null` = THIẾU DỮ LIỆU (chưa có `originalFirstApprover`, hoặc phòng ban
 * chưa có `leaderId`) → nơi gọi PHẢI coi như không khớp nhánh nào (rơi về
 * "direct"/"none" tuỳ submitter hay follower), KHÔNG được chặn người dùng.
 *
 * Trùng uid (vd "Chỉ huy trưởng" và "Trưởng phòng X" hoá ra là cùng 1 người)
 * → GỘP còn 1 lượt duyệt (Sếp chốt 05/10/2026, giống tinh thần `dedupeApprovers`
 * ở luồng duyệt chính) — giữ thứ tự xuất hiện đầu tiên.
 */
export async function resolveApproverRefs(
  refs: AdjustmentApproverRef[],
  request: Pick<RequestInstance, "originalFirstApprover">,
): Promise<{ uid: string; name: string }[] | null> {
  const resolved: { uid: string; name: string }[] = [];
  for (const ref of refs) {
    if (ref.kind === "chi_huy_truong") {
      const chiHuyTruong = request.originalFirstApprover;
      if (!chiHuyTruong) return null;
      resolved.push({ uid: chiHuyTruong.id, name: chiHuyTruong.name });
      continue;
    }
    const depts = await getCachedDepartments();
    const dept = depts.find((d) => d.id === ref.departmentId);
    if (!dept?.leaderId) return null;
    const name = await resolveDisplayName(dept.leaderId);
    resolved.push({ uid: dept.leaderId, name: name ?? `Trưởng phòng ${ref.departmentName}` });
  }

  const seen = new Map<string, { uid: string; name: string }>();
  for (const r of resolved) {
    if (!seen.has(r.uid)) seen.set(r.uid, r);
  }
  return Array.from(seen.values());
}

export type ResolvedAdjustmentPlan =
  | { kind: "direct" }
  | { kind: "gated"; approvers: { uid: string; name: string }[] }
  | { kind: "none" };

/**
 * Plan ĐẦY ĐỦ cho 1 người cụ thể trên 1 đề xuất cụ thể — gộp `planAdjustmentApproval`
 * + `resolveApproverRefs` + fallback khi thiếu dữ liệu (Decision 2/3: rơi về
 * "direct" cho submitter / "none" cho follower, KHÔNG chặn). Dùng CHUNG cho cả
 * route ghi điều chỉnh (`adjustment/route.ts`) lẫn route đọc đề xuất (tính
 * `viewerAdjustmentAccess` hiển thị nút đúng chữ) — 1 nơi duy nhất quyết định
 * "ai được gì", tránh 2 route tính lệch nhau dần theo thời gian.
 */
export async function resolveAdjustmentPlanForActor(
  found: Pick<RequestInstance, "submittedBy" | "followers" | "originalFirstApprover" | "status">,
  uid: string,
  rules: AdjustmentApprovalRules | undefined,
): Promise<ResolvedAdjustmentPlan> {
  if (found.status !== "approved") return { kind: "none" };
  const isSubmitter = found.submittedBy.uid === uid;
  const isFollower = found.followers.some((f) => f.id === uid);
  if (!isSubmitter && !isFollower) return { kind: "none" };

  const departmentIds = rules ? await resolveActorDepartmentIds(uid) : [];
  const plan = planAdjustmentApproval(rules, { isSubmitter, departmentIds });
  if (plan.kind !== "gated") return plan;

  const resolved = await resolveApproverRefs(plan.refs, found);
  if (!resolved) return isSubmitter ? { kind: "direct" } : { kind: "none" };
  return { kind: "gated", approvers: resolved };
}

/** Đề xuất trực tiếp (không `groupId`) không có cấu hình nhóm nào — luôn
 * `undefined`. Dùng CHUNG ở `adjustment/route.ts` (ghi điều chỉnh) và
 * `requests/[id]/route.ts` (GET, tính `viewerAdjustmentAccess` hiển thị). */
export async function loadAdjustmentApprovalRules(
  groupId: string | null,
): Promise<AdjustmentApprovalRules | undefined> {
  if (!groupId) return undefined;
  const snap = await adminDb.collection("groups").doc(groupId).get();
  return (snap.data()?.adjustmentApprovalRules as AdjustmentApprovalRules | undefined) ?? undefined;
}
