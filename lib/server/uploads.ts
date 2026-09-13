import "server-only";
import { deleteObject, headObjectSize } from "@/lib/r2";
import { MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL } from "@/lib/constants";

/**
 * Chặn 1 lỗ hổng bảo mật CodeRabbit phát hiện lúc review PR (23/08/2026):
 * `POST /api/requests/[id]/attachments` trước đây lưu thẳng
 * `body.attachment.path` từ client mà KHÔNG xác minh path đó có thật sự do
 * CHÍNH người gọi tải lên qua `/api/uploads` hay không — 1 người có quyền
 * sửa 1 đề xuất (chủ đề xuất/Owner/Admin) có thể gõ tay 1 path CỦA NGƯỜI
 * KHÁC (vd path đề xuất khác, hoặc path mẫu in
 * `print-templates/{groupId}/...`), khiến bất kỳ ai xem được đề xuất này
 * (qua `GET` cùng route) đều lấy được link tải file đó — dù không có quyền
 * xem file gốc. `/api/uploads` LUÔN sinh path dạng `requests/{uid}/...`
 * (xem `app/api/uploads/route.ts`) nên chỉ cần xác nhận path bắt đầu đúng
 * bằng `requests/{uid CỦA NGƯỜI ĐANG GỌI}/` là chặn được toàn bộ path
 * "vay mượn". Đặt ở `lib/server/` (không phải ngay trong route.ts) vì
 * Next.js chặn route.ts export thêm bất cứ gì ngoài GET/POST/config đã biết
 * — export thêm 1 hàm thường sẽ làm build type-check báo lỗi "Diff".
 */
export function isOwnUploadPath(path: string, uid: string): boolean {
  return path.startsWith(`requests/${uid}/`);
}

/**
 * Dựng path chuẩn cho 1 tệp người dùng tải lên — DÙNG CHUNG cho cả 2 đường
 * (multipart qua `/api/uploads` và link ký sẵn `/api/uploads/sign`) để
 * `isOwnUploadPath()` ở trên luôn đúng với mọi tệp, không lệ thuộc route nào
 * sinh ra nó.
 */
export function buildUploadPath(uid: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `requests/${uid}/${Date.now()}-${safeName}`;
}

/**
 * Sau khi trình duyệt PUT thẳng lên R2, máy chủ ĐO LẠI kích thước thật rồi mới
 * cho đính vào đề xuất: con số `size` client gửi lên chỉ là lời khai, người
 * dùng có thể xin link cho "1MB" rồi đẩy 500MB. Tệp quá cỡ bị XOÁ luôn khỏi
 * R2 để không ôm rác.
 *
 * Trả `{ ok: false, error }` để nơi gọi trả 400 nguyên văn cho người dùng.
 */
export async function verifyUploadedAttachment(
  attachment: { name: string; path: string; size: number },
  uid: string,
  maxSize: number,
): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  if (!isOwnUploadPath(attachment.path, uid)) {
    return { ok: false, error: "Tệp không hợp lệ — chỉ chấp nhận tệp bạn vừa tải lên." };
  }
  const realSize = await headObjectSize(attachment.path);
  if (realSize === null) {
    return { ok: false, error: `Không tìm thấy tệp "${attachment.name}" trên kho — tải lại giúp em.` };
  }
  if (realSize > maxSize) {
    await deleteObject(attachment.path).catch(() => {});
    return { ok: false, error: `Tệp "${attachment.name}" vượt quá ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}.` };
  }
  return { ok: true, size: realSize };
}
