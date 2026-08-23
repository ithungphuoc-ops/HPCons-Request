import "server-only";
import { assertNeverApproverKind, fixedStepUsers, type ApproverState } from "@/lib/approval-logic";
import { addBusinessHours } from "@/lib/business-hours";
import {
  classifyDateLeadTime,
  countBusinessDaysBetween,
  parseFieldDateOnly,
} from "@/lib/date-lead-time";
import { adminDb } from "@/lib/firebase/admin";
import { evaluateConditionGroup, filterApplicableSteps } from "@/lib/server/conditions";
import { getHpcoreDb } from "@/lib/hpcore";
import { canManageGroupsAtAppScope, type Role } from "@/lib/permissions";
import { nextCounterCode } from "@/lib/validation";
import type {
  ApproverStepDef,
  ApproverStepMeta,
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
      (!f.visibleWhen || evaluateConditionGroup(f.visibleWhen, values ?? {}, fields)),
  );
}

/**
 * Field date/datetime có bật `dateLeadTimeRule` mà giá trị đang chọn cách hôm
 * gửi ≤2 ngày làm việc — mốc cứng "bắt buộc", CHẶN gửi chính thức (không dùng
 * khi lưu nháp) — xem lib/date-lead-time.ts. Trước đây chỉ chặn ở trình
 * duyệt (submit/page.tsx handleSubmit), ai gọi thẳng API vẫn né được luật
 * này (CodeRabbit phát hiện ở PR #2, 20/08/2026) — nay chặn thêm ở đây, dùng
 * chung cho cả tạo mới (POST) và gửi từ nháp (PATCH). Field bị ẩn (visibleWhen
 * không thoả) hoặc giá trị rỗng/không hợp lệ thì bỏ qua — không phải lỗi của
 * luật này (rỗng đã có findMissingRequiredFields xử lý riêng nếu field đó
 * cũng required).
 */
