"use client";

import { useState } from "react";

/**
 * Ảnh đại diện: ưu tiên ảnh THẬT từ hồ sơ app tổng (users/{uid}.avatarUrl —
 * xem /api/directory/avatars), lỗi tải/chưa có ảnh thì rơi về vòng tròn chữ
 * cái đầu — không bao giờ hiện ô ảnh vỡ.
 *
 * Tách ra từ app/request/list/page.tsx (14/09/2026, change
 * add-request-home-base-layout) để dùng chung với Trang chủ (/request).
 */
export default function Avatar({
  url,
  initial,
  size,
  className = "",
  fallbackClassName,
}: {
  url: string | null | undefined;
  initial: string;
  size: number;
  className?: string;
  /** class cho vòng tròn chữ cái (màu nền/chữ tuỳ ngữ cảnh: xanh, xám...). */
  fallbackClassName: string;
}) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- ảnh R2 ngoài domain, kích thước nhỏ, không cần next/image
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${fallbackClassName} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initial}
    </span>
  );
}
