import "server-only";
import type { ApproverState } from "@/lib/approval-logic";
import { addBusinessHours } from "@/lib/business-hours";
import { adminDb } from "@/lib/firebase/admin";
import { evaluateCondition, filterApplicableSteps } from "@/lib/server/conditions";
import { getHpcoreDb } from "@/lib/hpcore";
import { canManageGroupsAtAppScope, type Role } from "@/lib/permissions";
import { nextCounterCode } from "@/lib/validation";
import type {
  ApproverStepDef,
  ProposalField,
  ProposalGroup,
  RequestInstance,
  TaggedUser,
} from "@/lib/types";

export async function loadRequest(id: string): Promise<RequestInstance | null> {
  const snap = await adminDb.collection("requests").doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() } as RequestInstance;
}

/**
 * Nháp chỉ chủ đề xuất xem/sửa được (§ Requirement "Lưu nháp"). Đề xuất đã
 * gửi thì người tạo, người duyệt, người theo dõi hoặc owner/app_admin xem
 * được — không rò rỉ nội dung cho người không liên quan. Dùng chung cho cả
 * GET đề xuất và POST bình luận (không cho bình luận trên đề xuất mình
 * không có quyền xem).
 */
export function canView(req: RequestInstance, uid: string, role: Role): boolean {
  const isOwner = req.submittedBy.uid === uid;
  if (req.status === "draft") return isOwner;
  const isApprover = req.approversSnapshot.some((a) => a.id === uid);
  const isFollower = req.followers.some((f) => f.id === uid);
  return isOwner || isApprover || isFollower || canManageGroupsAtAppScope(role);
}

export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Trường bắt buộc còn thiếu giá trị — dùng khi gửi chính thức (không dùng khi lưu nháp). */
export function findMissingRequiredFields(
  fields: ProposalField[],
  values: Record<string, unknown>,
): ProposalField[] {
  // Field bị ẩn (visibleWhen không thoả) không bắt buộc trả lời dù
  // required=true — vd 4 field "Thiết bị..." chỉ 1 cái hiện tuỳ "Nhóm đề
  // xuất" đang chọn, 3 cái còn lại ẩn thì không được chặn gửi vì thiếu.
  return fields.filter(
    (f) =>
      f.required &&
      isEmptyValue(values?.[f.id]) &&
      (!f.visibleWhen || evaluateCondition(f.visibleWhen, values ?? {}, fields)),
  );
}

/** Khởi tạo approvers "pending" theo đúng thứ tự của danh sách người duyệt. */
export function buildInitialApprovers(approvers: TaggedUser[]): ApproverState[] {
  return approvers.map((a) => ({ id: a.id, decision: "pending" as const }));
}

/**
 * Hạn xử lý = thời điểm gửi + slaHours giờ; null nếu nhóm không đặt SLA.
 * `useBusinessHours` (từ ProposalGroup.slaByWorkCalendar) bật thì cộng dồn
 * SLA CHỈ trong giờ hành chính (lib/business-hours.ts), tắt thì cộng giờ
 * đồng hồ liên tục như cũ.
 */
export function computeDeadline(
  slaHours: number | null,
  from: Date,
  useBusinessHours = false,
): string | null {
  if (slaHours === null || slaHours === undefined) return null;
  if (useBusinessHours) return addBusinessHours(from, slaHours).toISOString();
  return new Date(from.getTime() + slaHours * 60 * 60 * 1000).toISOString();
}

/** true nếu đề xuất đang pending và đã qua deadlineAt — nhãn phái sinh, không lưu. */
export function isOverdue(status: string, deadlineAt: string | null, now = new Date()): boolean {
  if (status !== "pending" || !deadlineAt) return false;
  return new Date(deadlineAt).getTime() < now.getTime();
}

export function toProposalGroup(id: string, data: Record<string, unknown>): ProposalGroup {
  return { id, ...(data as Omit<ProposalGroup, "id">) };
}

