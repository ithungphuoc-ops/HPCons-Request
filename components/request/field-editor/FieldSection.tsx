"use client";

import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Bộ khung dùng chung cho MỌI hộp Thêm/Sửa trường dữ liệu (Sếp duyệt demo
 * "hop-sua-truong-mau-chung" 05/10/2026): 1 kích thước cố định, các khối có
 * viền + số thứ tự tròn, khối "Tùy chọn nâng cao" thu gọn kèm chip mục đang bật.
 * Chỉ là giao diện — không chứa logic lưu/validate nào.
 */

/** Độ rộng cố định cho mọi hộp sửa trường (Modal tự co theo maxWidth trên màn nhỏ). */
export const FIELD_EDITOR_MODAL_WIDTH = 960;

function SectionNumber({ index }: { index: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--color-action-blue)] text-[12px] font-semibold text-white"
    >
      {index}
    </span>
  );
}

/** Khối có khung, luôn mở (vd ① Thông tin cơ bản, ② Cấu hình theo loại). */
export function FieldSection({
  index,
  title,
  subtitle,
  children,
}: {
  index: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[var(--color-border)]">
      <h3 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 py-2.5 text-[14.5px] font-semibold text-[var(--color-text-primary)]">
        <SectionNumber index={index} />
        <span>{title}</span>
        {subtitle && <span className="text-[13px] font-normal text-[var(--color-text-secondary)]">— {subtitle}</span>}
      </h3>
      <div className="flex flex-col gap-4 border-t border-[var(--color-border)] px-3.5 pb-3.5 pt-3">{children}</div>
    </section>
  );
}

/**
 * Khối "Tùy chọn nâng cao": bấm tiêu đề để mở/đóng. Khi đóng vẫn thấy được
 * mục nào đang bật qua chip ở tiêu đề. Nội dung chỉ ẩn đi (không
 * gỡ khỏi DOM) để `aria-controls` luôn trỏ đúng phần tử.
 */
export function AdvancedSection({
  index,
  id,
  open,
  onToggle,
  activeLabels,
  hasError,
  children,
}: {
  index: number;
  /** id của phần nội dung — dùng cho aria-controls. */
  id: string;
  open: boolean;
  onToggle: () => void;
  /** Tên các mục đang bật — hiện thành chip ở tiêu đề. */
  activeLabels: string[];
  /** Có lỗi validate nằm trong khối — báo ở tiêu đề phòng khi đang đóng. */
  hasError?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-[var(--color-border)]">
      <h3 className="text-[14.5px] font-semibold text-[var(--color-text-primary)]">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full items-center gap-2.5 rounded-[10px] px-3.5 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-white/5"
        >
          <SectionNumber index={index} />
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span>Tùy chọn nâng cao</span>
            <span className="flex flex-wrap gap-1.5 font-medium">
              {activeLabels.length > 0 ? (
                activeLabels.map((label) => (
                  <span
                    key={label}
                    className={`rounded-full px-2.5 py-px text-[12px] font-semibold ${
                      label.includes("(chưa xong")
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                        : "bg-[var(--color-category-header-bg)] text-[var(--color-category-header-text)]"
                    }`}
                  >
                    {label}
                  </span>
                ))
              ) : (
                <span className="rounded-full border border-[var(--color-border)] bg-gray-50 px-2.5 py-px text-[12px] text-[var(--color-text-secondary)] dark:bg-white/5">
                  Chưa bật mục nào
                </span>
              )}
              {hasError && (
                <span className="rounded-full bg-red-50 px-2.5 py-px text-[12px] font-semibold text-[var(--color-danger-red)] dark:bg-red-500/10">
                  Có lỗi cần sửa
                </span>
              )}
            </span>
          </span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`shrink-0 text-[var(--color-text-secondary)] transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
      </h3>
      <div
        id={id}
        hidden={!open}
        // `hidden` thuộc tính + class `hidden` cùng lúc: class `flex` có thể đè
        // display:none của thuộc tính `hidden` (thứ tự CSS Tailwind) nên đổi class theo `open`.
        className={`${open ? "flex" : "hidden"} flex-col gap-4 border-t border-[var(--color-border)] px-3.5 pb-3.5 pt-3`}
      >
        {children}
      </div>
    </section>
  );
}

/** Hàng nhãn–ô nhập: điện thoại nhãn nằm TRÊN ô nhập, từ sm trở lên nằm cạnh. */
export function FieldRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <div className="shrink-0 sm:w-[160px] sm:pt-1.5">
        <p className="text-[14px] font-medium text-gray-700">
          {label}
          {required && <span className="ml-0.5 text-[var(--color-danger-red)]">*</span>}
        </p>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
