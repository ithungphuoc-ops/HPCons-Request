import type { ApproverStepDef, ConditionGroup, ConditionRule, ProposalField, TaggedUser } from "@/lib/types";

/**
 * Ép 1 giá trị field (có thể là string, number, hoặc undefined/null tuỳ
 * dataType) về number để so sánh ngưỡng — trả NaN nếu không ép được, KHÔNG
 * throw (evaluateRule coi NaN là "không thoả mãn", xem dưới).
 */
function toComparableNumber(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (raw === undefined || raw === null || raw === "") return NaN;
  return Number(raw);
}

/**
 * Ép 1 giá trị field (string ISO, timestamp, hoặc Date) về epoch ms để so
 * sánh ngưỡng ngày — trả NaN nếu không ép được (Date.parse trả NaN sẵn cho
 * chuỗi không hợp lệ, không cần try/catch riêng).
 */
function toComparableTime(raw: unknown): number {
  if (raw instanceof Date) return raw.getTime();
  if (raw === undefined || raw === null || raw === "") return NaN;
  return Date.parse(String(raw));
}

/**
 * Đánh giá 1 rule con dựa trên giá trị field của đề xuất. Field tham chiếu
 * không còn tồn tại trong nhóm (đã bị xoá/sửa mã) coi là KHÔNG thoả mãn,
 * không throw — không được để lỗi cấu hình cũ chặn cả việc gửi đề xuất, chỉ
 * ghi log cảnh báo để admin phát hiện cấu hình lệch.
 *
 * Toán tử "greater_than"/"less_than"/"between" ép kiểu số trước, nếu field
 * là kiểu `date` thì rơi xuống ép kiểu thời điểm khi ép số thất bại (NaN) —
 * đơn giản hơn là tra `field.dataType` trước khi chọn nhánh ép kiểu, và vẫn
 * đúng vì giá trị ngày lưu dạng chuỗi ISO không ép được thành số hợp lệ.
 */
function evaluateRule(rule: ConditionRule, values: Record<string, unknown>, fields: ProposalField[]): boolean {
  const field = fields.find((f) => f.code === rule.fieldCode);
  if (!field) {
    console.warn(`[conditions] Rule tham chiếu field.code "${rule.fieldCode}" không tồn tại trong nhóm — coi như không thoả mãn.`);
    return false;
  }

  const rawValue = values[field.id];

  if (rule.operator === "includes") {
    if (!Array.isArray(rawValue)) return false;
    return rawValue.some((v) => String(v) === rule.value);
  }
  if (rule.operator === "not_includes") {
    // Không phải mảng (chưa chọn gì) — coi như "không chứa" luôn đúng, nhất
    // quán với is_empty (chưa điền = không chứa giá trị nào).
    if (!Array.isArray(rawValue)) return true;
    return !rawValue.some((v) => String(v) === rule.value);
  }

  if (rule.operator === "is_empty" || rule.operator === "is_not_empty") {
    const isEmpty =
      rawValue === undefined ||
      rawValue === null ||
      rawValue === "" ||
      (Array.isArray(rawValue) && rawValue.length === 0);
    return rule.operator === "is_empty" ? isEmpty : !isEmpty;
  }

  if (rule.operator === "greater_than" || rule.operator === "less_than" || rule.operator === "between") {
    let current = toComparableNumber(rawValue);
    let bound = toComparableNumber(rule.value);
    let boundTo = rule.valueTo !== undefined ? toComparableNumber(rule.valueTo) : NaN;

    if (Number.isNaN(current) || Number.isNaN(bound) || (rule.operator === "between" && Number.isNaN(boundTo))) {
      // Thử lại bằng ép kiểu ngày (field kiểu `date` không ép số được ở trên).
      current = toComparableTime(rawValue);
      bound = toComparableTime(rule.value);
      boundTo = rule.valueTo !== undefined ? toComparableTime(rule.valueTo) : NaN;
    }

    if (Number.isNaN(current) || Number.isNaN(bound)) return false;
    if (rule.operator === "greater_than") return current > bound;
    if (rule.operator === "less_than") return current < bound;
    // between: đóng 2 đầu, cần cả cận trên hợp lệ.
    if (Number.isNaN(boundTo)) return false;
    return current >= bound && current <= boundTo;
  }

  const stringValue = rawValue === undefined || rawValue === null ? "" : String(rawValue);
  if (rule.operator === "equals") return stringValue === rule.value;
  return stringValue !== rule.value; // not_equals
}