/**
 * Mã đề xuất hiển thị cho người dùng — số nguyên tăng dần, cấp qua transaction
 * trên 1 document đếm dùng chung (counters/requestCode) để không trùng khi
 * nhiều người gửi cùng lúc. Định dạng 6 chữ số (000001, 000002...) — nếu vượt
 * quá 999999 thì hiện nhiều hơn 6 số, vẫn duy nhất, không lỗi.
 */
export async function generateRequestCode(): Promise<string> {
  const counterRef = adminDb.collection("counters").doc("requestCode");
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const { next, code } = nextCounterCode(snap.data()?.next as number | undefined);
    tx.set(counterRef, { next }, { merge: true });
    return code;
  });
}

/**
 * Mã đề xuất RIÊNG cho 1 nhóm đã bật `useOwnCounter` — transaction TRÊN
 * document đếm riêng (`counters/group_{groupId}`, tách biệt hoàn toàn khỏi
 * `counters/requestCode` dùng chung) nên không ảnh hưởng số thứ tự của nhóm
 * khác hay bộ đếm toàn hệ thống. Cùng định dạng 6 chữ số với generateRequestCode().
 */
export async function generateGroupRequestCode(groupId: string): Promise<string> {
  const counterRef = adminDb.collection("counters").doc(`group_${groupId}`);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const { next, code } = nextCounterCode(snap.data()?.next as number | undefined);
    tx.set(counterRef, { next }, { merge: true });
    return code;
  });
}

/** Ném khi không xác định được người duyệt bước "quản lý phòng ban người gửi". */
export class MissingApproverError extends Error {}

/**
 * Tra cứu trưởng đơn vị của CHÍNH NGƯỜI GỬI (users/{uid}.departmentId →
 * departments/{id}.leaderId) trong Firestore app tổng. Ném MissingApproverError
 * nếu người gửi chưa có phòng ban, hoặc phòng ban chưa có trưởng đơn vị —
 * quyết định: chặn gửi rõ ràng thay vì âm thầm bỏ qua bước duyệt.
 */
async function resolveSubmitterManager(submitterUid: string): Promise<TaggedUser> {
  const userSnap = await getHpcoreDb().collection("users").doc(submitterUid).get();
  const departmentId = userSnap.data()?.departmentId as string | null | undefined;
  if (!departmentId) {
    throw new MissingApproverError(
      "Bạn chưa thuộc phòng ban nào nên không xác định được người duyệt (quản lý phòng ban). Liên hệ admin để được gán phòng ban.",
    );
  }

  const deptSnap = await getHpcoreDb().collection("departments").doc(departmentId).get();
  const leaderId = deptSnap.data()?.leaderId as string | null | undefined;
  if (!leaderId) {
    throw new MissingApproverError(
      "Phòng ban của bạn chưa có trưởng đơn vị nên không xác định được người duyệt. Liên hệ admin để gán trưởng đơn vị.",
    );
  }

  const leaderSnap = await getHpcoreDb().collection("users").doc(leaderId).get();
  const leaderData = leaderSnap.data();
  if (!leaderSnap.exists || !leaderData) {
    throw new MissingApproverError(
      "Không tìm thấy hồ sơ trưởng đơn vị của phòng ban bạn. Liên hệ admin.",
    );
  }

  const fullName = (leaderData.fullName as string | undefined)?.trim() || leaderId;
  const email = (leaderData.email as string | undefined) ?? "";
  return {
    id: leaderId,
    name: fullName,
    username: email ? email.split("@")[0] : leaderId,
    avatarInitial: fullName.charAt(0).toUpperCase(),
  };
}

/**
 * Xác thực 1 lựa chọn thủ công cho bước "quản lý trực tiếp" — CHỈ chấp nhận
 * nếu id đó đang thực sự là leaderId của ≥1 phòng ban (KHÔNG tin nguyên giá
 * trị client gửi, tự query lại y hệt /api/directory/managers). Trả null nếu
 * không hợp lệ để nơi gọi rơi về auto-resolve như hành vi cũ.
 */
