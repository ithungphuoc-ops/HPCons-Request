"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { computeAutoGrowHeight } from "@/lib/auto-grow-textarea";

// Trên server không có layout → useLayoutEffect báo cảnh báo; dùng useEffect thay.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> & {
  /** Số dòng tối đa khi đang nhập — vượt thì cuộn trong ô. Mặc định 6 (Sếp chốt 07/10/2026). */
  maxRows?: number;
};

/**
 * Ô văn bản TỰ GIÃN cho cột chữ của bảng nhập liệu (Sếp duyệt demo 07/10/2026
 * "o-bang-tu-xuong-dong"): bắt đầu cao đúng 1 dòng như ô cũ, chữ dài tự xuống
 * dòng theo độ rộng cột đã cài, Enter xuống dòng ngay trong ô (Tab/bấm chuột
 * để sang ô khác — hành vi gốc của textarea), tối đa `maxRows` dòng rồi cuộn
 * bên trong ô.
 *
 * Chiều cao đo lại mỗi khi giá trị đổi, và khi độ rộng ô đổi (ResizeObserver
 * — chỉ phản ứng khi RỘNG đổi, tránh vòng lặp do chính mình đặt chiều cao).
 */
const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoGrowTextarea(
  { maxRows = 6, value, style, ...rest },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

  const resize = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const paddingY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const borderY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    el.style.height = "auto";
    const { height, scroll } = computeAutoGrowHeight({
      scrollHeight: el.scrollHeight,
      lineHeight,
      paddingY,
      borderY,
      maxRows,
    });
    el.style.height = `${height}px`;
    el.style.overflowY = scroll ? "auto" : "hidden";
  }, [maxRows]);

  useIsoLayoutEffect(() => {
    resize();
  }, [value, resize]);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resize]);

  return (
    <textarea
      ref={innerRef}
      rows={1}
      value={value}
      style={{ resize: "none", ...style }}
      {...rest}
    />
  );
});

export default AutoGrowTextarea;
