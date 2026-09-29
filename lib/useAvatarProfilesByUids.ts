"use client";

import { useEffect, useState } from "react";

export interface AvatarProfile {
  url: string | null;
  /** Chức danh thật `users/{uid}.title` — null nếu chưa được HR nhập. */
  title: string | null;
}

const EMPTY_PROFILE: AvatarProfile = { url: null, title: null };

/**
 * Ảnh đại diện + chức danh THẬT theo uid — dùng cho thẻ hover ở khung "Người
 * xét duyệt"/"Người theo dõi" trang chi tiết đề xuất (Sếp yêu cầu 29/09/2026,
 * theo mẫu Base.vn). Cache module scope như `useAvatarsByUids` — nhiều
 * component hiện cùng lúc trên 1 trang chi tiết dùng chung 1 lượt tải.
 */
const profileCache = new Map<string, AvatarProfile>();

export function useAvatarProfilesByUids(uids: string[]): Record<string, AvatarProfile> {
  const key = [...new Set(uids)].filter(Boolean).sort().join(",");
  const [, forceRerender] = useState(0);

  useEffect(() => {
    const missing = key ? key.split(",").filter((u) => !profileCache.has(u)) : [];
    if (missing.length === 0) return;
    let cancelled = false;
    fetch(`/api/directory/avatars?uids=${missing.join(",")}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: { avatars?: Record<string, string | null>; titles?: Record<string, string | null> } | null,
        ) => {
          for (const uid of missing) {
            profileCache.set(uid, {
              url: data?.avatars?.[uid] ?? null,
              title: data?.titles?.[uid] ?? null,
            });
          }
          if (!cancelled) forceRerender((n) => n + 1);
        },
      )
      .catch(() => {
        for (const uid of missing) profileCache.set(uid, EMPTY_PROFILE);
        if (!cancelled) forceRerender((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
    // `key` (chuỗi uid đã sort) đại diện đúng nội dung mảng `uids` — không cần
    // liệt kê `uids` trong deps.
  }, [key]);

  const out: Record<string, AvatarProfile> = {};
  for (const uid of key ? key.split(",") : []) out[uid] = profileCache.get(uid) ?? EMPTY_PROFILE;
  return out;
}
