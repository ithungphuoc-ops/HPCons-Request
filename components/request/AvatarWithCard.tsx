"use client";

import type { CSSProperties } from "react";
import Avatar from "@/components/request/Avatar";
import type { AvatarProfile } from "@/lib/useAvatarProfilesByUids";

/**
 * Ảnh đại diện + thẻ thông tin khi hover/focus (tên, @username, chức danh) —
 * theo mẫu Base.vn Sếp gửi, đổi màu/bố cục theo ngôn ngữ thiết kế hiện có
 * (thẻ tối màu, không copy nguyên nền đen chữ trắng của Base.vn). Dùng cho
 * "Người xét duyệt"/"Người theo dõi" ở trang chi tiết đề xuất (29/09/2026).
 *
 * `kind === "group"` (nhóm/phòng ban theo dõi): không có ảnh/chức danh thật,
 * thẻ chỉ hiện tên + nhãn "Nhóm/phòng ban".
 */
export default function AvatarWithCard({
  name,
  username,
  avatarInitial,
  kind,
  profile,
  size,
  fallbackClassName,
  avatarClassName = "",
  className = "",
  style,
}: {
  name: string;
  username: string;
  avatarInitial: string;
  kind?: "user" | "group";
  profile: AvatarProfile;
  size: number;
  fallbackClassName: string;
  /** class riêng cho ảnh/vòng tròn (vd viền trắng chồng lên khi xếp cạnh nhau) — khác `className` (dùng cho khung ngoài, vd margin chồng khoảng cách). */
  avatarClassName?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const isGroup = kind === "group";

  return (
    <span className={`group/avatar relative inline-flex ${className}`} style={style} tabIndex={0}>
      <Avatar
        url={isGroup ? null : profile.url}
        initial={avatarInitial}
        name={name}
        size={size}
        fallbackClassName={fallbackClassName}
        className={avatarClassName}
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2.5 w-[220px] -translate-x-1/2 translate-y-1 rounded-lg bg-gray-900 px-3.5 py-3 text-white opacity-0 shadow-xl transition-all duration-150 group-hover/avatar:translate-y-0 group-hover/avatar:opacity-100 group-focus-within/avatar:translate-y-0 group-focus-within/avatar:opacity-100 after:absolute after:left-1/2 after:top-full after:-translate-x-1/2 after:border-[6px] after:border-transparent after:border-t-gray-900"
      >
        <span className="block truncate text-[13.5px] font-semibold leading-tight">{name}</span>
        <span className="block text-[11.5px] text-gray-400">
          {isGroup ? "Nhóm/phòng ban" : `@${username}`}
        </span>
        {!isGroup && profile.title && (
          <span className="mt-1.5 block border-t border-white/10 pt-1.5 text-[11.5px] leading-snug text-gray-300">
            {profile.title}
          </span>
        )}
      </span>
    </span>
  );
}
