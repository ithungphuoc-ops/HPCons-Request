import "server-only";
import { createHash } from "node:crypto";
import { adminDb } from "@/lib/firebase/admin";
import {
  normalizePushPreferences,
  PUSH_CATEGORIES,
  PUSH_CATEGORY_OF,
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
  return { publicKey, privateKey, subject };
}

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

export async function saveSubscription(uid: string, sub: SubscriptionInput, userAgent: string): Promise<void> {
  const id = endpointId(sub.endpoint);
  const nowIso = new Date().toISOString();
  const indexRef = adminDb.collection(ENDPOINT_INDEX).doc(id);
  const [indexSnap, existing] = await Promise.all([indexRef.get(), deviceDoc(uid, id).get()]);
  const previousUid = indexSnap.exists ? (indexSnap.data()?.uid as string | undefined) : undefined;
  if (previousUid && previousUid !== uid) {
    await deviceDoc(previousUid, id).delete();
  }
  const prev = existing.exists ? (existing.data() as StoredDevice) : undefined;
  // Đã có y hệt (mở lại trang Cài đặt) → không ghi lại, đỡ lượt ghi.
  if (prev && prev.keys?.p256dh === sub.keys.p256dh && prev.keys?.auth === sub.keys.auth && previousUid === uid) return;
  await Promise.all([
    deviceDoc(uid, id).set({
      endpoint: sub.endpoint,
      keys: sub.keys,
      userAgent: userAgent.slice(0, 300),
      createdAt: prev?.createdAt ?? nowIso,
      lastUsedAt: nowIso,
    }),
    indexRef.set({ uid, updatedAt: nowIso }),
  ]);
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

export async function updatePushPreferences(uid: string, patch: Record<string, unknown>): Promise<PushPreferences> {
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
    });
    if (res.status === 404 || res.status === 410) return "gone";
    if (!res.ok) {
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
    const byUid = new Map<string, PushPayload>();
    for (const item of items) {
      if (!item.uid || item.uid === opts.actorUid || byUid.has(item.uid)) continue;
      byUid.set(item.uid, item.payload);
    }
    const sentDevices = new Set<string>();
    await mapLimit([...byUid.entries()], SEND_CONCURRENCY, async ([uid, payload]) => {
      try {
        // Đọc danh sách máy TRƯỚC: đa số người chưa bật → dừng ở 1 lượt đọc, khỏi đọc công tắc.
        const devices = await userDoc(uid).collection("devices").get();
        if (devices.empty) return;
        if (payload.kind !== "test") {
          const prefs = await getPushPreferences(uid);
          if (!prefs[PUSH_CATEGORY_OF[payload.kind]]) return;
        }
        await Promise.all(
          devices.docs.map(async (d) => {
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

/** "Gửi thử" — chỉ tới ĐÚNG trình duyệt đang bấm, của đúng người đang đăng nhập. */
export async function sendTestPush(uid: string, endpoint: string, payload: PushPayload): Promise<SendResult | "not_found" | "disabled"> {
  const config = getWebPushConfig();
  if (!config) return "disabled";
  const id = endpointId(endpoint);
  const snap = await deviceDoc(uid, id).get();
  if (!snap.exists) return "not_found";
  return deliver(uid, id, snap.data() as StoredDevice, payload, config);
}
