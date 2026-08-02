import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * App Admin SDK MẶC ĐỊNH của base-request-app (Firestore nghiệp vụ: groups,
 * categories, requests) — TÁCH RIÊNG khỏi app "hpcore" dùng để xác minh SSO
 * (xem lib/hpcore.ts), project Firebase khác nhau. Khởi tạo lười (proxy) để
 * `next build` không crash khi chưa có credential thật trong .env.local.
 */

let app: App | undefined;

function getAdminApp(): App {
  if (app) return app;
  const existing = getApps().find((a) => a.name === "[DEFAULT]");
  if (existing) {
    app = existing;
    return app;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return app;
}

function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const real = resolve();
      const value = Reflect.get(real as object, prop);
      return typeof value === "function" ? value.bind(real) : value;
    },
  });
}

let firestoreInstance: Firestore | undefined;

function getAdminFirestore(): Firestore {
  if (!firestoreInstance) {
    firestoreInstance = getFirestore(getAdminApp());
    try {
      firestoreInstance.settings({ ignoreUndefinedProperties: true });
    } catch (err) {
      // Next.js dev-mode hot-reload nạp lại module này (reset biến module-level
      // firestoreInstance/app) trong khi app "[DEFAULT]" của SDK vẫn còn sống
      // từ trước (registry toàn cục không reset theo) — getFirestore() trả về
      // ĐÚNG instance cũ đã settings() rồi, gọi lại chỉ ném lỗi vô hại, bỏ qua
      // để không crash cả request. Lỗi khác thật sự thì vẫn ném lại như cũ.
      if (!(err instanceof Error) || !err.message.includes("already been initialized")) {
        throw err;
      }
    }
  }
  return firestoreInstance;
}

export const adminDb: Firestore = lazyProxy(getAdminFirestore);

let authInstance: Auth | undefined;

function getAdminAuthInstance(): Auth {
  return (authInstance ??= getAuth(getAdminApp()));
}

/**
 * Auth Admin SDK của CHÍNH project base-request-app (không phải "hpcore") —
 * dùng để mint custom token cho cầu nối real-time (Firestore Client SDK),
 * xem app/api/auth/firebase-token/route.ts và design.md của change
 * add-comment-mentions-realtime.
 */
export const adminAuth: Auth = lazyProxy(getAdminAuthInstance);
