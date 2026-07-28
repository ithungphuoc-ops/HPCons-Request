"use client";

import { Plus, Trash2, Users } from "lucide-react";
import TagUserInput from "@/components/shared/TagUserInput";
import { inputClass, selectClass } from "@/components/shared/form-styles";
import type { ApproverStepDef, ConditionRule, ProposalField, TaggedUser } from "@/lib/types";

/**
 * Trạng thái đang soạn của 1 bước duyệt — khác `ApproverStepDef` ở chỗ bước
 * "fixed" có thể tạm chưa chọn người (user: null) trong lúc đang sửa form.
 * Dùng `toApproverSteps()` để xác thực + chuyển sang `ApproverStepDef[]`
 * thật trước khi gửi lên API. `code` giữ nguyên nếu bước đã có (không cho
 * sửa tay trong bản này — chỉ hiển thị), mất đi (undefined) nếu là bước mới
 * thêm — server sẽ tự backfill khi lưu.
 */
export type DraftApproverStep =
  | { kind: "fixed"; user: TaggedUser | null; code?: string; condition?: ConditionRule }
  | { kind: "submitter_manager"; code?: string; condition?: ConditionRule };

export function fromApproverSteps(steps: ApproverStepDef[]): DraftApproverStep[] {
  return steps.map((s) =>
    s.kind === "fixed"
      ? { kind: "fixed", user: s.user, code: s.code, condition: s.condition }
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
      if (!step.user) return null;
      result.push({ kind: "fixed", user: step.user, code: step.code, condition: step.condition });
    }
  }
  return result;
}

/** Chỉ field có tập giá trị rời rạc mới dùng làm điều kiện được (so sánh
 * bằng/khác/chứa có ý nghĩa) — field tự do (text/số/ngày) không phù hợp. */
export const CONDITION_ELIGIBLE_TYPES = new Set(["single_choice", "multiple_choice", "department_select"]);

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
    onChange([...value, { kind: "fixed", user: null }]);
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
            : { kind: "fixed" as const, user: null, code: step.code, condition: step.condition }
          : step,
      ),
    );
  };

  const setFixedUser = (index: number, user: TaggedUser | undefined) => {
    onChange(
      value.map((step, i) =>
        i === index ? { ...step, kind: "fixed" as const, user: user ?? null } : step,
      ),
    );
  };

  const setCondition = (index: number, condition: ConditionRule | undefined) => {
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
                  <TagUserInput
                    value={step.user ? [step.user] : []}
                    onChange={(users) => setFixedUser(index, users.slice(-1)[0])}
                    placeholder="Gõ @ để thêm người duyệt"
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
                {step.condition && "1 điều kiện"}
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

/** UI bật/tắt + cấu hình "điều kiện áp dụng" cho 1 bước duyệt (hoặc 1 mục
 * người theo dõi theo điều kiện — dùng lại nguyên component này). */
export function ConditionEditor({
  condition,
  fields,
  onChange,
}: {
  condition: ConditionRule | undefined;
  fields: ProposalField[];
  onChange: (condition: ConditionRule | undefined) => void;
}) {
  const enabled = condition !== undefined;

  const enable = () => {
    const first = fields[0];
    if (!first?.code) return;
    onChange({ fieldCode: first.code, operator: "equals", value: "" });
  };

  if (fields.length === 0) {
    return (
      <p className="text-[11px] text-gray-400">
        Nhóm chưa có trường kiểu &quot;một/nhiều lựa chọn&quot; nào để đặt điều kiện.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-[12px] text-gray-600">
        <input type="checkbox" checked={enabled} onChange={(e) => (e.target.checked ? enable() : onChange(undefined))} />
        Chỉ áp dụng khi thoả điều kiện
      </label>

      {enabled && condition && (
        <div className="flex flex-wrap items-center gap-1.5 pl-5">
          <select
            className={selectClass}
            value={condition.fieldCode}
            onChange={(e) => onChange({ ...condition, fieldCode: e.target.value })}
          >
            {fields.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
          </select>
          <select
            className={selectClass}
            value={condition.operator}
            onChange={(e) => onChange({ ...condition, operator: e.target.value as ConditionRule["operator"] })}
          >
            <option value="equals">bằng</option>
            <option value="not_equals">khác</option>
            <option value="includes">chứa</option>
          </select>
          <input
            className={inputClass}
            value={condition.value}
            placeholder="Giá trị"
            onChange={(e) => onChange({ ...condition, value: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