export function findBlockedDateLeadTimeFields(
  fields: ProposalField[],
  values: Record<string, unknown>,
  now: Date = new Date(),
): ProposalField[] {
  return fields.filter((f) => {
    if (!f.dateLeadTimeRule?.enabled) return false;
    if (f.visibleWhen && !evaluateConditionGroup(f.visibleWhen, values ?? {}, fields)) return false;
    const raw = values?.[f.id];
    if (isEmptyValue(raw)) return false;
    // Không tin kiểu dữ liệu client gửi lên — giá trị field không phải string
    // (vd số, object do client cố ý/lỗi gửi sai) không phải lỗi của luật này,
    // bỏ qua thay vì ép kiểu ẩn rồi crash trong parseFieldDateOnly.
    if (typeof raw !== "string") return false;
    const target = parseFieldDateOnly(raw);
    if (!target) return false;
    const days = countBusinessDaysBetween(now, target);
    return classifyDateLeadTime(days, f.dateLeadTimeRule.standardDays) === "blocked";
  });
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

/**
 * SLA (giờ) dùng để tính `deadlineAt` LÚC GỬI đề xuất — khi
 * `group.approverSlaEnabled` bật VÀ bước duyệt ĐẦU TIÊN (theo thứ tự cấu
 * hình, bất kể kind) có `slaHours` riêng, dùng giá trị đó thay cho
 * `group.slaHours` chung; tắt cờ hoặc bước đầu không có `slaHours` riêng →
 * dùng `group.slaHours` như hành vi cũ (tương thích ngược hoàn toàn).
 *
 * LƯU Ý PHẠM VI: đây CHỈ tính deadline 1 LẦN lúc gửi/gửi lại — KHÔNG tự động
 * tính lại deadline mới khi đề xuất chuyển sang bước duyệt tiếp theo (luồng
 * "Lần lượt" nhiều bước, mỗi bước có `slaHours` khác nhau). Việc "làm mới
 * đồng hồ đếm ngược mỗi khi sang bước mới" là 1 quyết định hành vi lớn hơn
 * (đụng `/api/requests/[id]/decision`, ảnh hưởng badge "Quá hạn" đang chạy
 * thật) — CHƯA triển khai trong change này, cần Sếp xác nhận rõ trước khi
 * làm (xem báo cáo cuối change add-base-vn-approver-and-approval-form-parity).
 */
export function resolveInitialSlaHours(group: ProposalGroup): number | null {
  if (group.approverSlaEnabled) {
    const firstStepSla = group.approverSteps[0]?.slaHours;
    if (typeof firstStepSla === "number") return firstStepSla;
  }
  return group.slaHours;
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
 * nhiều người gửi cùng lúc. Định dạng 9 chữ số (000000001... — Sếp chốt
 * 17/08/2026, mã 6 số đã cấp trước đó giữ nguyên) — nếu vượt quá 999999999
 * thì hiện nhiều hơn 9 số, vẫn duy nhất, không lỗi.
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
 * khác hay bộ đếm toàn hệ thống. Cùng định dạng 9 chữ số với generateRequestCode().
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
 * Tra `leaderId` của phòng ban người gửi — KHÔNG throw (khác resolveSubmitterManager),
 * trả `null` nếu thiếu departmentId/leaderId. Dùng cho scope=manager-bypassed
 * (chỉ cần biết ai là quản lý trực tiếp HIỆN TẠI để so sánh, không chặn gì cả).
 */
export async function resolveDirectManagerId(submitterUid: string): Promise<string | null> {
  const userSnap = await getHpcoreDb().collection("users").doc(submitterUid).get();
  const departmentId = userSnap.data()?.departmentId as string | null | undefined;
  if (!departmentId) return null;

  const deptSnap = await getHpcoreDb().collection("departments").doc(departmentId).get();
  const leaderId = deptSnap.data()?.leaderId as string | null | undefined;
  return leaderId ?? null;
}

/**
 * Xác thực 1 lựa chọn thủ công cho bước "quản lý trực tiếp" — chấp nhận BẤT
 * KỲ nhân viên hợp lệ nào trong hồ sơ app tổng (KHÔNG còn giới hạn phải là
 * managerId của memberGroups — Sếp cần chọn người KHÁC quản lý trực tiếp
 * "chính thức" duyệt thay trong 1 số trường hợp thực tế, vd nút "Chọn quản
 * lý trực tiếp" chỉ gợi ý nhanh managerId của Nhóm thành viên, nhưng gõ @
 * vẫn phải tag được BẤT KỲ ai trong toàn công ty — xem TagUserInput
 * browseAllDirectoryUrl ở submit/page.tsx). KHÔNG tin nguyên giá trị client
 * gửi, tự query lại users/{uid} để xác nhận tồn tại thật. Trả null nếu
 * không hợp lệ để nơi gọi rơi về auto-resolve như hành vi cũ.
 */
async function resolveManagerOverride(userId: string): Promise<TaggedUser | null> {
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

/**
 * Bổ sung `title` (chức danh, vd "Trưởng phòng Kỹ thuật Thi công Khối 2")
 * cho người duyệt CỐ ĐỊNH (kind "fixed") — hiển thị chức danh thay vì tên
 * suông trên form gửi đề xuất, giống Base.vn thật. `step.user` snapshot lúc
 * cấu hình không có field này nên phải tra lại users/{uid}.title tại thời
 * điểm gửi; không có/lỗi thì bỏ qua, giữ nguyên user gốc.
 */
async function withTitle(user: TaggedUser): Promise<TaggedUser> {
  try {
    const snap = await getHpcoreDb().collection("users").doc(user.id).get();
    const title = (snap.data()?.title as string | undefined)?.trim();
    return title ? { ...user, title } : user;
  } catch {
    return user;
  }
}

export interface ResolvedApproverStep {
  index: number;
  kind: ApproverStepDef["kind"];
  user: TaggedUser | null;
  error?: string;
  /** Nhãn hiển thị riêng của bước, nếu Admin đã đặt (mọi kind) — undefined nếu
   * chưa đặt, để client tự rơi về nhãn mặc định theo kind như hành vi cũ
   * (xem `approverStepDisplayName()` trong lib/approval-logic.ts). */
  name?: string;
}

/**
 * Phân giải danh sách bước duyệt của nhóm thành CHI TIẾT từng bước — "fixed"
 * giữ nguyên, "submitter_manager" ưu tiên `managerOverrides[index]` (nếu hợp
 * lệ, xem resolveManagerOverride), rồi mới auto-resolve theo phòng ban người
 * gửi. KHÔNG throw khi 1 bước lỗi — set `error` ở đúng phần tử đó, để nơi gọi
 * (preview UI) hiện được lỗi đúng vị trí thay vì lỗi chung cho cả request.
 * Bước có `condition` không thoả mãn bị lọc bỏ hoàn toàn khỏi kết quả trả về.
 *
 * `index` gán cho từng bước = vị trí trong mảng `steps` GỐC (chưa lọc điều
 * kiện), KHÔNG PHẢI vị trí trong `applicableSteps` sau lọc — cố tình, vì
 * client (submit/page.tsx) dùng `index` làm khoá lưu lựa chọn thủ công
 * (managerOverrides/extraApprovers theo từng bước). Nếu dùng vị trí sau lọc,
 * mỗi lần người gửi đổi 1 field làm điều kiện của MỘT bước khác đổi (bước đó
 * ẩn/hiện), toàn bộ bước phía sau bị dồn chỉ số → lựa chọn thủ công cũ (vốn
 * lưu theo chỉ số cũ) bị gán NHẦM sang bước khác (bug thật phát hiện qua code
 * review 18/08/2026). Chỉ số gốc không đổi dù bước khác ẩn/hiện, nên khoá
 * luôn khớp đúng 1 bước xuyên suốt cả lúc xem trước lẫn lúc gửi thật.
 */
export async function resolveApproverStepsDetailed(
  steps: ApproverStepDef[] | undefined,
  submitterUid: string,
  values: Record<string, unknown> = {},
  fields: ProposalField[] = [],
  managerOverrides: Record<number, string | string[]> = {},
): Promise<ResolvedApproverStep[]> {
  const allSteps = steps ?? [];
  const applicableSteps = filterApplicableSteps(allSteps, values, fields);
  const results: ResolvedApproverStep[] = [];

  for (const step of applicableSteps) {
    const i = allSteps.indexOf(step);

    if (step.kind === "fixed") {
      // Bước nhiều người (users) mở rộng thành nhiều phần tử kết quả cùng
      // `index` — danh sách người duyệt phẳng sẵn có + quy trình đồng thời/
      // lần lượt tự cho đúng ngữ nghĩa "TẤT CẢ phải duyệt" (Sếp chốt
      // 16/08/2026), không cần đổi lib/approval-logic.ts.
      for (const user of fixedStepUsers(step)) {
        results.push({ index: i, kind: "fixed", user: await withTitle(user), name: step.name });
      }
      continue;
    }

    if (step.kind === "flexible_approver") {
      // Bước "linh động" RỖNG (chưa gán ai) → BỎ QUA hoàn toàn khỏi kết quả,
      // KHÔNG đẩy phần tử lỗi/null nào — khác hẳn "fixed"/"submitter_manager"
      // (luôn có 1 kết quả, kể cả lỗi). Đây là hành vi cố ý (Sếp chốt), xem
      // design.md Decision #1 — không chặn gửi chỉ vì 1 bước linh động rỗng,
      // miễn còn bước khác duyệt được.
      for (const user of step.users) {
        results.push({ index: i, kind: "flexible_approver", user: await withTitle(user), name: step.name });
      }
      continue;
    }

    if (step.kind === "submitter_manager") {
      // Bước "quản lý trực tiếp" nhận được NHIỀU người từ 16/08/2026 (Sếp yêu
      // cầu thêm người cùng duyệt ngay tại hàng này trên form gửi) — người đầu
      // là quản lý được chọn, những người sau là người duyệt thêm; TẤT CẢ đều
      // phải duyệt (danh sách phẳng + quy trình đồng thời/lần lượt tự bảo đảm).
      // Vẫn xác thực TỪNG uid qua resolveManagerOverride, không tin client.
      const overrideRaw = managerOverrides[i];
      const overrideIds = Array.isArray(overrideRaw) ? overrideRaw : overrideRaw ? [overrideRaw] : [];
      const overrideUsers = (
        await Promise.all(overrideIds.map((id) => resolveManagerOverride(id)))
      ).filter((u): u is TaggedUser => u !== null);
      if (overrideUsers.length > 0) {
        for (const user of overrideUsers) {
          results.push({ index: i, kind: "submitter_manager", user, name: step.name });
        }
        continue;
      }

      try {
        const user = await resolveSubmitterManager(submitterUid);
        results.push({ index: i, kind: "submitter_manager", user, name: step.name });
      } catch (err) {
        results.push({
          index: i,
          kind: "submitter_manager",
          user: null,
          name: step.name,
          error: err instanceof Error ? err.message : "Không xác định được người duyệt.",
        });
      }
      continue;
    }

    assertNeverApproverKind(step);
  }

  return results;
}

/**
 * Phân giải danh sách bước duyệt của nhóm thành danh sách người duyệt cụ thể
 * tại thời điểm gửi đề xuất (kết quả SNAPSHOT vào đề xuất, không tự đổi nếu
 * trưởng đơn vị đổi sau này) — throw MissingApproverError khi thiếu người
 * duyệt, cộng thêm hỗ trợ managerOverrides tuỳ chọn cho bước submitter_manager.
 * Trả kèm `meta` (tên bước/SLA riêng) — gộp validate+resolve trong ĐÚNG 1 lượt
 * gọi `resolveApproverStepsDetailed()` (tránh gọi Firestore 2 lần cho cùng 1
 * lượt gửi nếu cần cả `approvers` lẫn `meta`, xem `resolveApproverSteps()` bên
 * dưới — giữ nguyên hành vi cũ, chỉ delegate sang đây).
 */
export async function resolveApproverStepsWithMeta(
  steps: ApproverStepDef[] | undefined,
  submitterUid: string,
  values: Record<string, unknown> = {},
  fields: ProposalField[] = [],
  managerOverrides: Record<number, string | string[]> = {},
): Promise<{ approvers: TaggedUser[]; meta: ApproverStepMeta[] }> {
  const allSteps = steps ?? [];
  const applicableSteps = filterApplicableSteps(allSteps, values, fields);
  if (allSteps.length > 0 && applicableSteps.length === 0) {
    throw new MissingApproverError(
      "Không xác định được người duyệt nào phù hợp điều kiện hiện tại của đề xuất này. Liên hệ admin để kiểm tra lại cấu hình người duyệt của nhóm.",
    );
  }

  const detailed = await resolveApproverStepsDetailed(steps, submitterUid, values, fields, managerOverrides);
  // Mọi bước áp dụng đều là "flexible_approver" rỗng (bị resolveApproverStepsDetailed
  // bỏ qua hoàn toàn, không đẩy phần tử nào) → không còn ai duyệt cả, dù không
  // có bước nào báo lỗi riêng lẻ. Chặn gửi ở đây, không để lọt qua thành đề
  // xuất "đã gửi" nhưng không ai duyệt được (xem design.md Decision #1 + tasks.md 1.7).
  if (applicableSteps.length > 0 && detailed.length === 0) {
    throw new MissingApproverError(
      "Nhóm này chưa có người duyệt hợp lệ — mọi bước duyệt linh động đều chưa được gán người. Liên hệ admin để cấu hình lại.",
    );
  }
  const failed = detailed.find((d) => d.error || !d.user);
  if (failed) {
    throw new MissingApproverError(failed.error ?? "Không xác định được người duyệt.");
  }
  return {
    approvers: detailed.map((d) => d.user!),
    meta: detailed.map((d) => ({
      name: d.name,
      slaHours: allSteps[d.index]?.slaHours,
      code: allSteps[d.index]?.code,
    })),
  };
}

/** Giữ nguyên chữ ký/hành vi cũ cho các nơi chỉ cần danh sách người duyệt
 * phẳng, không cần `meta` — xem `resolveApproverStepsWithMeta()`. */
export async function resolveApproverSteps(
  steps: ApproverStepDef[] | undefined,
  submitterUid: string,
  values: Record<string, unknown> = {},
  fields: ProposalField[] = [],
  managerOverrides: Record<number, string | string[]> = {},
): Promise<TaggedUser[]> {
  const { approvers } = await resolveApproverStepsWithMeta(steps, submitterUid, values, fields, managerOverrides);
  return approvers;
}
