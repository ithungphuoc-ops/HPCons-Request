import type { RequestInstance, TaggedUser } from "./types";
import { isInUsedForScope } from "./used-for-scope";

/**
 * Vai trò TOÀN CỤC của app tổng hpcons-portal (users/{uid}.role) — dùng thẳng,
 * không có hệ vai trò riêng cho app này. Quyết định: owner/admin quản lý
 * nhóm đề xuất; manager/employee chỉ xem nhóm + gửi đề xuất. Không cần bước
 * gán quyền riêng qua app_permissions — ai đã là owner/admin ở app tổng thì
 * có quyền ngay, không phải chờ hpcore cấp thêm.
 */
export type Role = "owner" | "admin" | "manager" | "employee";

export interface ScopeUser {
  userId: string;
  groupIds: string[];
}

/** Chỉ Owner hoặc Admin (vai trò toàn cục app tổng) được tạo/cấu hình nhóm đề xuất. */
export function canManageGroupsAtAppScope(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/**
 * §5.3 quy tắc 2: người dùng chỉ nhìn thấy/tạo đề xuất trong nhóm nằm trong phạm vi "Sử dụng cho".
 * usedFor rỗng nghĩa là toàn công ty được dùng. Bản gọn giữ cho tương thích —
 * `groupIds` coi như nhóm của ĐƠN VỊ CHÍNH (đã gồm nhóm cha). Nơi gọi thật ở
 * máy chủ dùng `isUserInGroupScope` (lib/server/scope-membership.ts) để có cả
 * kiêm nhiệm theo công tắc từng loại đề xuất.
 */
export function isWithinUsedForScope(
  usedFor: TaggedUser[],
  user: ScopeUser,
): boolean {
  return isInUsedForScope({ usedFor }, user.userId, {
    primaryGroupIds: user.groupIds,
    secondaryGroupIds: [],
  });
}

/**
 * §5.3 quy tắc 4: người theo dõi được xem/nhận cập nhật nhưng không tự động có quyền duyệt.
 */
export function isFollowerAllowedToApprove(): boolean {
  return false;
}

/**
 * Chỉ CHÍNH người làm đề xuất được bổ sung dữ liệu (nối dòng bảng, đính
 * file) sau khi đề xuất đã duyệt — Owner/Admin KHÔNG được làm thay, khác
 * hẳn quyền quản lý thông thường (canManageGroupsAtAppScope). Dùng chung ở
 * cả backend (route table-supplement, route attachments) lẫn UI
 * (RequestDetailView.tsx) — đổi luật này chỉ cần sửa đúng 1 chỗ, xem
 * design.md của change add-post-approval-supplement.
 */
export function canSupplementAfterApproval(
  request: Pick<RequestInstance, "status" | "submittedBy">,
  uid: string,
): boolean {
  return request.status === "approved" && request.submittedBy.uid === uid;
}

/**
 * Quyền RIÊNG cho hành động "Điều chỉnh đề nghị sau duyệt" — KHÁC HẲN
 * `canSupplementAfterApproval` ở trên (hàm đó vẫn dùng NGUYÊN cho
 * table-supplement/attachments, không đụng). Hàm THUẦN: `department` đã được
 * tra sẵn ở nơi gọi (`lib/server/adjustment-gate.ts`, cần đọc Firestore App
 * Tổng) — xem design.md của change add-adjustment-approval-gate.
 *
 * - `"direct"`: hành vi CŨ — ghi thẳng ngay, không qua duyệt. Chỉ `submittedBy`,
 *   và chỉ khi KHÔNG thuộc 2 phòng ban "gated".
 * - `"gated"`: phải qua duyệt (Trưởng phòng Thu mua cung ứng / Chỉ huy
 *   trưởng) — `submittedBy` HOẶC `followers[]`, miễn thuộc phòng Thi công/Thu
 *   mua cung ứng.
 * - `"none"`: không được bấm — người ngoài submitter/followers, HOẶC follower
 *   thuộc phòng khác (follower chỉ được cấp quyền vì lý do 2 phòng ban này,
 *   không có quyền chung chung).
 */
export function resolveAdjustmentAccess(
  request: Pick<RequestInstance, "status" | "submittedBy" | "followers">,
  uid: string,
  department: "thi_cong" | "thu_mua_cung_ung" | "other",
): "direct" | "gated" | "none" {
  if (request.status !== "approved") return "none";
  const isSubmitter = request.submittedBy.uid === uid;
  const isFollower = request.followers.some((f) => f.id === uid);
  if (!isSubmitter && !isFollower) return "none";
  if (department === "thi_cong" || department === "thu_mua_cung_ung") return "gated";
  return isSubmitter ? "direct" : "none";
}
