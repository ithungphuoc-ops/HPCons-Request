import { useEffect, useRef, useState } from "react";
import type { RequestInstance } from "@/lib/types";

/**
 * Tải ảnh đại diện THẬT từ app tổng (users/{uid}.avatarUrl — xem
 * /api/directory/avatars) cho mọi uid xuất hiện trong 1 mảng đề xuất (người
 * gửi + người duyệt). Cache trong phiên bằng useRef — đổi mảng requests
 * (đổi scope/tab/tải lại) không tải lại uid đã biết.
 *
 * Tách ra từ app/request/list/page.tsx (14/09/2026, change
 * add-request-home-base-layout) để dùng chung với Trang chủ (/request).
 */
export function useDirectoryAvatars(requests: RequestInstance[]): Record<string, string | null> {
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  const cache = useRef(new Map<string, string | null>());

  useEffect(() => {
    const uids = new Set<string>();
    for (const r of requests) {
      uids.add(r.submittedBy.uid);
      for (const a of r.approversSnapshot) uids.add(a.id);
    }
    const missing = [...uids].filter((u) => !cache.current.has(u));
    if (missing.length === 0) {
      setAvatars(Object.fromEntries(cache.current));
      return;
    }
    fetch(`/api/directory/avatars?uids=${missing.join(",")}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { avatars?: Record<string, string | null> } | null) => {
        for (const [uid, url] of Object.entries(data?.avatars ?? {})) {
          cache.current.set(uid, url);
        }
        setAvatars(Object.fromEntries(cache.current));
      })
      .catch(() => {
        // Lỗi tải avatar không chặn danh sách — mọi người hiện chữ cái đầu.
      });
  }, [requests]);

  return avatars;
}
