"use client";

import type { PushPreferences } from "@/lib/web-push-payload";

/**
 * Phía trình duyệt của thông báo "ra màn hình" (Web Push — cấp 3, 08/10/2026).
 * Không chạy gì tự động khi tải trang: chỉ khi người dùng mở Cài đặt thông báo / bảng chuông.
 * `Notification.requestPermission()` CHỈ gọi từ 1 cú bấm (trình duyệt chặn/khó chịu nếu tự hỏi).
 */

const SW_URL = "/sw-push.js";

export interface PushServerState {
  enabled: boolean;
  publicKey?: string;
  prefs?: PushPreferences;
}

export type PushDeviceStatus =
  | "unsupported" // trình duyệt không có Push API
  | "ios_needs_home_screen" // iPhone/iPad Safari chưa "Thêm vào MH chính"
  | "denied" // người dùng đã bấm Chặn
  | "subscribed" // đã bật trên máy này
  | "not_subscribed"; // chưa bật

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ tự xưng là Mac — phân biệt bằng màn hình cảm ứng.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Máy chủ có bật tính năng không + khoá công khai + 3 công tắc. Gom 1 lượt gọi/phiên trang. */
let serverStatePromise: Promise<PushServerState> | null = null;
export function fetchPushServerState(force = false): Promise<PushServerState> {
  if (!serverStatePromise || force) {
    serverStatePromise = fetch("/api/push/preferences")
      .then((res) => (res.ok ? (res.json() as Promise<PushServerState>) : { enabled: false }))
      .catch(() => ({ enabled: false }));
  }
  return serverStatePromise;
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function getDeviceStatus(): Promise<{ status: PushDeviceStatus; subscription: PushSubscription | null }> {
  if (!isPushSupported()) {
    return { status: isIos() && !isStandalone() ? "ios_needs_home_screen" : "unsupported", subscription: null };
  }
  if (Notification.permission === "denied") return { status: "denied", subscription: null };
  try {
    const sub = Notification.permission === "granted" ? await existingSubscription() : null;
    return { status: sub ? "subscribed" : "not_subscribed", subscription: sub };
  } catch {
    return { status: "not_subscribed", subscription: null };
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function postSubscription(sub: PushSubscription): Promise<void> {
  const res = await fetch("/api/push/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(json?.error || "Không lưu được đăng ký thông báo.");
  }
}

/** Gọi TỪ CÚ BẤM "Bật trên máy này". Trả trạng thái mới. */
export async function enablePushOnThisDevice(publicKey: string): Promise<PushDeviceStatus> {
  if (!isPushSupported()) return isIos() && !isStandalone() ? "ios_needs_home_screen" : "unsupported";
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "not_subscribed";
  const reg = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // Đăng ký cũ tạo bằng khoá VAPID khác (đổi khoá trên máy chủ) → huỷ để tạo lại đúng khoá.
  const wanted = urlBase64ToUint8Array(publicKey);
  const currentKey = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
  if (sub && currentKey && (currentKey.length !== wanted.length || currentKey.some((b, i) => b !== wanted[i]))) {
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
  await postSubscription(sub);
  return "subscribed";
}

/** Máy đã bật từ trước → báo lại máy chủ (phòng khi máy chủ đã xoá do hết hạn). Máy chủ
 * bỏ qua nếu đã có y hệt, nên gần như không tốn lượt ghi. */
export async function resyncSubscription(sub: PushSubscription): Promise<void> {
  await postSubscription(sub).catch(() => {});
}

export async function disablePushOnThisDevice(sub: PushSubscription): Promise<void> {
  await fetch("/api/push/subscription", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => false);
}

export async function sendTestPushToThisDevice(sub: PushSubscription): Promise<string | null> {
  const res = await fetch("/api/push/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  });
  if (res.ok) return null;
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  return json?.error || "Gửi thử không thành công.";
}

export async function savePushPreferences(patch: Partial<PushPreferences>): Promise<PushPreferences | null> {
  const res = await fetch("/api/push/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { prefs?: PushPreferences };
  if (json.prefs && serverStatePromise) {
    const prefs = json.prefs;
    serverStatePromise = serverStatePromise.then((s) => ({ ...s, prefs }));
  }
  return json.prefs ?? null;
}

const BANNER_DISMISS_KEY = "request-push-banner-dismissed";

export function isBannerDismissed(): boolean {
  try {
    return window.localStorage.getItem(BANNER_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissBanner(): void {
  try {
    window.localStorage.setItem(BANNER_DISMISS_KEY, "1");
  } catch {
    // Trình duyệt chặn bộ nhớ (chế độ riêng tư) — chỉ ẩn trong phiên này.
  }
}
