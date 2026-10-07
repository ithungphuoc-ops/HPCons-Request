"use client";

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import AnchoredPopover from "@/components/shared/AnchoredPopover";
import { joinMultiChoiceCell, splitMultiChoiceCell } from "@/lib/table-field";

/**
 * Ô bảng kiểu "Danh sách (nhiều lựa chọn)" — Sếp duyệt demo 07/10/2026.
 * Nút hiện các phương án đã chọn dạng thẻ; bấm mở khung có ô tick từng
 * phương án (bấm lại để bỏ). Khung nổi vẽ qua portal (AnchoredPopover) để
 * không bị khung cuộn ngang của bảng cắt, dùng được trên điện thoại.
 *
 * Giá trị đẩy lên vẫn là CHUỖI như mọi ô khác: các phương án nối ", " theo
 * thứ tự admin khai (`joinMultiChoiceCell`). Phương án cũ không còn trong
 * danh sách vẫn hiện (thẻ đỏ) và bỏ tick được, không lặng lẽ mất.
 */
export default function MultiChoiceCellInput({
  value,
  options,
  columnName,
  invalid,
  onCommit,
}: {
  value: string;
  options: string[];
  columnName: string;
  invalid: boolean;
  onCommit: (next: string) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = splitMultiChoiceCell(value);
  const unknown = selected.filter((s) => !options.includes(s));
  const choices = [...options, ...unknown];

  const toggle = (option: string) => {
    const next = selected.includes(option) ? selected.filter((s) => s !== option) : [...selected, option];
    onCommit(joinMultiChoiceCell(next, options));
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={columnName}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={invalid ? `"${columnName}" chỉ được chọn các phương án trong danh sách` : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-9 w-full items-center gap-1 rounded border px-2 py-1 text-left text-[14px] focus:border-[var(--color-action-blue)] focus:outline-none ${
          invalid
            ? "border-[var(--color-danger-red)] bg-red-50"
            : "border-transparent hover:border-[var(--color-border)] hover:bg-white"
        }`}
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {selected.length === 0 ? (
            <span className="text-gray-400">— Chọn —</span>
          ) : (
            selected.map((s) => (
              <span
                key={s}
                className={`max-w-full truncate rounded-full px-2 text-[12.5px] leading-5 ${
                  options.includes(s)
                    ? "bg-blue-50 text-[var(--color-action-blue)]"
                    : "bg-red-50 text-[var(--color-danger-red)]"
                }`}
              >
                {s}
              </span>
            ))
          )}
        </span>
        <ChevronDown size={14} className="shrink-0 text-gray-400" />
      </button>
      <AnchoredPopover
        anchorRef={buttonRef}
        open={open}
        onClose={() => setOpen(false)}
        minWidth={200}
        maxHeight={280}
        ariaLabel={`Chọn ${columnName}`}
      >
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label={`Phương án ${columnName}`}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {choices.length === 0 && (
            <p className="px-2 py-2 text-[12.5px] text-gray-400">Cột này chưa có phương án nào.</p>
          )}
          {choices.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-[14px] hover:bg-gray-50"
            >
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0"
                checked={selected.includes(option)}
                onChange={() => toggle(option)}
              />
              <span className={options.includes(option) ? "" : "text-[var(--color-danger-red)]"}>
                {option}
                {!options.includes(option) && " (không có trong danh sách)"}
              </span>
            </label>
          ))}
        </div>
      </AnchoredPopover>
    </>
  );
}
