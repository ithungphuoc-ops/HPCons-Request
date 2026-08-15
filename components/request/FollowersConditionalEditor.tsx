"use client";

import { Plus, Trash2 } from "lucide-react";
import TagUserInput from "@/components/shared/TagUserInput";
import { inputClass, selectClass } from "@/components/shared/form-styles";
import { CONDITION_ELIGIBLE_TYPES } from "@/components/request/ApproverStepsEditor";
import type { ConditionGroup, ConditionRule, ProposalField, TaggedUser } from "@/lib/types";

export type FollowersConditionalItem = { condition: ConditionGroup; users: TaggedUser[] };

/** Field kiểu số/ngày dùng toán tử ngưỡng thay vì bằng/khác/chứa — trùng
 * logic với ApproverStepsEditor.tsx (giữ đồng bộ 2 nơi khi sửa). */
const NUMERIC_OR_DATE_TYPES = new Set(["integer", "decimal", "currency", "date"]);

function operatorsForField(field: ProposalField | undefined): ConditionRule["operator"][] {
  if (field && NUMERIC_OR_DATE_TYPES.has(field.dataType)) {
    return ["equals", "not_equals", "greater_than", "less_than", "between", "is_empty", "is_not_empty"];
  }
  return ["equals", "not_equals", "includes", "not_includes", "is_empty", "is_not_empty"];
}

/** Trùng ApproverStepsEditor.tsx — operator không cần ô nhập giá trị. */
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
 * Danh sách "Người theo dõi theo điều kiện" — mỗi mục: 1 nhóm điều kiện (1
 * hoặc nhiều rule con, kết hợp AND/OR) + danh sách người được thêm làm
 * follower khi nhóm điều kiện đó thoả mãn lúc gửi chính thức. Dùng chung khái
 * niệm ConditionGroup với bước duyệt có điều kiện và field hiển thị theo điều
 * kiện (ApproverStepsEditor.tsx) — khác ở chỗ mỗi mục ở đây LUÔN có điều
 * kiện (không có checkbox bật/tắt như ConditionEditor dùng chung, vì bản
 * thân mục này chỉ tồn tại để gắn với 1 điều kiện).
 */
