"use client";

import { signInWithCustomToken } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseFirestore } from "@/lib/firebase/client";

/**
 * Tín hiệu "có đề xuất vừa thay đổi" cho chuông thông báo — nghe ĐÚNG 1 tài liệu
 * rỗng `system/notification-signal` (chỉ có 1 mốc thời gian, KHÔNG chứa dữ liệu đề
 * xuất nào — xem lib/server/notification-signal.ts và firestore.rules). Ai gửi đề
 * xuất, duyệt, trả lại, bình luận… đều ghi tài liệu này → tín hiệu bắn trong vài
 * giây → chuông tải lại danh sách qua `/api/notifications` (route đó mới là nơi
 * kiểm quyền xem từng đề xuất, xem lib/server/notification-feed.ts).
 *
 * 🔴 Bản đầu (06/10/2026) nghe THẲNG document `requests` có `updatedAt` mới nhất —
 * QA phát hiện cách đó phát tán NGUYÊN NỘI DUNG đề xuất (giá trị field, bình luận,
 * ai đã xem) tới MỌI người đã đăng nhập, kể cả người không có quyền xem đề xuất đó.
 * Đừng quay lại cách đó.
 *
 * Chi phí: 1 lượt đọc khi bắt đầu nghe + 1 lượt mỗi lần có thay đổi. Xem trang chi
 * tiết (`viewedAt`) KHÔNG đổi `updatedAt`/tài liệu tín hiệu nên không làm chuông
 * người khác báo lại. Đăng nhập Firebase "ẩn" bằng custom token, cùng cách
 * CommentSection. Lỗi (mất mạng, chưa cấu hình Firebase phía trình duyệt…) → gọi
 * `onError`, chuông vẫn chạy bằng các đường tải lại khác (mở chuông, quay lại tab,
 * 2 phút/lần).
 */
export function listenRequestChanges(onChange: () => void, onError?: () => void): () => void {
  let unsubscribe: () => void = () => {};
  let stopped = false;
  (async () => {
    try {
      const auth = getFirebaseAuth();
      if (!auth.currentUser) {
        const res = await fetch("/api/auth/firebase-token", { method: "POST" });
        if (!res.ok) throw new Error("token");
        const { token } = (await res.json()) as { token: string };
        await signInWithCustomToken(auth, token);
      }
      if (stopped) return;
      const signalDoc = doc(getFirebaseFirestore(), "system", "notification-signal");
      let first = true;
      unsubscribe = onSnapshot(
        signalDoc,
        (snap) => {
          // Lần đầu chỉ là trạng thái hiện tại; bản ghi chờ ghi của chính máy này bỏ qua.
          if (first) {
            first = false;
            return;
          }
          if (!snap.metadata.hasPendingWrites) onChange();
        },
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
