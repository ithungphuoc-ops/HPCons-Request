import { canApproverAct } from "./approval-logic";
import { BUSINESS_DAY_MINUTES, businessHoursBetween } from "./business-hours";
import { isRequestOverdue } from "./request-views";
import type { RequestInstance } from "./types";

/**
 * Nhãn đỏ "⏰ Trễ …" cạnh cụm người duyệt ở danh sách đề xuất (/request/list
 * và Trang chủ /request) — Sếp duyệt demo tre-han-va-hang-muc-2026-10-09
 * (09/10/2026): thời gian trễ tính KHỚP CÁCH TÍNH HẠN DUYỆT.
 *
 * Quy tắc:
 *   - Chỉ hiện khi `isRequestOverdue()` đúng (status "pending" + đã qua
 *     `deadlineAt`) — đúng định nghĩa đang dùng cho tab "Quá hạn" và chấm đỏ
 *     cuối dòng; chưa trễ / đã xử lý xong / nháp → không có nhãn.
 *   - Cơ sở tính (`workCalendar`) theo nhóm, ĐÚNG như lúc tính `deadlineAt`
 *     (lib/server/requests.ts computeDeadline):
 *       · nhóm bật "SLA theo lịch làm việc" (ProposalGroup.slaByWorkCalendar)
 *         → phút LÀM VIỆC trôi qua (lib/business-hours.ts: 7:45–12:00,
 *         13:00–17:15 giờ VN, Thứ 2–Thứ 7, nghỉ Chủ nhật);
 *         GIẢ ĐỊNH "1 ngày" = 1 ngày làm việc = BUSINESS_DAY_MINUTES (8,5 giờ).
 *       · nhóm còn lại / không tìm thấy nhóm → GIỜ ĐỒNG HỒ, "1 ngày" = 24 giờ.
 *   - Popup "Tiến trình của người duyệt" (lib/approver-progress.ts
 *     formatOverdue) dùng CHUNG `latenessMinutes` + `formatLatenessDuration`
 *     nên nhãn ở dòng và popup luôn cùng 1 con số.
 *   - Tính lúc đọc, không lưu Firestore; trang gọi đã có `now` tự cập nhật
 *     mỗi 60 giây nên nhãn tự tăng dần.
 */

const CLOCK_DAY_MINUTES = 24 * 60;

/** Số phút đã trễ (làm tròn xuống) theo cơ sở `workCalendar`. Không trễ / hạn hỏng → 0. */
export function latenessMinutes(deadlineAt: string, now: number, workCalendar: boolean): number {
  const deadline = Date.parse(deadlineAt);
  if (Number.isNaN(deadline) || !(now > deadline)) return 0;
  if (!workCalendar) return Math.floor((now - deadline) / 60_000);
  return Math.floor(businessHoursBetween(new Date(deadline), new Date(now)) * 60 + 1e-9);
}

/**
 * "45 phút" / "4 giờ" / "1 ngày 3 giờ" / "2 ngày" — null khi chưa đủ 1 phút.
 * - < 1 giờ: phút. < 1 ngày: giờ (bỏ phút lẻ). >= 1 ngày: ngày + giờ lẻ.
 * - "1 ngày" = 8,5 giờ làm việc (workCalendar) hoặc 24 giờ (giờ đồng hồ).
 */
export function formatLatenessDuration(minutes: number, workCalendar: boolean): string | null {
  const total = Math.max(0, Math.floor(minutes));
  if (total < 1) return null;
  if (total < 60) return `${total} phút`;
  const day = workCalendar ? BUSINESS_DAY_MINUTES : CLOCK_DAY_MINUTES;
  if (total < day) return `${Math.floor(total / 60)} giờ`;
  const days = Math.floor(total / day);
  const hours = Math.floor((total % day) / 60);
  return hours > 0 ? `${days} ngày ${hours} giờ` : `${days} ngày`;
}

/** Nhãn ở danh sách: "Trễ 1 ngày 3 giờ"; 0 phút (vd hạn 17:15, đang buổi tối
 * với nhóm giờ làm việc) → "Vừa trễ hạn". */
export function formatLatenessLabel(minutes: number, workCalendar: boolean): string {
  const d = formatLatenessDuration(minutes, workCalendar);
  return d ? `Trễ ${d}` : "Vừa trễ hạn";
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

/** null = không hiện nhãn. `minutes` truyền sẵn (đã memo ở component) thì
 * không tính lại. */
export function overduePillInfo(
  request: RequestInstance,
  now: number,
  workCalendar: boolean,
  minutes?: number,
): OverduePillInfo | null {
  if (!isRequestOverdue(request, now) || !request.deadlineAt) return null;
  const names = currentApproverNames(request);
  return {
    label: formatLatenessLabel(minutes ?? latenessMinutes(request.deadlineAt, now, workCalendar), workCalendar),
    deadlineText: `Hạn duyệt: ${formatVnDeadlineShort(request.deadlineAt)}`,
    waitingText: names.length > 0 ? `Đang chờ: ${names.join(", ")}` : null,
  };
}
