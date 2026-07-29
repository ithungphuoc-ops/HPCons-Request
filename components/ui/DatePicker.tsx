'use client'

import { useEffect, useRef, useState } from 'react'

interface DatePickerProps {
  /** Định dạng YYYY-MM-DD (giống input type="date"), rỗng nếu chưa chọn. */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']

function parseIso(value: string): Date | null {
  if (!value) return null
  const d = new Date(value + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function formatDisplay(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/**
 * Ô chọn ngày tự viết (29/07/2026) — thay cho <input type="date"> gốc trình
 * duyệt. Bấm BẤT KỲ ĐÂU trong ô đều mở lịch (khác input gốc: có trình duyệt
 * chỉ mở lịch khi bấm đúng icon nhỏ ở cuối). Không gõ tay được, không phụ
 * thuộc thư viện ngoài.
 *
 * LƯU Ý: không hỗ trợ thuộc tính `required` kiểu HTML gốc — nơi gọi tự kiểm
 * tra value rỗng trước khi submit như code cũ đã làm.
 */
export default function DatePicker({ value, onChange, placeholder = 'Bấm để chọn ngày', className, disabled }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = parseIso(value)
  const [viewMonth, setViewMonth] = useState(() => {
    const base = selected ?? new Date()
    return new Date(base.getFullYear(), base.getMonth(), 1)
  })
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selected) setViewMonth(new Date(selected.getFullYear(), selected.getMonth(), 1))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7 // 0 = Thứ 2

  const cells: (number | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  function isSelected(day: number): boolean {
    return !!selected && selected.getFullYear() === year && selected.getMonth() === month && selected.getDate() === day
  }

  function isToday(day: number): boolean {
    const now = new Date()
    return now.getFullYear() === year && now.getMonth() === month && now.getDate() === day
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={
          className ??
          'h-[36px] w-full rounded border border-[var(--color-border)] px-3 text-left text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-action-blue)] disabled:opacity-50 disabled:cursor-not-allowed'
        }
      >
        {selected ? <span>{formatDisplay(selected)}</span> : <span className="text-gray-400">{placeholder}</span>}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
              aria-label="Tháng trước"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-gray-700">
              Tháng {month + 1}/{year}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
              aria-label="Tháng sau"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-gray-400 mb-1">
            {WEEKDAYS.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) =>
              day === null ? (
                <div key={i} />
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onChange(toIso(year, month, day))
                    setOpen(false)
                  }}
                  className={`text-xs py-1.5 rounded-lg transition-colors ${
                    isSelected(day)
                      ? 'bg-blue-600 text-white hover:bg-blue-600'
                      : isToday(day)
                        ? 'text-blue-600 font-semibold hover:bg-blue-50'
                        : 'text-gray-700 hover:bg-blue-50'
                  }`}
                >
                  {day}
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  )
}
