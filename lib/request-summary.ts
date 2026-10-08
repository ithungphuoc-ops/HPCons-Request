import type { RequestInstance } from "@/lib/types";

/**
 * Bản GỌN của đề xuất cho danh sách (Trang chủ /request, Tìm kiếm) — đọc bằng Firestore
 * `.select(...)` để khỏi tải + giải mã các field nặng mà các màn này không dùng: `history`,
 * `comments`, `attachments`, `viewedAt`, `approverStepMeta`, trạng thái đồng bộ… (đo
 * 08/10/2026 trên dữ liệu thật: `history` + `viewedAt` + `comments` ≈ 12% số byte và
 * còn TĂNG theo mỗi thao tác/bình luận).
 *
 * Gồm đủ field cho:
 *  - lọc quyền ở máy chủ (isMine/isSentToMe/isFollowing: submittedBy, approversSnapshot,
 *    followers, pendingAdjustment, adjustmentReviewerUids, status, deletedAt);
 *  - hàng danh sách + tìm kiếm + xuất Excel (tên đề xuất suy từ fieldsSnapshot + values —
 *    resolveRequestTitle; vẫn đúng với đề xuất cũ, không cần lưu thêm `title`);
 *  - các tab Đến lượt/Quá hạn/Đã đánh dấu (approvalFlow, approvers, deadlineAt,
 *    bookmarkedByUids, pendingAdjustment) — số đếm trên tab không đổi.
 * Trang /request/list KHÔNG dùng bản gọn: khung chi tiết bên phải hiện thẳng bản ghi của
 * danh sách (lịch sử, bình luận, tệp…), bỏ field thì phải tải thêm mỗi lần bấm 1 dòng.
 *
 * Thêm cột/logic mới ở Trang chủ mà cần field ngoài danh sách này thì THÊM VÀO ĐÂY —
 * request-summary.test.ts so kết quả hiển thị giữa bản gọn và bản đầy đủ.
 */
export const REQUEST_SUMMARY_FIELDS = [
  "code",
  "status",
  "groupId",
  "groupNameSnapshot",
  "fieldsSnapshot",
  "values",
  "submittedBy",
  "submittedAt",
  "updatedAt",
  "deadlineAt",
  "approvalFlow",
  "approvers",
  "approversSnapshot",
  "followers",
  "bookmarkedByUids",
  "pendingAdjustment",
  "adjustmentReviewerUids",
  "deletedAt",
] as const satisfies readonly (keyof RequestInstance)[];

/** Mảng bắt buộc theo kiểu RequestInstance mà bản gọn không chọn — trả mảng rỗng để mã
 * cũ lỡ đọc `.length`/`.map` không vỡ. */
const EMPTY_ARRAY_FIELDS = ["history", "comments"] as const;

/** Chuẩn hoá 1 bản ghi đọc bằng `.select(REQUEST_SUMMARY_FIELDS)` về đúng kiểu RequestInstance. */
export function toRequestSummary(id: string, data: Record<string, unknown>): RequestInstance {
  const out: Record<string, unknown> = { id };
  for (const key of REQUEST_SUMMARY_FIELDS) if (data[key] !== undefined) out[key] = data[key];
  for (const key of EMPTY_ARRAY_FIELDS) out[key] = [];
  out.approvers ??= [];
  out.approversSnapshot ??= [];
  out.followers ??= [];
  out.fieldsSnapshot ??= [];
  out.values ??= {};
  out.deletedAt ??= null;
  return out as unknown as RequestInstance;
}
