"use client";

import { useEffect, useState } from "react";

/**
 * Ảnh đại diện THẬT theo uid — dùng CHUNG cho mọi nơi hiển thị người ngoài
 * Trang chủ/trang chi tiết đề xuất (nơi đã có `useDirectoryAvatars` riêng
 * theo mảng đề xuất): ô gắn thẻ người (TagUserInput — quản lý trực tiếp,
 * người theo dõi, người duyệt...), tác giả bình luận, gợi ý @mention.
 *
 * Cache ở MODULE SCOPE (không phải useRef trong hook) — nhiều instance
 * TagUserInput cùng lúc trên 1 trang (vd nhiều bước duyệt, mỗi bước 1 ô)
 * dùng chung 1 lượt tải cho cùng uid, không gọi API lặp lại (Sếp yêu cầu
 * 29/09/2026: "chỗ nào có liên quan đến người có ảnh đại diện thì lấy ảnh
 * đại diện qua luôn" — áp dụng rộng khắp app, phải nhẹ cho Firestore).
 */
const avatarCache = new Map<string, string | null>();

export function useAvatarsByUids(uids: string[]): Record<string, string | null> {
  const key = [...new Set(uids)].filter(Boolean).sort().join(",");
  const [, forceRerender] = useState(0);

  useEffect(() => {
    const missing = key ? key.split(",").filter((u) => !avatarCache.has(u)) : [];
    if (missing.length === 0) return;
    let cancelled = false;
    fetch(`/api/directory/avatars?uids=${missing.join(",")}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { avatars?: Record<string, string | null> } | null) => {
        for (const uid of missing) avatarCache.set(uid, data?.avatars?.[uid] ?? null);
        if (!cancelled) forceRerender((n) => n + 1);
      })
      .catch(() => {
        for (const uid of missing) avatarCache.set(uid, null);
        if (!cancelled) forceRerender((n) => n + 1);
      });
    return () => {
      cancelled = true;
    };
    // `key` (chuỗi uid đã sort) đại diện đúng nội dung mảng `uids`, tránh chạy
    // lại vì đổi tham chiếu mảng không đổi nội dung — không cần liệt kê `uids`.
  }, [key]);

  const out: Record<string, string | null> = {};
  for (const uid of key ? key.split(",") : []) out[uid] = avatarCache.get(uid) ?? null;
  return out;
}
