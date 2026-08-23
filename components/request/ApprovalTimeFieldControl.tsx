"use client";

import { inputClass, selectClass, textareaClass } from "@/components/shared/form-styles";
import { isApprovalTimeValueMissing } from "@/lib/approval-logic";
import type { ApprovalTimeField } from "@/lib/types";

export { isApprovalTimeValueMissing };

/**
 * Ô nhập giá trị cho 1 "Mẫu form phê duyệt" — hiện ngay trong hộp thoại quyết
 * định (Chấp thuận/Từ chối/Chuyển tiếp) khi có field khớp đúng (bước × hành
 * động) của người đang xử lý. Chỉ hỗ trợ các loại dữ liệu đã cho phép tạo ở
 * `ApprovalTimeFieldModal.tsx` (short_text/paragraph/integer/decimal/currency/
 * date/datetime/single_choice/multiple_choice).
 */
export default function ApprovalTimeFieldControl({
  field,
  value,
  onChange,
}: {
  field: ApprovalTimeField["field"];
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const label = (
    <label className="mb-1 block text-[13px] font-medium text-gray-700">
      {field.name}
      {field.required && <span className="ml-0.5 text-[var(--color-danger-red)]">*</span>}
    </label>
  );

  if (field.dataType === "paragraph") {
    return (
      <div>
        {label}
        <textarea
          className={textareaClass}
          rows={3}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (field.dataType === "integer" || field.dataType === "decimal" || field.dataType === "currency") {
    return (
      <div>
        {label}
        <input
          type="number"
          step={field.dataType === "integer" ? 1 : "any"}
          className={inputClass}
          value={typeof value === "number" ? value : (value as string | undefined) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      </div>
    );
  }

  if (field.dataType === "date" || field.dataType === "datetime") {
    return (
      <div>
        {label}
        <input
          type={field.dataType === "date" ? "date" : "datetime-local"}
          className={inputClass}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (field.dataType === "single_choice") {
    return (
      <div>
        {label}
        <select className={selectClass} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Chọn —</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.dataType === "multiple_choice") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div>
        {label}
        <div className="flex flex-col gap-1.5 rounded border border-[var(--color-border)] p-2">
          {(field.options ?? []).map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-[13px] text-gray-700">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(opt);
                  else next.delete(opt);
                  onChange(Array.from(next));
                }}
              />
              {opt}
            </label>
          ))}
        </div>
      </div>
    );
  }

  // short_text và mặc định
  return (
    <div>
      {label}
      <input
        className={inputClass}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
