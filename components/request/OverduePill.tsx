"use client";

import { useEffect, useRef, useState } from "react";
import { overduePillInfo } from "@/lib/request-overdue";
import type { RequestInstance } from "@/lib/types";

/**
 * Nhãn đỏ "⏰ Trễ …" đặt ngay sau cụm avatar người duyệt (xem quy tắc ở
 * lib/request-overdue.ts). Rê chuột / focus bàn phím / chạm (điện thoại) hiện
 * hộp nhỏ: hạn duyệt (giờ VN) + người đang giữ.
 *
 * Hộp chi tiết dùng `position: fixed` theo toạ độ nhãn — vì cả bảng danh sách
 * (overflow-x-auto) lẫn khung Trang chủ (overflow-hidden) đều cắt mất phần
 * tử `absolute` tràn ra ngoài khung.
 *
 * Nhãn nằm TRONG dòng có thể bấm để mở đề xuất → chặn click/phím nổi bọt lên
 * dòng (Enter/Space trên nhãn chỉ bật/tắt hộp chi tiết, không mở đề xuất).
 */
export default function OverduePill({ request, now }: { request: RequestInstance; now: number }) {
  const info = overduePillInfo(request, now);
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Giữ hộp trong màn hình hẹp (390px): hộp tối đa 260px, chừa lề 8px.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 268));
    setPos({ left, top: r.bottom + 6 });
  };
  const hide = () => setPos(null);

  // Cuộn/đổi cỡ cửa sổ thì toạ độ fixed không còn đúng → đóng hộp.
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  if (!info) return null;
  const fullText = [info.label, info.deadlineText, info.waitingText].filter(Boolean).join(" · ");

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={fullText}
        title={fullText}
        aria-expanded={pos !== null}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          // Chỉ MỞ, không bật/tắt: trên điện thoại 1 lần chạm sinh liền
          // mouseenter → focus → click, bật/tắt sẽ đóng ngay hộp vừa mở.
          // Đóng bằng chạm ra ngoài (blur), rời chuột, cuộn hoặc Esc.
          e.stopPropagation();
          show();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") hide();
        }}
        className="inline-flex shrink-0 cursor-default items-center gap-1 whitespace-nowrap rounded-full bg-red-50 px-2 py-0.5 text-[12px] font-bold leading-[18px] text-[var(--color-danger-red)] dark:bg-red-500/10"
      >
        <span aria-hidden="true">⏰</span>
        {info.label}
      </button>
      {pos && (
        <span
          role="tooltip"
          style={{ left: pos.left, top: pos.top }}
          className="pointer-events-none fixed z-50 max-w-[260px] rounded-lg bg-gray-900 px-2.5 py-2 text-left text-[12px] font-normal leading-[18px] text-white shadow-lg"
        >
          <span className="block">{info.deadlineText}</span>
          {info.waitingText && <span className="block">{info.waitingText}</span>}
        </span>
      )}
    </>
  );
}
