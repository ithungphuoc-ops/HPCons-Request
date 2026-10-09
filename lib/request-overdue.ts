import { canApproverAct } from "./approval-logic";
import { BUSINESS_DAY_MINUTES, businessHoursBetween } from "./business-hours";
import { isRequestOverdue } from "./request-views";
import type { RequestInstance } from "./types";

/**
 * Nhãn đỏ "⏰ Trễ …" cạnh cụm người duyệt ở danh sách đề xuất (/request/list
 * và Trang chủ /request) — Sếp duyệt demo tre-han-va-hang-muc-2026-10-09
 * (09/10/2026), chọn tính thời gian trễ theo GIỜ LÀM VIỆC.
 *
 * Quy tắc:
 *   - Chỉ hiện khi `isRequestOverdue()` đúng (status "pending" + đã qua
 *     `deadlineAt`) — đúng định nghĩa đang dùng cho tab "Quá hạn" và chấm đỏ
 *     cuối dòng; chưa trễ / đã xử lý xong / nháp → không có nhãn.
 *   - Thời gian trễ = số giờ làm việc trôi qua từ `deadlineAt` tới `now`,
 *     dùng CHUNG lịch của lib/business-hours.ts (7:45–12:00, 13:00–17:15 giờ
 *     VN, Thứ 2–Thứ 7, nghỉ Chủ nhật). Áp cho MỌI đề xuất, kể cả nhóm không
 *     bật "SLA theo lịch làm việc" (Sếp chọn giờ làm việc cho nhãn này).
 *   - GIẢ ĐỊNH: "1 ngày" = 1 ngày làm việc = BUSINESS_DAY_MINUTES (8,5 giờ),
 *     KHÔNG phải 24 giờ đồng hồ.
 *   - Tính lúc đọc, không lưu Firestore; trang gọi đã có `now` tự cập nhật
 *     mỗi 60 giây nên nhãn tự tăng dần.
 */

/** Số phút làm việc đã trễ (làm tròn xuống). Không trễ / hạn hỏng → 0. */
export function businessLatenessMinutes(deadlineAt: string, now: number): number {
  const deadline = Date.parse(deadlineAt);
  if (Number.isNaN(deadline) || !(now > deadline)) return 0;
  return Math.floor(businessHoursBetween(new Date(deadline), new Date(now)) * 60 + 1e-9);
}

/**
 * "Trễ 45 phút" / "Trễ 4 giờ" / "Trễ 1 ngày 3 giờ" / "Trễ 2 ngày".
 * - < 1 giờ: hiện phút.
 * - < 1 ngày làm việc: hiện giờ (bỏ phút lẻ cho gọn).
 * - >= 1 ngày: "N ngày" + giờ lẻ (nếu có).
 * - 0 phút (vd hạn 17:15, đang buổi tối/Chủ nhật — đã quá hạn nhưng chưa trôi
 *   phút làm việc nào) → "Vừa trễ hạn".
 */
export function formatBusinessLateness(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  if (total < 1) return "Vừa trễ hạn";
  if (total < 60) return `Trễ ${total} phút`;
  if (total < BUSINESS_DAY_MINUTES) return `Trễ ${Math.floor(total / 60)} giờ`;
  const days = Math.floor(total / BUSINESS_DAY_MINUTES);
  const hours = Math.floor((total % BUSINESS_DAY_MINUTES) / 60);
  return hours > 0 ? `Trễ ${days} ngày ${hours} giờ` : `Trễ ${days} ngày`;
}

/** "08/10 08:30" theo GIỜ VIỆT NAM (không phụ thuộc múi giờ máy người xem). */
export function formatVnDeadlineShort(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const wall = new Date(t + 7 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(wall.getUTCDate())}/${p(wall.getUTCMonth() + 1)} ${p(wall.getUTCHours())}:${p(wall.getUTCMinutes())}`;
}

/** Tên người đang giữ đề xuất (đến lượt duyệt) — lần lượt: người đầu tiên còn
 * chờ; đồng thời/một người: mọi người còn chờ. Dùng lại `canApproverAct()`. */
export function currentApproverNames(request: RequestInstance): string[] {
  return request.approversSnapshot
    .filter((u) => canApproverAct(request.approvalFlow, request.approvers, u.id))
    .map((u) => u.name);
}

export interface OverduePillInfo {
  /** "Trễ 1 ngày 3 giờ" */
  label: string;
  /** "Hạn duyệt: 08/10 08:30" */
  deadlineText: string;
  /** "Đang chờ: A, B" — null nếu không xác định được người đang giữ. */
  waitingText: string | null;
}

/** null = không hiện nhãn. */
export function overduePillInfo(request: RequestInstance, now: number): OverduePillInfo | null {
  if (!isRequestOverdue(request, now) || !request.deadlineAt) return null;
  const names = currentApproverNames(request);
  return {
    label: formatBusinessLateness(businessLatenessMinutes(request.deadlineAt, now)),
    deadlineText: `Hạn duyệt: ${formatVnDeadlineShort(request.deadlineAt)}`,
    waitingText: names.length > 0 ? `Đang chờ: ${names.join(", ")}` : null,
  };
}
