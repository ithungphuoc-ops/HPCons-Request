/**
 * "Phiên bản nghiệp vụ" của 1 đề xuất — dùng chung máy chủ + trình duyệt
 * (06/10/2026, Sếp chốt): người gửi đang sửa/gửi lại mà đề xuất đã thay đổi
 * (người duyệt vừa duyệt, trả lại, chuyển tiếp, trạng thái đổi, bị xoá) thì
 * máy chủ KHÔNG ghi đè, giữ nguyên lượt duyệt, trả 409.
 *
 * Gồm: trạng thái, xoá mềm, nhóm, và từng lượt duyệt (id + quyết định).
 * CỐ Ý KHÔNG gồm:
 *   · `updatedAt` — bình luận mới cũng cập nhật mốc này (để chuông thông báo
 *     nổi lại), dùng nó sẽ chặn nhầm người gửi chỉ vì có ai đó bình luận;
 *   · `history`/`attachments` — dòng "Đã đồng bộ…" của hàng chờ hay tệp người
 *     gửi tự thêm không làm bản sửa của người gửi trở nên sai.
 * Hàm thuần, không phụ thuộc máy chủ — import được ở Client Component.
 */
import type { RequestInstance } from "@/lib/types";

export const REQUEST_CHANGED_MESSAGE = "Đề xuất vừa có thay đổi, vui lòng tải lại trang rồi thử lại.";

export type RequestVersionSource = Pick<RequestInstance, "status" | "deletedAt" | "groupId" | "approvers">;

export function requestVersionKey(r: RequestVersionSource): string {
  return JSON.stringify([
    r.status ?? null,
    r.deletedAt ?? null,
    r.groupId ?? null,
    (r.approvers ?? []).map((a) => [a.id, a.decision]),
  ]);
}
