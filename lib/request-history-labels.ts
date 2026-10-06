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

/**
 * Dòng "điều chỉnh sau duyệt" — Sếp chốt 15/09/2026, thay cho khối bảng cũ.
 *
 * Cùng lý do tách file như 2 hằng trên: route API (server) ghi vào history,
 * còn `RequestDetailView.tsx` (client) đọc lại để liệt kê các lần đã điều
 * chỉnh — hai bên phải dùng ĐÚNG một chuỗi. Đổi chuỗi này là mọi lần điều
 * chỉnh đã ghi của đề xuất cũ biến mất khỏi danh sách, đừng đổi tuỳ tiện.
 */
export const ADJUSTMENT_HISTORY_PREFIX = "Điều chỉnh sau duyệt";

/** Giới hạn độ dài nội dung điều chỉnh — kiểm ở CẢ ô nhập lẫn máy chủ. */
export const ADJUSTMENT_MAX_LENGTH = 500;

/**
 * "Sửa tệp đính kèm khi duyệt" (Sếp duyệt demo 06/10/2026) — dòng lịch sử ghi
 * khi người đính kèm (hoặc Owner/Admin) thay/gỡ tệp đã gửi kèm quyết định.
 * KHÔNG phải quyết định duyệt: lib/approver-progress.ts và
 * lib/approver-opinions.ts chỉ đọc đúng các nhãn quyết định nên tự bỏ qua 2
 * nhãn này. Đổi chuỗi = dòng cũ không còn được nhận diện, đừng đổi tuỳ tiện.
 */
export const DECISION_ATTACHMENT_REPLACED_ACTION = "Đã thay tệp đính kèm";
export const DECISION_ATTACHMENT_REMOVED_ACTION = "Đã gỡ tệp đính kèm";
export const DECISION_ATTACHMENT_EDIT_ACTIONS: readonly string[] = [
  DECISION_ATTACHMENT_REPLACED_ACTION,
  DECISION_ATTACHMENT_REMOVED_ACTION,
];

/**
 * Dòng lịch sử khi người gửi điều chỉnh (hoặc Owner/Admin) HUỶ 1 điều chỉnh
 * đang chờ duyệt (06/10/2026). KHÔNG bắt đầu bằng `ADJUSTMENT_HISTORY_PREFIX`
 * nên không bị đếm vào "lần N" điều chỉnh. Đừng đổi tuỳ tiện.
 */
export const ADJUSTMENT_CANCELLED_ACTION = "Đã huỷ điều chỉnh chờ duyệt";
