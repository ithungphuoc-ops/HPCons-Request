/**
 * Chốt chặn dùng chung cho các route ghi vào đề xuất bằng transaction
 * (06/10/2026, Sếp duyệt — làm tiếp sau PR #82):
 *   · đề xuất đã xoá mềm (`deletedAt`) thì không cho ghi gì nữa;
 *   · PATCH sửa/gửi lại: nếu trong lúc người gửi đang sửa mà đề xuất đã thay
 *     đổi thì KHÔNG ghi đè, giữ nguyên lượt duyệt, trả 409 để tải lại trang.
 *
 * Hàm THUẦN (không đọc/ghi Firestore) — gọi được cả trước lẫn bên trong
 * callback `adminDb.runTransaction` (có thể chạy lại nhiều lần).
 */
import { REQUEST_CHANGED_MESSAGE, requestVersionKey, type RequestVersionSource } from "@/lib/request-version";
import type { RequestInstance } from "@/lib/types";

export { REQUEST_CHANGED_MESSAGE } from "@/lib/request-version";
export const REQUEST_DELETED_MESSAGE = "Đề xuất đã bị xoá.";

export interface GuardFailure {
  status: number;
  error: string;
}

/** Ném từ trong callback transaction để huỷ ghi + trả đúng mã lỗi cho client. */
export class RequestTxError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 409 nếu đề xuất đã bị xoá mềm, ngược lại `null`. */
export function deletedGuard(request: Pick<RequestInstance, "deletedAt">): GuardFailure | null {
  return request.deletedAt ? { status: 409, error: REQUEST_DELETED_MESSAGE } : null;
}

/**
 * Kiểm cho PATCH sửa/gửi lại, gọi trên ảnh chụp MỚI NHẤT (`latest`, đọc bằng
 * tx.get) so với bản đọc lúc đầu request (`initial`):
 *   1. đã xoá → 409 "Đề xuất đã bị xoá."
 *   2. phiên bản khác bản đọc lúc đầu request → 409 "Đề xuất vừa có thay đổi…"
 *   3. client gửi kèm `expectedVersion` (requestVersionKey lúc MỞ form sửa) mà
 *      khác bản mới nhất → 409 như trên. Đây là phần bắt đúng tình huống "đang
 *      sửa thì người duyệt duyệt/trả lại" (khoảng thời gian dài, không chỉ vài
 *      mili-giây giữa đọc và ghi). Không gửi (`undefined`) → bỏ qua bước này
 *      (tương thích tab cũ chưa tải bản mới).
 */
export function checkEditGuard(
  initial: RequestVersionSource,
  latest: RequestVersionSource,
  expectedVersion?: string,
): GuardFailure | null {
  const deleted = deletedGuard(latest);
  if (deleted) return deleted;
  const latestKey = requestVersionKey(latest);
  if (requestVersionKey(initial) !== latestKey) {
    return { status: 409, error: REQUEST_CHANGED_MESSAGE };
  }
  if (expectedVersion !== undefined && expectedVersion !== latestKey) {
    return { status: 409, error: REQUEST_CHANGED_MESSAGE };
  }
  return null;
}

/** Đọc `expectedVersion` từ body: chuỗi thì dùng, kiểu khác coi như không gửi. */
export function parseExpectedVersion(raw: unknown): string | undefined {
  return typeof raw === "string" ? raw : undefined;
}
