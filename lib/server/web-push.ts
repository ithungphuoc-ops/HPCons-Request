import "server-only";
import { createHash } from "node:crypto";
import { adminDb } from "@/lib/firebase/admin";
import {
  normalizePushPreferences,
  PUSH_CATEGORIES,
  PUSH_CATEGORY_OF,
  type PushCategory,
  type PushPayload,
  type PushPreferences,
} from "@/lib/web-push-payload";
import { encryptPushPayload, vapidAuthorization, type PushSubscriptionKeys, type VapidConfig } from "./web-push-crypto";

/**
 * Thông báo "ra màn hình" (Web Push — cấp 3, Sếp duyệt 08/10/2026): bật lên góc màn hình
 * máy tính / màn hình khoá điện thoại kể cả khi đã đóng tab app.
 *
 * Lưu trữ (Firestore RIÊNG của app — Admin SDK, client KHÔNG đọc/ghi thẳng, xem firestore.rules):
 *  - `push-subscriptions/{uid}`                  → { prefs: {approval, mention, result}, updatedAt }
 *  - `push-subscriptions/{uid}/devices/{sha256(endpoint)}` → { endpoint, keys, userAgent, createdAt, lastUsedAt }
 *  - `push-endpoints/{sha256(endpoint)}`         → { uid } — chỉ mục ngược: 1 trình duyệt chỉ
 *    thuộc 1 người. Máy dùng chung đổi người đăng nhập rồi bấm "Bật" → gỡ khỏi người cũ, để
 *    người cũ không nhận thông báo trên máy người mới (và ngược lại).
 *
 * TẮT HOÀN TOÀN khi thiếu biến môi trường: không gửi, không lỗi, giao diện ẩn mục bật.
 */

const ROOT = "push-subscriptions";
const ENDPOINT_INDEX = "push-endpoints";
/** Gửi song song tối đa từng này người nhận — 1 sự kiện hiếm khi quá vài người, giữ CPU thấp. */
const SEND_CONCURRENCY = 4;
const SEND_TIMEOUT_MS = 10_000;
/** Chỉ ghi lại `lastUsedAt` nếu đã cũ hơn 1 ngày — đỡ 1 lượt ghi Firestore mỗi thư. */
const LAST_USED_REFRESH_MS = 24 * 3_600_000;

export function getWebPushConfig(): VapidConfig | null {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  // Apple/Google đòi `sub` là mailto: hoặc https: — sai định dạng thì mọi thư bị từ chối,
  // nên coi như CHƯA cấu hình (tắt hẳn) và cảnh báo 1 lần cho người vận hành thấy trong log.
  if (!/^(mailto:|https:)/i.test(subject)) {
    if (!warnedBadSubject) {
      warnedBadSubject = true;
      console.warn("WEB_PUSH_SUBJECT phải bắt đầu bằng mailto: hoặc https: — tạm TẮT thông báo ra màn hình.");
    }
    return null;
  }
  return { publicKey, privateKey, subject };
}

let warnedBadSubject = false;

export function endpointId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

/**
 * Máy chủ sẽ tự POST tới `endpoint` do trình duyệt gửi lên — chỉ chấp nhận tên miền của các
 * dịch vụ đẩy thật (Chrome/Edge-Chromium/Android: FCM; Firefox: Mozilla; Safari/iPhone: Apple;
 * Edge cũ: WNS). Chặn kẻ xấu đăng ký endpoint trỏ vào địa chỉ nội bộ bắt máy chủ gọi hộ (SSRF).
 */
const ALLOWED_PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_PUSH_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

