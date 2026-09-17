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
  name,
  size,
  className = "",
  fallbackClassName,
}: {
  url: string | null | undefined;
  initial: string;
  /** Tên đầy đủ của người — dùng làm alt text ảnh thật (bàn phím/trình đọc màn hình
   * mới biết đây là ảnh của ai, thay vì alt="" rỗng — phát hiện qua review CodeRabbit
   * PR #33, 17/09/2026). */
  name: string;
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
        alt={name}
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
      title={name}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${fallbackClassName} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initial}
    </span>
  );
}
