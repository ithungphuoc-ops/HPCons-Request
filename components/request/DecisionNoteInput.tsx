"use client";

import { textareaClass } from "@/components/shared/form-styles";
import type { DecisionNoteMode } from "@/lib/decision-note";

/**
 * Ô ghi chú dùng chung cho các hộp xác nhận duyệt — hiện theo "Ý kiến khi
 * phê duyệt" của nhóm (lib/decision-note.ts): "hidden" → không render gì,
 * "optional" → nhãn "(không bắt buộc)", "required" → dấu * đỏ. Việc chặn để
 * trống do hộp thoại cha làm (server vẫn kiểm lại).
 */
export default function DecisionNoteInput({
  mode,
  label,
  value,
  onChange,
  invalid,
  rows = 3,
  autoFocus,
  placeholder = "Nhập ý kiến...",
}: {
  mode: DecisionNoteMode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  rows?: number;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  if (mode === "hidden") return null;
  return (
    <div>
      <label className="mb-1 block text-[14px] font-medium text-gray-700">
        {label}{" "}
        {mode === "required" ? (
          <span className="text-[var(--color-danger-red)]">*</span>
        ) : (
          <span className="text-[12px] font-normal text-gray-400">(không bắt buộc)</span>
        )}
      </label>
      <textarea
        className={`${textareaClass} ${invalid ? "!border-[var(--color-danger-red)]" : ""}`}
        rows={rows}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
      />
    </div>
  );
}
