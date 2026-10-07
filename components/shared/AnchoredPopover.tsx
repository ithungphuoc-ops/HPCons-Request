"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

const VIEWPORT_MARGIN = 8;
const GAP = 4;

/**
 * Khung nổi bám theo 1 nút (ô chọn kiểu cột, ô chọn nhiều phương án...) —
 * vẽ ra `document.body` bằng portal + `position: fixed` (07/10/2026).
 *
 * Vì sao không dùng `position: absolute` như DatePicker: ô chọn nằm TRONG
 * khung cuộn của hộp thoại sửa trường (Modal: `overflow-y-auto`) và trong
 * bảng nhập (`overflow-x-auto`) — khung absolute bị chính khung cuộn đó cắt
 * mất phần thò ra ngoài. Portal thoát hẳn khỏi khung cuộn.
 *
 * - Mặc định mở xuống dưới nút; không đủ chỗ thì lật lên trên; luôn kẹp
 *   trong màn hình (điện thoại 390px không bị tràn ngang).
 * - Esc đóng khung (bắt ở pha capture trên `window` và chặn lan tiếp, để Esc
 *   KHÔNG đóng luôn cả hộp thoại bên dưới — Modal nghe Esc trên `window`).
 * - Bấm ra ngoài (ngoài nút và ngoài khung) thì đóng.
 * - Cuộn/đổi cỡ màn hình thì tính lại vị trí.
 */
export default function AnchoredPopover({
  anchorRef,
  open,
  onClose,
  children,
  minWidth = 0,
  maxHeight = 320,
  ariaLabel,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Rộng tối thiểu (px); mặc định bằng nút. */
  minWidth?: number;
  maxHeight?: number;
  ariaLabel?: string;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(rect.width, minWidth), vw - VIEWPORT_MARGIN * 2);
      const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), vw - VIEWPORT_MARGIN - width);
      const spaceBelow = vh - rect.bottom - GAP - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - GAP - VIEWPORT_MARGIN;
      const openUp = spaceBelow < Math.min(maxHeight, 200) && spaceAbove > spaceBelow;
      const height = Math.max(120, Math.min(maxHeight, openUp ? spaceAbove : spaceBelow));
      setStyle(
        openUp
          ? {
              position: "fixed",
              left,
              width,
              maxHeight: height,
              bottom: vh - rect.top + GAP,
            }
          : {
              position: "fixed",
              left,
              width,
              maxHeight: height,
              top: rect.bottom + GAP,
            },
      );
    };
    place();
    window.addEventListener("resize", place);
    // capture: bắt cả cuộn của khung cuộn con (hộp thoại, bảng), không chỉ trang.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchorRef, minWidth, maxHeight]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      onCloseRef.current();
      anchorRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, anchorRef]);

  if (!open || !style || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={ariaLabel}
      style={style}
      // z-[60]: trên Modal (z-50).
      className="z-[60] flex flex-col overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-card-bg,#fff)] p-1.5 text-[13px] text-gray-800 shadow-xl"
    >
      {children}
    </div>,
    document.body,
  );
}
