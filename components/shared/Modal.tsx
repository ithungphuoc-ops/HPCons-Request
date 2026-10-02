"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";

interface ModalProps {
  title: string;
  width?: number;
  /** "fill": gần kín màn hình (rộng tối đa 1400px, cao ~94% màn hình), phần nội dung
   * không tự cuộn/không đệm — dành cho trình xem tệp tự lo cuộn bên trong (xem trước
   * PDF/Excel/Word ở FilePreviewModal, Sếp chốt 02/10/2026). Bỏ qua `width`. */
  size?: "default" | "fill";
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export default function Modal({ title, width = 760, size = "default", onClose, footer, children }: ModalProps) {
  const fill = size === "fill";
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="animate-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6"
      onMouseDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`animate-modal-pop flex w-full flex-col overflow-hidden rounded-[3px] bg-[var(--color-card-bg)] shadow-2xl ${
          fill ? "" : "max-h-[88vh]"
        }`}
        style={fill ? { maxWidth: "min(1400px, 96vw)", height: "min(94vh, calc(100vh - 3rem))" } : { maxWidth: width }}
      >
        <div className="flex h-[48px] shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-gray-50 px-5 dark:bg-white/5">
          <h2
            className={`text-[15px] font-semibold uppercase tracking-wide text-[var(--color-text-primary)] ${
              fill ? "min-w-0 truncate pr-3" : ""
            }`}
            title={fill ? title : undefined}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200"
          >
            <X size={18} />
          </button>
        </div>

        {fill ? (
          <div className="flex min-h-0 flex-1 flex-col px-4 py-3">{children}</div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        )}

        {footer && (
          <div className="flex shrink-0 gap-3 border-t border-[var(--color-border)] px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