async function resolveManagerOverride(userId: string): Promise<TaggedUser | null> {
  const deptsSnap = await getHpcoreDb().collection("departments").where("leaderId", "==", userId).limit(1).get();
  if (deptsSnap.empty) return null;

  const userSnap = await getHpcoreDb().collection("users").doc(userId).get();
  const userData = userSnap.data();
  if (!userSnap.exists || !userData) return null;

  const fullName = (userData.fullName as string | undefined)?.trim() || userId;
  const email = (userData.email as string | undefined) ?? "";
  return {
    id: userId,
    name: fullName,
    username: email ? email.split("@")[0] : userId,
    avatarInitial: fullName.charAt(0).toUpperCase(),
  };
}

export interface ResolvedApproverStep {
  index: number;
  kind: ApproverStepDef["kind"];
  user: TaggedUser | null;
  error?: string;
}

/**
 * Phân giải danh sách bước duyệt của nhóm thành CHI TIẾT từng bước — "fixed"
 * giữ nguyên, "submitter_manager" ưu tiên `managerOverrides[index]` (nếu hợp
 * lệ, xem resolveManagerOverride), rồi mới auto-resolve theo phòng ban người
 * gửi. KHÔNG throw khi 1 bước lỗi — set `error` ở đúng phần tử đó, để nơi gọi
 * (preview UI) hiện được lỗi đúng vị trí thay vì lỗi chung cho cả request.
 * Bước có `condition` không thoả mãn bị lọc bỏ hoàn toàn khỏi kết quả trả về.
 */
export async function resolveApproverStepsDetailed(
  steps: ApproverStepDef[] | undefined,
  submitterUid: string,
  values: Record<string, unknown> = {},
  fields: ProposalField[] = [],
  managerOverrides: Record<number, string> = {},
): Promise<ResolvedApproverStep[]> {
  const applicableSteps = filterApplicableSteps(steps ?? [], values, fields);
  const results: ResolvedApproverStep[] = [];

  for (let i = 0; i < applicableSteps.length; i++) {
    const step = applicableSteps[i];
    if (step.kind === "fixed") {
      results.push({ index: i, kind: "fixed", user: step.user });
      continue;
    }

    const overrideUserId = managerOverrides[i];
    const overrideUser = overrideUserId ? await resolveManagerOverride(overrideUserId) : null;
    if (overrideUser) {
      results.push({ index: i, kind: "submitter_manager", user: overrideUser });
      continue;
    }

    try {
      const user = await resolveSubmitterManager(submitterUid);
      results.push({ index: i, kind: "submitter_manager", user });
    } catch (err) {
      results.push({
        index: i,
        kind: "submitter_manager",
        user: null,
        error: err instanceof Error ? err.message : "Không xác định được người duyệt.",
      });
    }
  }

  return results;
}

/**
 * Phân giải danh sách bước duyệt của nhóm thành danh sách người duyệt cụ thể
 * tại thời điểm gửi đề xuất (kết quả SNAPSHOT vào đề xuất, không tự đổi nếu
 * trưởng đơn vị đổi sau này) — wrapper giữ NGUYÊN hành vi cũ (throw
 * MissingApproverError khi thiếu người duyệt) trên nền resolveApproverStepsDetailed(),
 * cộng thêm hỗ trợ managerOverrides tuỳ chọn cho bước submitter_manager.
 */
export async function resolveApproverSteps(
  steps: ApproverStepDef[] | undefined,
  submitterUid: string,
  values: Record<string, unknown> = {},
  fields: ProposalField[] = [],
  managerOverrides: Record<number, string> = {},
): Promise<TaggedUser[]> {
  const applicableSteps = filterApplicableSteps(steps ?? [], values, fields);
  if ((steps ?? []).length > 0 && applicableSteps.length === 0) {
    throw new MissingApproverError(
      "Không xác định được người duyệt nào phù hợp điều kiện hiện tại của đề xuất này. Liên hệ admin để kiểm tra lại cấu hình người duyệt của nhóm.",
    );
  }

  const detailed = await resolveApproverStepsDetailed(steps, submitterUid, values, fields, managerOverrides);
  const failed = detailed.find((d) => d.error || !d.user);
  if (failed) {
    throw new MissingApproverError(failed.error ?? "Không xác định được người duyệt.");
  }
  return detailed.map((d) => d.user!);
}