/**
 * Đánh giá 1 nhóm điều kiện (nhiều rule con kết hợp AND/OR) — hàm dùng chung
 * cho field hiển thị theo điều kiện, bước duyệt có điều kiện, và người theo
 * dõi theo điều kiện. Nhóm rỗng (không có rule con nào) luôn thoả mãn — an
 * toàn hơn là chặn nhầm khi dữ liệu migrate lỗi.
 *
 * Cố ý KHÔNG import "server-only" (giống lib/print-template.ts) để unit test
 * gọi thẳng được qua vitest — chỉ dùng lại từ code server (lib/server/requests.ts)
 * và từ client component (app/request/groups/[groupId]/submit/page.tsx).
 */
export function evaluateConditionGroup(
  group: ConditionGroup,
  values: Record<string, unknown>,
  fields: ProposalField[],
): boolean {
  if (group.rules.length === 0) return true;
  const results = group.rules.map((rule) => evaluateRule(rule, values, fields));
  return group.conjunction === "all" ? results.every(Boolean) : results.some(Boolean);
}

/**
 * Lọc ra các bước duyệt ÁP DỤNG ĐƯỢC (không có điều kiện, hoặc nhóm điều kiện
 * thoả mãn) — tách riêng khỏi resolveApproverSteps() (lib/server/requests.ts,
 * "server-only" vì đụng Firestore) để phần logic lọc thuần tuý này test được
 * bằng vitest, theo đúng cách lib/server/print-engine.ts đã tách trước đó.
 */
export function filterApplicableSteps(
  steps: ApproverStepDef[],
  values: Record<string, unknown>,
  fields: ProposalField[],
): ApproverStepDef[] {
  return steps.filter((step) => !step.condition || evaluateConditionGroup(step.condition, values, fields));
}

/**
 * Hợp nhất 3 nguồn người theo dõi của 1 đề xuất khi gửi chính thức: danh
 * sách cố định của nhóm + người gửi tự thêm qua form + người theo dõi theo
 * điều kiện thoả mãn — loại trùng theo `id`, ưu tiên giữ bản ghi xuất hiện
 * TRƯỚC (cố định > tự thêm > theo điều kiện) khi cùng 1 người xuất hiện
 * nhiều nguồn (không ảnh hưởng kết quả cuối vì chỉ id được dùng để lọc).
 */
export function mergeFollowers(
  fixed: TaggedUser[],
  submitted: TaggedUser[],
  conditional: { condition: ConditionGroup; users: TaggedUser[] }[],
  values: Record<string, unknown>,
  fields: ProposalField[],
  /** `permissionRules.autoAddSubtaskAssigneesAsFollowers` — app này không có
   * khái niệm "công việc con" riêng, diễn giải gần nhất là field kiểu
   * "user_select" (người được CHỌN/GIAO trong đề xuất) — xem design.md của
   * change add-base-vn-approver-and-approval-form-parity, tasks.md 5.5. */
  autoAddUserSelectAssignees = false,
): TaggedUser[] {
  const fromConditions = conditional
    .filter((item) => evaluateConditionGroup(item.condition, values, fields))
    .flatMap((item) => item.users);

  const fromUserSelectFields = autoAddUserSelectAssignees
    ? fields
        .filter((f) => f.dataType === "user_select")
        .map((f) => values[f.id] as TaggedUser | null | undefined)
        .filter((u): u is TaggedUser => Boolean(u))
    : [];

  const seen = new Set<string>();
  const result: TaggedUser[] = [];
  for (const user of [...fixed, ...submitted, ...fromConditions, ...fromUserSelectFields]) {
    if (seen.has(user.id)) continue;
    seen.add(user.id);
    result.push(user);
  }
  return result;
}

/**
 * Validate mọi rule con trong 1 nhóm điều kiện tham chiếu tới field CÓ THẬT
 * trong nhóm (theo `code`) — dùng khi lưu cấu hình nhóm (API PATCH groups),
 * KHÁC với evaluateConditionGroup (dùng lúc gửi đề xuất, không throw). Trả
 * về `code` đầu tiên không hợp lệ, hoặc `null` nếu mọi rule con đều hợp lệ —
 * dùng chung cho cả 3 nơi lưu ConditionGroup (field.visibleWhen,
 * approverStep.condition, followersConditional[].condition) để tránh lặp
 * logic validate 3 lần khác nhau và bị lệch nhau (đã phát hiện lệch trước
 * khi change này viết: chỉ approverSteps được validate).
 */
export function validateConditionGroupFieldCodes(
  group: ConditionGroup | undefined,
  knownFieldCodes: Set<string>,
): string | null {
  if (!group) return null;
  for (const rule of group.rules) {
    if (!knownFieldCodes.has(rule.fieldCode)) return rule.fieldCode;
  }
  return null;
}
