import "server-only";
import { adminDb } from "@/lib/firebase/admin";

/**
 * Báo cho mọi trình duyệt đang mở app biết "vừa có đề xuất thay đổi", để chuông
 * thông báo tải lại gần như ngay lập tức (lib/firebase/request-change-signal.ts).
 * Ghi vào `system/notification-signal` — CHỈ 1 mốc thời gian, KHÔNG BAO GIỜ được
 * chứa dữ liệu đề xuất (field, bình luận, tên người…), vì mọi người đã đăng nhập
 * đều đọc được tài liệu này (xem firestore.rules). Gọi SAU khi ghi `requests/{id}`
 * thành công, ở đúng những chỗ đổi `updatedAt` — gửi mới, quyết định duyệt, sửa/gửi
 * lại, bình luận, điều chỉnh sau duyệt (và duyệt điều chỉnh), thay/gỡ tệp khi duyệt.
 * Lỗi bị nuốt: đây chỉ là tín hiệu "báo nhanh" — thiếu nó, chuông vẫn tự tải lại
 * sau tối đa ~2 phút (dự phòng trong NotificationBell), không phải đường duy nhất.
 */
export async function bumpNotificationSignal(): Promise<void> {
  try {
    await adminDb.collection("system").doc("notification-signal").set({ at: new Date().toISOString() });
  } catch {
    // Nuốt lỗi có chủ ý — xem chú thích ở trên.
  }
}
