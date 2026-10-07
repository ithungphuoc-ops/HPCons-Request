"use client";

import { useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import AnchoredPopover from "@/components/shared/AnchoredPopover";
import { filterTableColumnTypeGroups, TABLE_COLUMN_TYPE_LABELS } from "@/lib/table-field";
import type { TableColumnType } from "@/lib/types";

/**
 * Ô chọn KIỂU DỮ LIỆU của 1 cột bảng, có ô "Lọc nhanh" + chia nhóm Chữ / Số /
 * Ngày / Danh sách, kiểu đang chọn tô xanh có dấu ✓ — Sếp duyệt demo
 * 07/10/2026 ("cot-bang-them-kieu-du-lieu", theo mẫu Base). Thay cho <select>
 * thường vì danh sách đã lên 9 kiểu.
 *
 * Gõ không dấu vẫn lọc được ("ngay" ra "Ngày"). Enter chọn kiểu đầu tiên
 * đang hiện. Khung nổi vẽ qua portal để không bị khung cuộn của hộp thoại cắt
 * (xem AnchoredPopover).
 */
export default function ColumnTypePicker({
  value,
  onChange,
  ariaLabel,
  className = "",
}: {
  value: TableColumnType;
  onChange: (next: TableColumnType) => void;
  ariaLabel: string;
  className?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const groups = filterTableColumnTypeGroups(query);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const choose = (type: TableColumnType) => {
    onChange(type);
    close();
    buttonRef.current?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={TABLE_COLUMN_TYPE_LABELS[value]}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex h-[36px] items-center justify-between gap-1 rounded border border-[var(--color-border)] bg-white px-3 text-left text-[14px] text-[var(--color-text-primary)] hover:border-gray-300 focus:border-[var(--color-action-blue)] focus:outline-none ${className}`}
      >
        <span className="min-w-0 truncate">{TABLE_COLUMN_TYPE_LABELS[value]}</span>
        <ChevronDown size={14} className="shrink-0 text-gray-400" />
      </button>
      <AnchoredPopover anchorRef={buttonRef} open={open} onClose={close} minWidth={250} ariaLabel={ariaLabel}>
        <div className="relative mb-1 shrink-0">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const first = groups[0]?.types[0];
                if (first) choose(first);
              }
            }}
            placeholder="Lọc nhanh"
            aria-label="Lọc nhanh kiểu dữ liệu"
            className="h-8 w-full rounded border border-[var(--color-border)] pl-7 pr-2 text-[13px] focus:border-[var(--color-action-blue)] focus:outline-none"
          />
        </div>
        <div role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0 && <p className="px-2 py-2 text-[12.5px] text-gray-400">Không có kiểu nào khớp.</p>}
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">
                {g.label}
              </p>
              {g.types.map((t) => {
                const selected = t === value;
                return (
                  <button
                    key={t}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(t)}
                    className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left ${
                      selected ? "bg-green-50 font-semibold text-green-700" : "hover:bg-blue-50"
                    }`}
                  >
                    <span>{TABLE_COLUMN_TYPE_LABELS[t]}</span>
                    {selected && <Check size={14} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </AnchoredPopover>
    </>
  );
}
