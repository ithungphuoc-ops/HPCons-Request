import "server-only";
import { deleteObject, headObjectSize } from "@/lib/r2";
import { MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL } from "@/lib/constants";
import { isOwnUploadPath } from "@/lib/server/uploads";

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