export interface SubscriptionInput {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Kiểm tra dữ liệu PushSubscription.toJSON() trình duyệt gửi lên. */
export function parseSubscriptionInput(body: unknown): SubscriptionInput | null {
  const b = (body && typeof body === "object" ? body : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (!isAllowedPushEndpoint(b.endpoint)) return null;
  const p256dh = b.keys?.p256dh;
  const auth = b.keys?.auth;
  if (typeof p256dh !== "string" || typeof auth !== "string") return null;
  if (!B64URL.test(p256dh) || !B64URL.test(auth) || p256dh.length > 200 || auth.length > 100) return null;
  return { endpoint: b.endpoint, keys: { p256dh, auth } };
}

interface StoredDevice {
  endpoint: string;
  keys: PushSubscriptionKeys;
  userAgent?: string;
  createdAt?: string;
  lastUsedAt?: string;
}

function userDoc(uid: string) {
  return adminDb.collection(ROOT).doc(uid);
}

function deviceDoc(uid: string, id: string) {
  return userDoc(uid).collection("devices").doc(id);
}

/**
 * Gắn trình duyệt này cho `uid` — CHỈ gọi từ cú bấm "Bật" của chính người đó (POST). Chạy
 * trong transaction: 2 người cùng bấm trên 1 máy dùng chung không thể để lại 2 bản ghi
 * cùng endpoint (cả 2 cùng nhận thông báo của nhau).
 */
export async function saveSubscription(uid: string, sub: SubscriptionInput, userAgent: string): Promise<void> {
  const id = endpointId(sub.endpoint);
  const nowIso = new Date().toISOString();
  const indexRef = adminDb.collection(ENDPOINT_INDEX).doc(id);
  const myRef = deviceDoc(uid, id);
  await adminDb.runTransaction(async (tx) => {
    const [indexSnap, existing] = await Promise.all([tx.get(indexRef), tx.get(myRef)]);
    const previousUid = indexSnap.exists ? (indexSnap.data()?.uid as string | undefined) : undefined;
    const prev = existing.exists ? (existing.data() as StoredDevice) : undefined;
    // Đã có y hệt → không ghi lại, đỡ lượt ghi.
    if (prev && prev.keys?.p256dh === sub.keys.p256dh && prev.keys?.auth === sub.keys.auth && previousUid === uid) return;
    if (previousUid && previousUid !== uid) tx.delete(deviceDoc(previousUid, id));
    tx.set(myRef, {
      endpoint: sub.endpoint,
      keys: sub.keys,
      userAgent: userAgent.slice(0, 300),
      createdAt: prev?.createdAt ?? nowIso,
      lastUsedAt: nowIso,
    });
    tx.set(indexRef, { uid, updatedAt: nowIso });
  });
}

/** Trình duyệt này có đang được gắn cho ĐÚNG `uid` không — trang tải lại thấy máy đã có
 * đăng ký nhưng thuộc người khác (máy dùng chung) thì phải hiện "Bật trên máy này", KHÔNG
 * tự gắn lại ngầm. */
export async function isDeviceRegisteredTo(uid: string, endpoint: string): Promise<boolean> {
  const id = endpointId(endpoint);
  const [indexSnap, mine] = await Promise.all([adminDb.collection(ENDPOINT_INDEX).doc(id).get(), deviceDoc(uid, id).get()]);
  return mine.exists && indexSnap.exists && indexSnap.data()?.uid === uid;
}

export async function removeSubscription(uid: string, endpoint: string): Promise<void> {
  const id = endpointId(endpoint);
  const indexRef = adminDb.collection(ENDPOINT_INDEX).doc(id);
  const indexSnap = await indexRef.get();
  await Promise.all([
    deviceDoc(uid, id).delete(),
    indexSnap.exists && indexSnap.data()?.uid === uid ? indexRef.delete() : Promise.resolve(),
  ]);
}

export async function getPushPreferences(uid: string): Promise<PushPreferences> {
  const snap = await userDoc(uid).get();
  return normalizePushPreferences(snap.exists ? snap.data()?.prefs : undefined);
}

export async function updatePushPreferences(uid: string, patch: Partial<Record<string, unknown>>): Promise<PushPreferences> {
  const current = await getPushPreferences(uid);
  const next = { ...current };
  for (const key of PUSH_CATEGORIES) {
    if (typeof patch[key] === "boolean") next[key] = patch[key] as boolean;
  }
  await userDoc(uid).set({ prefs: next, updatedAt: new Date().toISOString() }, { merge: true });
  return next;
}

type SendResult = "ok" | "gone" | "error";

/** Gửi 1 thư tới 1 trình duyệt. 404/410 = đăng ký đã chết (gỡ app, xoá dữ liệu trình duyệt…). */
export async function sendToDevice(device: Pick<StoredDevice, "endpoint" | "keys">, payload: PushPayload, config: VapidConfig): Promise<SendResult> {
  try {
    const body = encryptPushPayload(Buffer.from(JSON.stringify(payload)), device.keys);
    const res = await fetch(device.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthorization(device.endpoint, config),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        // Máy đang tắt: dịch vụ đẩy giữ thư tối đa 1 ngày rồi bỏ — thông báo cũ hơn không còn ý nghĩa.
        TTL: "86400",
        Urgency: payload.kind === "pending_approval" || payload.kind === "adjustment_pending" ? "high" : "normal",
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      // Dịch vụ đẩy thật không chuyển hướng — gặp 3xx là bất thường, KHÔNG đi theo (tránh
      // bị dẫn sang địa chỉ khác), coi như lỗi.
      redirect: "manual",
    });
    // Không đọc nội dung trả về → huỷ luồng để giải phóng kết nối ngay.
    await res.body?.cancel().catch(() => {});
    if (res.status === 404 || res.status === 410) return "gone";
    if (!res.ok || res.status >= 300) {
      console.error(`Web Push bị dịch vụ đẩy từ chối (HTTP ${res.status}) — bỏ qua thư này.`);
      return "error";
    }
    return "ok";
  } catch (error) {
    console.error("Gửi Web Push lỗi — bỏ qua thư này:", error);
    return "error";
  }
}

async function deliver(uid: string, id: string, device: StoredDevice, payload: PushPayload, config: VapidConfig): Promise<SendResult> {
  const result = await sendToDevice(device, payload, config);
  try {
    if (result === "gone") {
      await Promise.all([deviceDoc(uid, id).delete(), adminDb.collection(ENDPOINT_INDEX).doc(id).delete()]);
    } else if (result === "ok") {
      const last = Date.parse(device.lastUsedAt ?? "");
      if (!Number.isFinite(last) || Date.now() - last > LAST_USED_REFRESH_MS) {
        await deviceDoc(uid, id).update({ lastUsedAt: new Date().toISOString() });
      }
    }
  } catch (error) {
    console.error("Cập nhật đăng ký Web Push sau khi gửi lỗi (bỏ qua):", error);
  }
  return result;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export interface PushItem {
  uid: string;
  payload: PushPayload;
  /** Chỉ gửi nếu người nhận ĐANG TẮT nhóm này — dùng cho "bình luận mới" khi người gửi đề xuất
   * cũng bị nhắc tên: bật "Nhắc tên" thì đã có thư nhắc tên, tắt thì vẫn nhận thư bình luận. */
  onlyIfDisabled?: PushCategory;
}

/**
 * Gửi thông báo của 1 SỰ KIỆN tới danh sách người nhận. Gọi trong `after()` (qua
 * lib/server/hpcore-notifications.ts) nên không làm chậm phản hồi của thao tác chính.
 *  - Không bao giờ gửi cho chính người vừa thao tác (`actorUid`).
 *  - Tôn trọng 3 công tắc của từng người.
 *  - 1 người xuất hiện 2 lần / 1 trình duyệt trùng giữa 2 người → chỉ 1 thư/trình duyệt.
 *  - Bắn rồi quên: mọi lỗi chỉ log, không ném ra ngoài.
 */
export async function sendWebPushItems(items: PushItem[], opts: { actorUid?: string } = {}): Promise<void> {
  const config = getWebPushConfig();
  if (!config || items.length === 0) return;
  try {
    const byUid = new Map<string, PushItem>();
    for (const item of items) {
      if (!item.uid || item.uid === opts.actorUid || byUid.has(item.uid)) continue;
      byUid.set(item.uid, item);
    }
    const sentDevices = new Set<string>();
    await mapLimit([...byUid.entries()], SEND_CONCURRENCY, async ([uid, item]) => {
      const { payload } = item;
      try {
        // Đọc danh sách máy TRƯỚC: đa số người chưa bật → dừng ở 1 lượt đọc, khỏi đọc công tắc.
        const devices = await userDoc(uid).collection("devices").get();
        if (devices.empty) return;
        // Bỏ bản ghi "mồ côi": chỉ mục nói trình duyệt này nay thuộc NGƯỜI KHÁC (máy dùng chung).
        const owners = await Promise.all(devices.docs.map((d) => adminDb.collection(ENDPOINT_INDEX).doc(d.id).get()));
        const ownDocs = devices.docs.filter((_, i) => !owners[i].exists || owners[i].data()?.uid === uid);
        if (ownDocs.length === 0) return;
        if (payload.kind !== "test") {
          const prefs = await getPushPreferences(uid);
          if (!prefs[PUSH_CATEGORY_OF[payload.kind]]) return;
          if (item.onlyIfDisabled && prefs[item.onlyIfDisabled]) return;
        }
        await Promise.all(
          ownDocs.map(async (d) => {
            if (sentDevices.has(d.id)) return;
            sentDevices.add(d.id);
            await deliver(uid, d.id, d.data() as StoredDevice, payload, config);
          }),
        );
      } catch (error) {
        console.error("Gửi Web Push cho 1 người nhận lỗi (bỏ qua):", error);
      }
    });
  } catch (error) {
    console.error("Gửi Web Push thất bại (không ảnh hưởng thao tác chính):", error);
  }
}

/** "Gửi thử" giới hạn 1 lần / 10 giây / người — chặn bấm liên tục làm phiền dịch vụ đẩy.
 * Lưu trong bộ nhớ từng máy chủ (Vercel có thể nhiều phiên bản) — đủ cho mục đích chống bấm nhầm. */
const TEST_INTERVAL_MS = 10_000;
const lastTestAt = new Map<string, number>();

export function allowTestPush(uid: string, now = Date.now()): boolean {
  const last = lastTestAt.get(uid);
  if (last !== undefined && now - last < TEST_INTERVAL_MS) return false;
  lastTestAt.set(uid, now);
  // Dọn bớt để Map không phình mãi.
  if (lastTestAt.size > 1000) {
    for (const [k, t] of lastTestAt) if (now - t >= TEST_INTERVAL_MS) lastTestAt.delete(k);
  }
  return true;
}

/** "Gửi thử" — chỉ tới ĐÚNG trình duyệt đang bấm, của đúng người đang đăng nhập. */
export async function sendTestPush(uid: string, endpoint: string, payload: PushPayload): Promise<SendResult | "not_found" | "disabled"> {
  const config = getWebPushConfig();
  if (!config) return "disabled";
  const id = endpointId(endpoint);
  if (!(await isDeviceRegisteredTo(uid, endpoint))) return "not_found";
  const snap = await deviceDoc(uid, id).get();
  if (!snap.exists) return "not_found";
  return deliver(uid, id, snap.data() as StoredDevice, payload, config);
}
