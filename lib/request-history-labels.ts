/**
 * Tiền tố `RequestHistoryEntry.action` dùng để đếm "lần thứ mấy" cho khu vực
 * "Bổ sung sau duyệt" — xem design.md của change add-post-approval-supplement,
 * Decision 5. Tách file riêng (không khai báo trực tiếp trong route.ts) vì cả
 * server (API route ghi history) LẪN client (`RequestDetailView.tsx` đếm lại
 * để hiển thị nhãn "lần N") đều cần đúng 1 giá trị này — route.ts có import
 * `adminDb` (server-only), không import được thẳng vào client component.
 *
 * Đổi 2 chuỗi này ảnh hưởng ngược tới số lần đã đếm của MỌI đề xuất cũ —
 * không đổi tuỳ tiện.
 */
export const TABLE_SUPPLEMENT_HISTORY_PREFIX = "Bổ sung dữ liệu bảng sau duyệt";
export const ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX = "Đính kèm tài liệu sau duyệt";
