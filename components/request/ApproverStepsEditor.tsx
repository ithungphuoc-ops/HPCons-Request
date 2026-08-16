"use client";

import { Plus, Trash2, Users } from "lucide-react";
import TagUserInput from "@/components/shared/TagUserInput";
import { inputClass, selectClass } from "@/components/shared/form-styles";
import type { ApproverStepDef, ConditionGroup, ConditionRule, ProposalField, TaggedUser } from "@/lib/types";

/**
 * Trạng thái đang soạn của 1 bước duyệt — khác `ApproverStepDef` ở chỗ bước
 * "fixed" có thể tạm chưa chọn ai (users: []) trong lúc đang sửa form, và
 * dùng thẳng mảng `users` (1 bước nhiều người, tất cả phải duyệt — Sếp chốt
 * 16/08/2026). Dùng `toApproverSteps()` để xác thực + chuyển sang
 * `ApproverStepDef[]` thật trước khi gửi lên API. `code` giữ nguyên nếu bước
 * đã có (không cho sửa tay trong bản này — chỉ hiển thị), mất đi (undefined)
 * nếu là bước mới thêm — server sẽ tự backfill khi lưu.
 */
export type DraftApproverStep =
  | { kind: "fixed"; users: TaggedUser[]; code?: string; condition?: ConditionGroup }
  | { kind: "submitter_manager"; code?: string; condition?: ConditionGroup };

export function fromApproverSteps(steps: ApproverStepDef[]): DraftApproverStep[] {
  return steps.map((s) =>
    s.kind === "fixed"
      ? { kind: "fixed", users: s.users?.length ? s.users : [s.user], code: s.code, condition: s.condition }
      : { kind: "submitter_manager", code: s.code, condition: s.condition },
  );
}

/** null nếu còn bước "Người cố định" chưa chọn ai — chặn submit ở nơi gọi. */
export function toApproverSteps(steps: DraftApproverStep[]): ApproverStepDef[] | null {
  const result: ApproverStepDef[] = [];
  for (const step of steps) {
    if (step.kind === "submitter_manager") {
      result.push(step);
    } else {
      if (step.users.length === 0) return null;
      // Lưu CẢ user (người đầu tiên — tương thích dữ liệu/code cũ) lẫn users
      // (đủ danh sách) — xem ApproverStepDef ở lib/types.ts.
      result.push({
        kind: "fixed",
        user: step.users[0],
        users: step.users,
        code: step.code,
        condition: step.condition,
      });
    }
  }
  return result;
}

/** Field kiểu số/ngày dùng được toán tử ngưỡng (lớn hơn/nhỏ hơn/trong khoảng)
 * thay vì bằng/khác/chứa — xem operatorsForField() bên dưới. */
const NUMERIC_OR_DATE_TYPES = new Set(["integer", "decimal", "currency", "date"]);

/** Field có tập giá trị rời rạc (so sánh bằng/khác/chứa có ý nghĩa) HOẶC field
 * số/ngày (so sánh ngưỡng có ý nghĩa) mới dùng làm điều kiện được — field tự
 * do (short_text/paragraph...) không phù hợp với cả 2 kiểu so sánh. */
export const CONDITION_ELIGIBLE_TYPES = new Set([
  "single_choice",
  "multiple_choice",
  "department_select",
  "integer",
  "decimal",
  "currency",
  "date",
]);

/** Danh sách toán tử hợp lệ cho 1 field, dùng để lọc option hiển thị trong
 * select toán tử — field rời rạc giữ nguyên 3 toán tử cũ, field số/ngày đổi
 * sang bộ toán tử ngưỡng (không có "chứa" vì không phải mảng nhiều lựa chọn). */
function operatorsForField(field: ProposalField | undefined): ConditionRule["operator"][] {
  if (field && NUMERIC_OR_DATE_TYPES.has(field.dataType)) {
    return ["equals", "not_equals", "greater_than", "less_than", "between", "is_empty", "is_not_empty"];
  }
  return ["equals", "not_equals", "includes", "not_includes", "is_empty", "is_not_empty"];
}

/** Operator không cần ô nhập giá trị (field chưa điền / đã điền, không quan
 * tâm điền gì) — ẩn input "Giá trị" khi chọn 1 trong 2 toán tử này. */
const OPERATORS_WITHOUT_VALUE = new Set<ConditionRule["operator"]>(["is_empty", "is_not_empty"]);

const operatorLabels: Record<ConditionRule["operator"], string> = {
  equals: "bằng",
  not_equals: "khác",
  includes: "chứa",
  not_includes: "không chứa",
  is_empty: "rỗng (chưa điền)",
  is_not_empty: "không rỗng (đã điền)",
  greater_than: "lớn hơn",
  less_than: "nhỏ hơn",
  between: "trong khoảng",
};

