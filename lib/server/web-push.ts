import "server-only";
import { createHash } from "node:crypto";
import { adminDb } from "@/lib/firebase/admin";

/**
 * PHẦN CÒN LẠI của thông báo "ra màn hình" tự gửi tại chỗ (PR #95/#96) — ĐÃ NGỪNG GỬI từ
 * 08/10/2026: việc gửi chuyển sang App Tổng (lib/server/push-dispatch.ts), người dùng bật lại
 * 1 lần ở account.hpcore.vn/dashboard/thong-bao?caidat=man-hinh cho mọi app.
 *
 * Chỉ giữ việc GỠ đăng ký cũ: trình duyệt còn đăng ký trên service worker của request.hpcore.vn
 * tự huỷ + gọi DELETE /api/push/subscription (lib/web-push-client.ts) để xoá bản ghi trên máy chủ.
 * Dữ liệu cũ `push-subscriptions/*`, `push-endpoints/*` sẽ dọn sau — KHÔNG xoá hàng loạt ở đây.
 * Không còn đọc biến WEB_PUSH_* (đặt hay bỏ đều không ảnh hưởng).
 */

const ROOT = "push-subscriptions";
const ENDPOINT_INDEX = "push-endpoints";

function deviceDoc(uid: string, id: string) {
  return adminDb.collection(ROOT).doc(uid).collection("devices").doc(id);
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

export async function removeSubscription(uid: string, endpoint: string): Promise<void> {
  const id = endpointId(endpoint);
  const indexRef = adminDb.collection(ENDPOINT_INDEX).doc(id);
  const indexSnap = await indexRef.get();
  await Promise.all([
    deviceDoc(uid, id).delete(),
    indexSnap.exists && indexSnap.data()?.uid === uid ? indexRef.delete() : Promise.resolve(),
  ]);
}
