import "server-only";
import { getHpcoreDb } from "@/lib/hpcore";
import type { NotificationCategory, NotificationSettings } from "@/lib/types";

const ALL_CATEGORIES: NotificationCategory[] = [
  "approver_pending",
  "own_decided",
  "mentioned",
  "following",
  "manager_bypassed",
];

/**
 * Cài đặt thông báo của 1 user, lưu trực tiếp trên users/{uid}.notificationSettings
 * của app tổng (hpcore) — không phải collection riêng, giống cách
 * users.settings.delegation đã làm ở HPcons-booking. Thiếu field/khoá = coi
 * như bật (true), để user cũ chưa từng cấu hình không mất thông báo nào.
 */
export async function getNotificationSettings(uid: string): Promise<NotificationSettings> {
  const snap = await getHpcoreDb().collection("users").doc(uid).get();
  const stored = (snap.data()?.notificationSettings ?? {}) as Partial<NotificationSettings>;
  return ALL_CATEGORIES.reduce((acc, key) => {
    acc[key] = stored[key] !== false;
    return acc;
  }, {} as NotificationSettings);
}

export async function updateNotificationSettings(
  uid: string,
  patch: Partial<NotificationSettings>,
): Promise<void> {
  // Dùng update() với dot-path cho từng khoá (không set() cả object) để chỉ
  // ghi đè đúng khoá được gửi lên, không xoá mất các khoá khác user đã cấu
  // hình trước đó trong notificationSettings.
  const update: Record<string, boolean> = {};
  for (const key of ALL_CATEGORIES) {
    if (typeof patch[key] === "boolean") update[`notificationSettings.${key}`] = patch[key];
  }
  if (Object.keys(update).length === 0) return;
  await getHpcoreDb().collection("users").doc(uid).update(update);
}
