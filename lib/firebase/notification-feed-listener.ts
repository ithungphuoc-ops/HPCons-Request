"use client";

import { signInWithCustomToken } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseFirestore } from "@/lib/firebase/client";
import { NOTIFICATION_FEED_COLLECTION, type StoredNotificationFeed } from "@/lib/notification-feed";

/**
 * Chuông "cấp 2" (Sếp duyệt 08/10/2026): nghe ĐÚNG 1 tài liệu `notification-feed/{uid}`
 * của chính người đang đăng nhập — máy chủ tính sẵn và ghi lại mỗi khi có sự kiện liên
 * quan tới người đó (lib/server/notification-feed.ts). Không còn tài liệu tín hiệu chung
 * `system/notification-signal` (mọi sự kiện làm MỌI tab gọi /api/notifications) — đừng
 * quay lại cách đó, cũng đừng nghe thẳng `requests` (rò nội dung đề xuất, QA 06/10/2026).
 *
 * Rules chỉ cho đọc tài liệu có id = `request.auth.uid` (firestore.rules), nên phải chắc
 * Firebase Auth phía trình duyệt đang là ĐÚNG người của phiên SSO: Firebase nhớ đăng nhập
 * lâu (IndexedDB) — máy dùng chung, người trước đăng xuất SSO, người sau đăng nhập thì
 * `currentUser` vẫn là người trước. Vì vậy lệch uid là xin token mới và đăng nhập lại.
 *
 * Chi phí: 1 lượt đọc khi bắt đầu nghe + 1 lượt mỗi lần tài liệu của CHÍNH MÌNH đổi.
 * `onData(null)` = chưa có tài liệu (người dùng chưa từng được tính) → chuông gọi GET.
 */
export function listenMyNotificationFeed(
  uid: string,
  onData: (feed: StoredNotificationFeed | null) => void,
  onError?: () => void,
): () => void {
  let unsubscribe: () => void = () => {};
  let stopped = false;
  (async () => {
    try {
      const auth = getFirebaseAuth();
      if (auth.currentUser?.uid !== uid) {
        const res = await fetch("/api/auth/firebase-token", { method: "POST" });
        if (!res.ok) throw new Error("token");
        const { token } = (await res.json()) as { token: string };
        await signInWithCustomToken(auth, token);
        // Token do máy chủ ký theo uid của phiên — vẫn lệch nghĩa là phiên SSO vừa đổi
        // người; không nghe (rules cũng sẽ chặn), để chuông dùng GET.
        if (auth.currentUser?.uid !== uid) throw new Error("uid");
      }
      if (stopped) return;
      const ref = doc(getFirebaseFirestore(), NOTIFICATION_FEED_COLLECTION, uid);
      unsubscribe = onSnapshot(
        ref,
        (snap) => onData(snap.exists() ? (snap.data() as StoredNotificationFeed) : null),
        () => onError?.(),
      );
    } catch {
      onError?.();
    }
  })();
  return () => {
    stopped = true;
    unsubscribe();
  };
}
