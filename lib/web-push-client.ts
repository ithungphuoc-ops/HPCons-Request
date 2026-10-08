"use client";

/**
 * Phía trình duyệt của thông báo "ra màn hình" — từ 08/10/2026 việc bật/tắt + gửi đã chuyển
 * sang App Tổng (account.hpcore.vn/dashboard/thong-bao?caidat=man-hinh, 1 chỗ cho mọi app).
 *
 * App này chỉ còn DỌN đăng ký cũ: trình duyệt nào còn đăng ký trên service worker của
 * request.hpcore.vn thì tự huỷ (im lặng) + gọi DELETE /api/push/subscription để xoá bản ghi trên
 * máy chủ, 1 lần. Service worker /sw-push.js GIỮ NGUYÊN để thông báo cũ đã hiện vẫn bấm mở đúng
 * trang; nó không còn nhận thư mới.
 */

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

async function removeOnServer(sub: PushSubscription): Promise<void> {
  await fetch("/api/push/subscription", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
}

const MIGRATED_KEY = "request-push-migrated-to-apptong";

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    // Trình duyệt chặn bộ nhớ (chế độ riêng tư) — lần sau kiểm lại, vẫn rẻ (không gọi mạng nếu không có đăng ký).
  }
}

let migrating: Promise<void> | null = null;

/**
 * Chuyển sang App Tổng: máy này còn đăng ký thông báo cũ trên request.hpcore.vn → xoá bản ghi
 * máy chủ + huỷ đăng ký trình duyệt, KHÔNG hỏi gì người dùng. Chạy 1 lần/trình duyệt (cờ
 * localStorage); không có đăng ký thì chỉ đọc service worker, không gọi mạng.
 */
export function migrateLegacyPushSubscription(): Promise<void> {
  if (!isPushSupported() || readFlag(MIGRATED_KEY)) return Promise.resolve();
  migrating ??= (async () => {
    try {
      const sub = await existingSubscription();
      if (sub) {
        await removeOnServer(sub);
        await sub.unsubscribe().catch(() => false);
      }
      writeFlag(MIGRATED_KEY);
    } catch {
      // Lỗi lạ (service worker hỏng…) — lần tải trang sau thử lại.
      migrating = null;
    }
  })();
  return migrating;
}

/**
 * Đăng xuất trên máy dùng chung: gỡ đăng ký cũ (nếu còn) TRƯỚC khi xoá phiên. Tối đa 3 giây —
 * mạng chậm cũng không được giữ chân nút Đăng xuất.
 */
export async function disablePushBeforeLogout(): Promise<void> {
  if (!isPushSupported()) return;
  const work = (async () => {
    const sub = await existingSubscription();
    if (sub) {
      await removeOnServer(sub);
      await sub.unsubscribe().catch(() => false);
    }
  })().catch(() => {});
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 3000))]);
}

/** Lời nhắc "đã chuyển sang App Tổng" trong bảng chuông — khoá MỚI, để người từng ẩn lời nhắc
 * "Bật thông báo" cũ vẫn thấy thông tin chuyển chỗ 1 lần. */
const BANNER_DISMISS_KEY = "request-push-banner-apptong-dismissed";

export function isBannerDismissed(): boolean {
  return readFlag(BANNER_DISMISS_KEY);
}

export function dismissBanner(): void {
  writeFlag(BANNER_DISMISS_KEY);
}
