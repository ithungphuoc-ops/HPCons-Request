import { canApproverAct } from "./approval-logic";
import type { RequestInstance } from "./types";

/**
 * "Góc nhìn" của danh sách đề xuất — bộ lọc SUY RA lúc đọc, KHÔNG phải trạng
 * thái mới của đề xuất.
 *
 * Đây là điểm dễ hiểu nhầm nhất, nên nói rõ: một đề xuất `status === "pending"`
 * có thể đồng thời nằm trong "Đến lượt duyệt" VÀ "Quá hạn" VÀ "Đã đánh dấu".
 * Ba thứ này phụ thuộc vào AI ĐANG XEM và THỜI ĐIỂM XEM, nên tuyệt đối không
 * được thêm vào `RequestStatus` hay lưu xuống Firestore. Comment sẵn có ở
 * `lib/types.ts` (trường `deadlineAt`) đã ghi đúng nguyên tắc này:
 *   "'Quá hạn' là nhãn tính lúc đọc (status vẫn 'pending'), không lưu thành
 *    trạng thái riêng."
 *
 * Cả 3 góc nhìn đều KHÔNG cần thêm dữ liệu mới — dữ liệu đã có sẵn:
 *   - Đến lượt duyệt → `approvalFlow` + `approvers` (dùng lại `canApproverAct`,
 *     đúng hàm mà `/api/requests?scope=inbox` đang dùng, đã có test).
 *   - Quá hạn       → `deadlineAt`.
 *   - Đã đánh dấu   → `bookmarkedByUids` (riêng từng người xem, không phải cờ chung).
 */
export type RequestListView = "all" | "turn" | "overdue" | "bookmarked";

export const REQUEST_VIEW_LABEL: Record<RequestListView, string> = {
  all: "Tất cả",
  turn: "Đến lượt duyệt",
  overdue: "Quá hạn",
  bookmarked: "Đã đánh dấu",
};

/** Thứ tự hiện trên dải tab.
 *
 * Suy ra TỪ `REQUEST_VIEW_LABEL` chứ không liệt kê tay: liệt kê tay thì thêm
 * một góc nhìn mới vào union mà quên thêm vào đây sẽ không có lỗi biên dịch
 * nào, chỉ âm thầm mất một tab. */
export const REQUEST_VIEW_ORDER = Object.keys(REQUEST_VIEW_LABEL) as RequestListView[];

/** Câu giải thích hiện khi danh sách rỗng — nói rõ góc nhìn đang lọc theo gì.
 *
 * Không có khoá `all`: góc nhìn "Tất cả" rỗng nghĩa là không khớp bộ lọc chung
 * (ô tìm kiếm / trạng thái / nhóm), nơi gọi có câu riêng cho tình huống đó. */
export const REQUEST_VIEW_EMPTY: Record<Exclude<RequestListView, "all">, string> = {
  turn: "Không có đề xuất nào đang chờ đến lượt bạn duyệt.",
  overdue: "Không có đề xuất nào quá hạn xử lý.",
  bookmarked: "Bạn chưa đánh dấu đề xuất nào. Mở một đề xuất rồi bấm ngôi sao để đánh dấu.",
};

/** Đã quá hạn xử lý hay chưa — chỉ có nghĩa với đề xuất còn đang chờ duyệt. */
export function isRequestOverdue(request: RequestInstance, now: number): boolean {
  if (request.status !== "pending") return false;
  if (!request.deadlineAt) return false;
  const deadline = Date.parse(request.deadlineAt);
  // `deadlineAt` hỏng/không parse được thì coi như KHÔNG quá hạn — thà bỏ sót
  // còn hơn báo động giả trên một dữ liệu không đọc được.
  if (Number.isNaN(deadline)) return false;
  return deadline < now;
}

/** Đề xuất này có đang chờ chính `uid` xử lý hay không. */
export function isRequestMyTurn(request: RequestInstance, uid: string | null): boolean {
  if (!uid) return false;
  if (request.status !== "pending") return false;
  return canApproverAct(request.approvalFlow, request.approvers, uid);
}

/** `uid` đã đánh dấu đề xuất này chưa. */
export function isRequestBookmarked(request: RequestInstance, uid: string | null): boolean {
  if (!uid) return false;
  return request.bookmarkedByUids?.includes(uid) ?? false;
}

/**
 * Đề xuất có thuộc góc nhìn đang chọn không.
 *
 * `uid` null (phiên chưa tải xong) → "Đến lượt duyệt"/"Đã đánh dấu" trả false
 * để không hiện nhầm đề xuất của người khác; danh sách tự đầy lên khi có uid.
 */
export function matchesRequestView(
  view: RequestListView,
  request: RequestInstance,
  uid: string | null,
  now: number,
): boolean {
  switch (view) {
    case "all":
      return true;
    case "turn":
      return isRequestMyTurn(request, uid);
    case "overdue":
      return isRequestOverdue(request, now);
    case "bookmarked":
      return isRequestBookmarked(request, uid);
    default: {
      const exhaustive: never = view;
      return exhaustive;
    }
  }
}
