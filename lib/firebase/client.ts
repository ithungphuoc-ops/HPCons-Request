import { initializeApp, getApps, getApp, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  type Auth,
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

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
 * định khởi tạo cho popup/redirect resolver dù không dùng tới. Đo Lighthouse
 * mobile trên lần vào đầu tiên (chưa có phiên lưu sẵn): LCP 5.6s -> xem demo
 * tong-quan-demo/base-request-app/an-chuoi-xac-thuc-mobile-2026-10-09.
 */

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;

function getFirebaseApp() {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export function getFirebaseAuth(): Auth {
  if (authInstance) return authInstance;
  const app = getFirebaseApp();
  try {
    authInstance = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: undefined,
    });
  } catch {
    // Da duoc khoi tao truoc do (vd Fast Refresh, nhieu lan import) -> dung lai instance co san
    authInstance = getAuth(app);
  }
  return authInstance;
}

export function getFirebaseFirestore(): Firestore {
  dbInstance ??= getFirestore(getFirebaseApp());
  return dbInstance;
}
