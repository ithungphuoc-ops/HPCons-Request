import "server-only";
import { getHpcoreDb } from "@/lib/hpcore";
import type { EmailNotifyCategory, NotificationCategory, NotificationEmailByGroup, NotificationSettings } from "@/lib/types";

const ALL_CATEGORIES: NotificationCategory[] = [
  "approver_pending",
  "own_decided",
  "mentioned",
  "following",
  "manager_bypassed",
  "approver_followup",
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

/** Công tắc email THEO TỪNG NHÓM của 1 user — lưu trên cùng users/{uid},
 * TÁCH field riêng `notificationEmailByGroup` (không lẫn vào `notificationSettings`
 * ở trên vì khác cấu trúc: nested theo groupId, không phải cờ phẳng). */
export async function getEmailPreferencesByGroup(uid: string): Promise<NotificationEmailByGroup> {
  const snap = await getHpcoreDb().collection("users").doc(uid).get();
  return (snap.data()?.notificationEmailByGroup ?? {}) as NotificationEmailByGroup;
}

export async function updateEmailPreferenceByGroup(
  uid: string,
  groupId: string,
  category: EmailNotifyCategory,
  enabled: boolean,
): Promise<void> {
  // ⚠️ KHÁC update(): set(..., {merge:true}) KHÔNG tự hiểu key dạng chuỗi có
  // dấu chấm là đường dẫn lồng — đã tự kiểm chứng bằng dữ liệu Firestore
  // thật (đọc lại document sau khi ghi: field vẫn `undefined`), chỉ đoán
  // theo trực giác lúc đầu là SAI. Phải dựng đúng object LỒNG NHAU thật —
  // merge:true khi đó mới gộp đúng vào đúng nhánh, không xoá mất cấu hình
  // nhóm/loại khác user đã chỉnh trước đó, ĐỒNG THỜI tự tạo document
  // users/{uid} nếu chưa tồn tại (update() thì ném lỗi NOT_FOUND khi thiếu
  // document — phát hiện thật lúc kiểm bằng Playwright với tài khoản
  // dev-owner giả lập, hiếm gặp với tài khoản thật nhưng vẫn nên vá cho chắc).
  await getHpcoreDb()
    .collection("users")
    .doc(uid)
    .set({ notificationEmailByGroup: { [groupId]: { [category]: enabled } } }, { merge: true });
}
