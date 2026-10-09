import type { FirebaseApp, FirebaseOptions } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";

/**
 * Firebase Client SDK cho project riêng của base-request-app ("hpcons-request")
 * — dùng CHỈ để nghe real-time (`onSnapshot`) trên `requests/{id}`, không thay
 * thế đăng nhập SSO hiện có. Đăng nhập Firebase Auth phía trình duyệt là "ẩn"
 * (custom token từ /api/auth/firebase-token), không hiện màn hình đăng nhập
 * nào khác — xem design.md của change add-comment-mentions-realtime.
 *
 * Dùng `initializeAuth` (thay vì `getAuth`) với `popupRedirectResolver:
 * undefined` vì app này KHÔNG BAO GIỜ dùng signInWithPopup/signInWithRedirect
 * (đã rà toàn repo, không có chỗ nào gọi) — bỏ được việc SDK tự tải iframe
 * "ẩn" (~93KB script + 1 vòng round-trip xác thực iframe) mà `getAuth()` mặc
 * định khởi tạo cho popup/redirect resolver dù không dùng tới.
 *
 * TOÀN BỘ module `firebase/app`, `firebase/auth`, `firebase/firestore` được
 * tải bằng `import()` ĐỘNG (không `import` tĩnh ở đầu file) — đo thật trên
 * production 09/10/2026 cho thấy dù đã bỏ iframe thừa, riêng việc Firebase
 * SDK (~100KB) nằm trong gói JS tải ngay từ đầu (cùng lúc với React/Next.js)
 * vẫn chiếm phần lớn trong ~4.5s đầu trước khi trang hiện được gì — real-time
 * (chuông, bình luận) vốn đã là "có thì tốt, lỗi thì thôi" (xem comment ở
 * ensureFirebaseSignedIn), nên tải SAU khi trang chính đã hiện xong là hợp
 * lý. Xem demo tong-quan-demo/base-request-app/an-chuoi-xac-thuc-mobile-2026-10-09.
 */

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let appPromise: Promise<FirebaseApp> | undefined;
let authPromise: Promise<Auth> | undefined;
let dbPromise: Promise<Firestore> | undefined;
let signInPromise: Promise<void> | undefined;

function getFirebaseApp(): Promise<FirebaseApp> {
  appPromise ??= import("firebase/app").then(({ initializeApp, getApps, getApp }) =>
    getApps().length ? getApp() : initializeApp(firebaseConfig),
  );
  return appPromise;
}

export function getFirebaseAuth(): Promise<Auth> {
  authPromise ??= (async () => {
    const [app, { getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence }] =
      await Promise.all([getFirebaseApp(), import("firebase/auth")]);
    try {
      return initializeAuth(app, {
        persistence: [indexedDBLocalPersistence, browserLocalPersistence],
        popupRedirectResolver: undefined,
      });
    } catch {
      // Da duoc khoi tao truoc do (vd Fast Refresh, nhieu lan import) -> dung lai instance co san
      return getAuth(app);
    }
  })();
  return authPromise;
}

export function getFirebaseFirestore(): Promise<Firestore> {
  dbPromise ??= (async () => {
    const [app, { getFirestore }] = await Promise.all([getFirebaseApp(), import("firebase/firestore")]);
    return getFirestore(app);
  })();
  return dbPromise;
}

/**
 * Đăng nhập Firebase "ẩn" bằng custom token (server xác minh session SSO) —
 * dùng chung cho mọi nơi cần nghe real-time (chuông thông báo, bình luận).
 * Gom 1 chỗ để tránh lặp code + tránh 2 nơi cùng mint token/sign-in song song
 * nếu cả hai mount gần như cùng lúc (vd mở thẳng trang chi tiết đề xuất).
 */
export function ensureFirebaseSignedIn(): Promise<void> {
  signInPromise ??= (async () => {
    try {
      const [auth, { signInWithCustomToken }] = await Promise.all([getFirebaseAuth(), import("firebase/auth")]);
      // Chờ Firebase khôi phục phiên đã nhớ (IndexedDB) rồi mới kiểm tra —
      // kiểm tra ngay thì `currentUser` luôn null lúc mới tải trang, mỗi lần
      // mở trang lại xin token mới dù đã đăng nhập từ trước (cùng cách vá ở
      // notification-feed-listener.ts).
      await auth.authStateReady();
      if (auth.currentUser) return;
      const res = await fetch("/api/auth/firebase-token", { method: "POST" });
      if (!res.ok) throw new Error("token");
      const { token } = (await res.json()) as { token: string };
      await signInWithCustomToken(auth, token);
    } finally {
      signInPromise = undefined;
    }
  })();
  return signInPromise;
}