export default function FollowersConditionalEditor({
  value,
  onChange,
  fields,
}: {
  value: FollowersConditionalItem[];
  onChange: (items: FollowersConditionalItem[]) => void;
  fields: ProposalField[];
}) {
  const conditionFields = fields.filter((f) => f.code && CONDITION_ELIGIBLE_TYPES.has(f.dataType));

  if (conditionFields.length === 0) {
    return (
      <p className="text-[12px] text-gray-400">
        Nhóm chưa có trường phù hợp (một/nhiều lựa chọn, số, hoặc ngày) để đặt điều kiện.
      </p>
    );
  }

  const addItem = () => {
    const first = conditionFields[0];
    if (!first.code) return;
    onChange([
      ...value,
      {
        condition: { conjunction: "all", rules: [{ fieldCode: first.code, operator: operatorsForField(first)[0], value: "" }] },
        users: [],
      },
    ]);
  };

  const removeItem = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const updateCondition = (index: number, condition: ConditionGroup) => {
    onChange(value.map((item, i) => (i === index ? { ...item, condition } : item)));
  };

  const updateUsers = (index: number, users: TaggedUser[]) => {
    onChange(value.map((item, i) => (i === index ? { ...item, users } : item)));
  };

  const updateRule = (index: number, ruleIndex: number, patch: Partial<ConditionRule>) => {
    const item = value[index];
    updateCondition(index, {
      ...item.condition,
      rules: item.condition.rules.map((r, i) => (i === ruleIndex ? { ...r, ...patch } : r)),
    });
  };

  const changeRuleField = (index: number, ruleIndex: number, fieldCode: string) => {
    const field = conditionFields.find((f) => f.code === fieldCode);
    updateRule(index, ruleIndex, { fieldCode, operator: operatorsForField(field)[0], value: "", valueTo: undefined });
  };

  const addRule = (index: number) => {
    const item = value[index];
    const first = conditionFields[0];
    if (!first.code) return;
    updateCondition(index, {
      ...item.condition,
      rules: [...item.condition.rules, { fieldCode: first.code, operator: operatorsForField(first)[0], value: "" }],
    });
  };

  const removeRule = (index: number, ruleIndex: number) => {
    const item = value[index];
    if (item.condition.rules.length <= 1) return; // luôn giữ ít nhất 1 rule — xoá cả mục nếu muốn bỏ hẳn
    updateCondition(index, { ...item.condition, rules: item.condition.rules.filter((_, i) => i !== ruleIndex) });
  };

  return (
    <div className="flex flex-col gap-2.5">
      {value.length === 0 && (
        <p className="text-[12px] text-gray-400">Chưa có người theo dõi theo điều kiện nào.</p>
      )}
      {value.map((item, index) => (
        <div key={index} className="flex items-start gap-2 rounded border border-[var(--color-border)] p-2.5">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {item.condition.rules.length >= 2 && (
              <div className="flex items-center gap-1.5 text-[12px] text-gray-600">
                Kết hợp:
                <select
                  className={selectClass}
                  value={item.condition.conjunction}
                  onChange={(e) => updateCondition(index, { ...item.condition, conjunction: e.target.value as ConditionGroup["conjunction"] })}
                >
                  <option value="all">Và (tất cả đều đúng)</option>
                  <option value="any">Hoặc (chỉ cần 1 đúng)</option>
                </select>
              </div>
            )}

            {item.condition.rules.map((rule, ruleIndex) => {
              const selectedField = conditionFields.find((f) => f.code === rule.fieldCode);
              const allowedOperators = operatorsForField(selectedField);
              return (
                <div key={ruleIndex} className="flex flex-wrap items-center gap-1.5">
                  {ruleIndex === 0 && <span className="text-[12px] text-gray-500">Khi</span>}
                  <select
                    className={selectClass}
                    value={rule.fieldCode}
                    onChange={(e) => changeRuleField(index, ruleIndex, e.target.value)}
                  >
                    {conditionFields.map((f) => (
                      <option key={f.code} value={f.code}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className={selectClass}
                    value={rule.operator}
                    onChange={(e) => updateRule(index, ruleIndex, { operator: e.target.value as ConditionRule["operator"] })}
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
                      onChange={(e) => updateRule(index, ruleIndex, { value: e.target.value })}
                    />
                  )}
                  {rule.operator === "between" && (
                    <input
                      className={inputClass}
                      value={rule.valueTo ?? ""}
                      placeholder="Đến"
                      onChange={(e) => updateRule(index, ruleIndex, { valueTo: e.target.value })}
                    />
                  )}
                  {item.condition.rules.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRule(index, ruleIndex)}
                      aria-label={`Xoá điều kiện con ${ruleIndex + 1}`}
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
              onClick={() => addRule(index)}
              className="flex w-fit items-center gap-1 text-[12px] font-medium text-[var(--color-action-blue)] hover:underline"
            >
              <Plus size={12} /> Thêm điều kiện con
            </button>

            <TagUserInput
              value={item.users}
              onChange={(users) => updateUsers(index, users)}
              placeholder="Gõ @ để thêm người theo dõi khi thoả điều kiện"
            />
          </div>
          <button
            type="button"
            onClick={() => removeItem(index)}
            aria-label={`Xoá điều kiện ${index + 1}`}
            className="mt-1 shrink-0 text-gray-300 hover:text-[var(--color-danger-red)]"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addItem}
        className="flex w-fit items-center gap-1.5 text-[13px] font-medium text-[var(--color-action-blue)] hover:underline"
      >
        <Plus size={14} /> Thêm điều kiện
      </button>
    </div>
  );
}