/**
 * Danh sách bước duyệt của 1 nhóm — mỗi bước là "Cố định" (một người cụ thể,
 * giống nhau cho mọi đề xuất) hoặc "Quản lý phòng ban người gửi" (tự động
 * tra theo phòng ban của người gửi, khác nhau tuỳ ai gửi). Thứ tự bước quyết
 * định thứ tự duyệt khi Quy trình xử lý = "Lần lượt".
 */
export default function ApproverStepsEditor({
  value,
  onChange,
  fields = [],
}: {
  value: DraftApproverStep[];
  onChange: (steps: DraftApproverStep[]) => void;
  /** Field của nhóm dùng để chọn điều kiện — nhóm mới tạo chưa có field nào
   * thì truyền [] hoặc bỏ trống, phần "có điều kiện" tự ẩn UI chọn field. */
  fields?: ProposalField[];
}) {
  const conditionFields = fields.filter((f) => f.code && CONDITION_ELIGIBLE_TYPES.has(f.dataType));

  const addStep = () => {
    onChange([...value, { kind: "fixed", users: [] }]);
  };

  const removeStep = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const setKind = (index: number, kind: DraftApproverStep["kind"]) => {
    onChange(
      value.map((step, i) =>
        i === index
          ? kind === "submitter_manager"
            ? { kind: "submitter_manager" as const, code: step.code, condition: step.condition }
            : { kind: "fixed" as const, users: [], code: step.code, condition: step.condition }
          : step,
      ),
    );
  };

  const setFixedUsers = (index: number, users: TaggedUser[]) => {
    onChange(
      value.map((step, i) =>
        i === index ? { ...step, kind: "fixed" as const, users } : step,
      ),
    );
  };

  const setCondition = (index: number, condition: ConditionGroup | undefined) => {
    onChange(value.map((step, i) => (i === index ? { ...step, condition } : step)));
  };

  return (
    <div className="flex flex-col gap-2.5">
      {value.length === 0 && (
        <p className="text-[12px] text-gray-400">Chưa có bước duyệt nào.</p>
      )}
      {value.map((step, index) => (
        <div key={index} className="flex items-start gap-2 rounded border border-[var(--color-border)] p-2.5">
          <span className="mt-1.5 shrink-0 text-[12px] font-semibold text-gray-500">
            Bước {index + 1}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                {step.kind === "fixed" ? (
                  // Cho @tag NHIỀU người trong cùng 1 bước — TẤT CẢ đều phải
                  // duyệt mới qua bước (Sếp chốt 16/08/2026). TagUserInput vốn
                  // multi-select, truyền thẳng mảng không cắt bớt.
                  <TagUserInput
                    value={step.users}
                    onChange={(users) => setFixedUsers(index, users)}
                    placeholder="Gõ @ để thêm người duyệt (được nhiều người — tất cả phải duyệt)"
                  />
                ) : (
                  <p className="flex h-[36px] items-center gap-1.5 rounded border border-[var(--color-border)] bg-gray-50 px-3 text-[12px] text-gray-500">
                    <Users size={13} className="shrink-0" />
                    Tự động: trưởng đơn vị của người gửi (tra tại thời điểm gửi đề xuất)
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() =>
                  setKind(index, step.kind === "submitter_manager" ? "fixed" : "submitter_manager")
                }
                title="Tự động lấy quản lý trực tiếp của người gửi thay vì chọn 1 người cố định"
                className={`h-[36px] shrink-0 whitespace-nowrap rounded border px-2.5 text-[12px] font-medium ${
                  step.kind === "submitter_manager"
                    ? "border-[var(--color-action-blue)] bg-[var(--color-action-blue)]/10 text-[var(--color-action-blue)]"
                    : "border-[var(--color-border)] text-gray-600 hover:bg-gray-50"
                }`}
              >
                Quản lý trực tiếp
              </button>
            </div>

            {(step.code || step.condition) && (
              <p className="text-[11px] text-gray-400">
                {step.code && <>Mã: {step.code}</>}
                {step.code && step.condition && " · "}
                {step.condition && `${step.condition.rules.length} điều kiện`}
              </p>
            )}

            <ConditionEditor
              condition={step.condition}
              fields={conditionFields}
              onChange={(c) => setCondition(index, c)}
            />
          </div>
          <button
            type="button"
            onClick={() => removeStep(index)}
            aria-label={`Xoá bước duyệt ${index + 1}`}
            className="mt-1 shrink-0 text-gray-300 hover:text-[var(--color-danger-red)]"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addStep}
        className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-[var(--color-action-blue)] hover:underline"
      >
        <Plus size={14} /> Thêm bước duyệt
      </button>
    </div>
  );
}

/** UI bật/tắt + cấu hình "nhóm điều kiện" (1 hoặc nhiều rule con, kết hợp
 * AND/OR) cho 1 bước duyệt, 1 field hiển thị theo điều kiện, hoặc 1 người
 * theo dõi theo điều kiện — dùng lại nguyên component này ở cả 3 nơi. */
export function ConditionEditor({
  condition,
  fields,
  onChange,
}: {
  condition: ConditionGroup | undefined;
  fields: ProposalField[];
  onChange: (condition: ConditionGroup | undefined) => void;
}) {
  const enabled = condition !== undefined;

  const enable = () => {
    const first = fields[0];
    if (!first?.code) return;
    onChange({ conjunction: "all", rules: [{ fieldCode: first.code, operator: operatorsForField(first)[0], value: "" }] });
  };

  if (fields.length === 0) {
    return (
      <p className="text-[11px] text-gray-400">
        Nhóm chưa có trường phù hợp (một/nhiều lựa chọn, số, hoặc ngày) để đặt điều kiện.
      </p>
    );
  }

  const updateRule = (ruleIndex: number, patch: Partial<ConditionRule>) => {
    if (!condition) return;
    onChange({
      ...condition,
      rules: condition.rules.map((r, i) => (i === ruleIndex ? { ...r, ...patch } : r)),
    });
  };

  const changeRuleField = (ruleIndex: number, fieldCode: string) => {
    const field = fields.find((f) => f.code === fieldCode);
    const nextOperator = operatorsForField(field)[0];
    updateRule(ruleIndex, { fieldCode, operator: nextOperator, value: "", valueTo: undefined });
  };

  const addRule = () => {
    if (!condition) return;
    const first = fields[0];
    if (!first?.code) return;
    onChange({
      ...condition,
      rules: [...condition.rules, { fieldCode: first.code, operator: operatorsForField(first)[0], value: "" }],
    });
  };

  const removeRule = (ruleIndex: number) => {
    if (!condition) return;
    const nextRules = condition.rules.filter((_, i) => i !== ruleIndex);
    if (nextRules.length === 0) {
      onChange(undefined);
      return;
    }
    onChange({ ...condition, rules: nextRules });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-[12px] text-gray-600">
        <input type="checkbox" checked={enabled} onChange={(e) => (e.target.checked ? enable() : onChange(undefined))} />
        Chỉ áp dụng khi thoả điều kiện
      </label>

      {enabled && condition && (
        <div className="flex flex-col gap-1.5 pl-5">
          {condition.rules.length >= 2 && (
            <div className="flex items-center gap-1.5 text-[12px] text-gray-600">
              Kết hợp:
              <select
                className={selectClass}
                value={condition.conjunction}
                onChange={(e) => onChange({ ...condition, conjunction: e.target.value as ConditionGroup["conjunction"] })}
              >
                <option value="all">Và (tất cả đều đúng)</option>
                <option value="any">Hoặc (chỉ cần 1 đúng)</option>
              </select>
            </div>
          )}

          {condition.rules.map((rule, ruleIndex) => {
            const selectedField = fields.find((f) => f.code === rule.fieldCode);
            const allowedOperators = operatorsForField(selectedField);
            return (
              <div key={ruleIndex} className="flex flex-wrap items-center gap-1.5">
                <select
                  className={selectClass}
                  value={rule.fieldCode}
                  onChange={(e) => changeRuleField(ruleIndex, e.target.value)}
                >
                  {fields.map((f) => (
                    <option key={f.code} value={f.code}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <select
                  className={selectClass}
                  value={rule.operator}
                  onChange={(e) => updateRule(ruleIndex, { operator: e.target.value as ConditionRule["operator"] })}
                >
                  {allowedOperators.map((op) => (
                    <option key={op} value={op}>
                      {operatorLabels[op]}
                    </option>
                  ))}
                </select>
                {!OPERATORS_WITHOUT_VALUE.has(rule.operator) && (
                  <input
                    className={inputClass}
                    value={rule.value}
                    placeholder={rule.operator === "between" ? "Từ" : "Giá trị"}
                    onChange={(e) => updateRule(ruleIndex, { value: e.target.value })}
                  />
                )}
                {rule.operator === "between" && (
                  <input
                    className={inputClass}
                    value={rule.valueTo ?? ""}
                    placeholder="Đến"
                    onChange={(e) => updateRule(ruleIndex, { valueTo: e.target.value })}
                  />
                )}
                {condition.rules.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRule(ruleIndex)}
                    aria-label={`Xoá điều kiện ${ruleIndex + 1}`}
                    className="text-gray-300 hover:text-[var(--color-danger-red)]"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addRule}
            className="flex w-fit items-center gap-1 text-[12px] font-medium text-[var(--color-action-blue)] hover:underline"
          >
            <Plus size={12} /> Thêm điều kiện
          </button>
        </div>
      )}
    </div>
  );
}
