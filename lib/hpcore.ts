import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * SSO với app tổng (account.hpcore.vn) — xem
 * openspec/changes/add-core-request-flow-and-hpcore-sso/design.md.
 * base-request-app không tự đăng nhập: chỉ xác minh cookie phiên chung
 * "session" (domain .hpcore.vn) bằng service account của project
 * hpcons-portal. App Admin SDK tên "hpcore" TÁCH RIÊNG khỏi app mặc định
 * của chính app này (Firestore nghiệp vụ, xem lib/firebase/admin.ts).
 */

const APP_NAME = "hpcore";
export const SSO_COOKIE_NAME = "session";
const HPCORE_LOGIN_URL = "https://account.hpcore.vn/login";

function loadCred(): object {
  const raw = process.env.HPCORE_FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      "Thiếu HPCORE_FIREBASE_SERVICE_ACCOUNT (service account project hpcons-portal).",
    );
  }
  return JSON.parse(raw);
}

function getHpcoreApp(): App {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;
  return initializeApp(
    { credential: cert(loadCred() as Parameters<typeof cert>[0]) },
    APP_NAME,
  );
}

const g = globalThis as unknown as { __hpcoreAuth?: Auth; __hpcoreDb?: Firestore };

export function getHpcoreAuth(): Auth {
  return (g.__hpcoreAuth ??= getAuth(getHpcoreApp()));
}

/** Firestore của app tổng — đọc users/{uid} (vai trò toàn cục + họ tên) */
export function getHpcoreDb(): Firestore {
  return (g.__hpcoreDb ??= getFirestore(getHpcoreApp()));
}

/** URL đăng nhập app tổng kèm đường quay lại (chỉ *.hpcore.vn) */
export function hpcoreLoginUrl(returnTo: string): string {
  return `${HPCORE_LOGIN_URL}?next=${encodeURIComponent(returnTo)}`;
}

export interface HpcoreIdentity {
  uid: string;
  email: string;
}

/**
 * Cache ngắn hạn cho kết quả xác minh phiên — chỉ dùng cho những nơi ĐỌC dữ
 * liệu thông thường (xem `verifyHpcore`). Đo thật 10/10/2026 trên production:
 * `verifySessionCookie(cookie, true)` (checkRevoked) một mình tốn ~0.43s mỗi
 * lần — gọi mạng thật sang Google (Identity Toolkit `accounts:lookup`),
 * KHÔNG đụng Firestore, không ảnh hưởng lượt đọc/ghi dữ liệu đề xuất.
 *
 * QUAN TRỌNG — cache KHÔNG được kéo dài hạn cookie thật: mỗi mục cache lưu
 * kèm `exp` thật lấy từ JWT đã giải mã; `isFresh()` luôn kiểm tra cả cửa sổ
 * 60s LẪN hạn thật, dùng số nhỏ hơn — token hết hạn giữa cửa sổ 60s thì bị
 * coi là hết hạn ngay, không "ăn theo" cache.
 *
 * Giới hạn đã biết (Sếp cần biết trước khi đánh giá hiệu quả): cache này
 * nằm trong bộ nhớ của 1 tiến trình (instance) Next.js — đo thật cho thấy
 * nhiều request gửi ĐỒNG THỜI (vd lúc tải 1 trang) thường rơi vào NHIỀU
 * instance Vercel khác nhau (xác nhận qua header `x-vercel-id` khác nhau ở
 * 5/5 request đồng thời), nên cache này không gom được các lượt gọi đồng
 * thời đó — nó giúp cho các lượt gọi TUẦN TỰ (vd chuyển trang sau đó, hoặc
 * nhiều component tái render) rơi vào lại đúng instance vừa xác minh xong.
 * Phần "gọi trùng cùng lúc" được xử lý ở phía trình duyệt (xem
 * lib/useCurrentSession.ts — gộp 8 nơi gọi độc lập thành 1 Context dùng
 * chung) vì đó mới là chỗ chặn được tận gốc.
 */
interface CachedVerification {
  identity: HpcoreIdentity;
  /** Mốc hết hạn THẬT của cookie (ms, từ decoded.exp) — không bao giờ phục vụ cache qua mốc này. */
  tokenExpiresAtMs: number;
  /** Mốc cache hết hạn theo cửa sổ 60s. */
  cacheExpiresAtMs: number;
}

const CACHE_TTL_MS = 60_000;
const verifyCache = new Map<string, CachedVerification>();
const inFlight = new Map<string, Promise<HpcoreIdentity | null>>();

function isFresh(entry: CachedVerification, nowMs: number): boolean {
  return nowMs < entry.cacheExpiresAtMs && nowMs < entry.tokenExpiresAtMs;
}

async function verifyHpcoreLive(cookie: string): Promise<HpcoreIdentity | null> {
  try {
    const decoded = await getHpcoreAuth().verifySessionCookie(cookie, true);
    const email = (decoded.email ?? "").trim().toLowerCase();
    if (!email) {
      verifyCache.delete(cookie);
      return null;
    }
    const identity: HpcoreIdentity = { uid: decoded.uid, email };
    const now = Date.now();
    verifyCache.set(cookie, {
      identity,
      tokenExpiresAtMs: decoded.exp * 1000,
      cacheExpiresAtMs: now + CACHE_TTL_MS,
    });
    return identity;
  } catch {
    verifyCache.delete(cookie);
    return null;
  }
}

export interface VerifyHpcoreOptions {
  /**
   * `true` (mặc định) — LUÔN xác minh thu hồi mới, không dùng cache. Dùng
   * cho MỌI thao tác duyệt/từ chối, đổi quyền, cấu hình nhóm, hoặc đọc dữ
   * liệu nhạy cảm (vd `scope=system` — toàn bộ đề xuất kể cả đã xoá).
   *
   * `false` — cho phép dùng cache tới 60s, chỉ dùng cho những route ĐỌC
   * thông thường, tần suất cao (vd `/api/session`, danh sách đề xuất hàng
   * ngày, danh sách nhóm) — xem các route đã bật cờ này để biết danh sách
   * đầy đủ, KHÔNG tự ý thêm route mới vào danh sách "đọc thường" mà không
   * cân nhắc lại.
   */
  fresh?: boolean;
}

/** Xác minh cookie phiên app tổng → { uid, email } hoặc null */
export async function verifyHpcore(
  cookie: string | undefined,
  options: VerifyHpcoreOptions = {},
): Promise<HpcoreIdentity | null> {
  if (!cookie) return null;
  const fresh = options.fresh ?? true;

  if (!fresh) {
    const cached = verifyCache.get(cookie);
    if (cached && isFresh(cached, Date.now())) return cached.identity;
  }

  if (!fresh) {
    const existing = inFlight.get(cookie);
    if (existing) return existing;
  }

  const promise = verifyHpcoreLive(cookie).finally(() => inFlight.delete(cookie));
  if (!fresh) inFlight.set(cookie, promise);
  return promise;
}
