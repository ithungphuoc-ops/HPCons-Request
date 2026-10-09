/**
 * "Tiến trình của người duyệt" (popup ở trang chi tiết đề xuất, giống Base —
 * Sếp duyệt demo tong-quan-demo/base-request-app/tien-trinh-nguoi-duyet-2026-10-05).
 *
 * Hàm THUẦN: không đụng Firestore, không lưu gì thêm. `ApproverState` chỉ có
 * {id, decision} nên mọi mốc thời gian được SUY từ `request.history` (do
 * app/api/requests/[id]/decision/route.ts và app/api/requests/[id]/route.ts
 * ghi) + `submittedAt`. Không tìm được mốc → trả null (UI hiện "—"), không bịa.
 *
 * Giới hạn đã biết:
 * - Lịch sử chỉ ghi TÊN người thao tác (session.name), không ghi uid → ghép
 *   tên với `approversSnapshot[].name`. Hai người duyệt TRÙNG TÊN: ưu tiên
 *   người đứng trước theo thứ tự (và có quyết định khớp), có thể lệch mốc.
 * - Cấu hình SLA đọc từ nhóm HIỆN TẠI (không chụp lúc gửi) — nhóm đổi cài đặt
 *   sau khi gửi thì cột SLA có thể khác hạn thật đã tính lúc đó. Riêng cột
 *   "Thời hạn" của người đang tới lượt luôn dùng `request.deadlineAt` (hạn
 *   thật app đang áp).
 */
import { canApproverAct } from "./approval-logic";
import { businessHoursBetween } from "./business-hours";
import { formatLatenessDuration, latenessMinutes } from "./request-overdue";
import type { ApproverStepDef, ProposalGroup, RequestInstance } from "./types";

/** Nhãn `RequestHistoryEntry.action` — PHẢI khớp đúng chuỗi các route đang ghi. */
export const HISTORY_ACTION = {
  submitted: "Đã gửi đề xuất",
  resubmitted: "Đã gửi lại đề xuất",
  editedRestart: "Đã chỉnh sửa đề xuất — duyệt lại từ đầu",
  approved: "Đã chấp thuận",
  rejected: "Đã từ chối",
  approveAndForward: "Đã chấp thuận và chuyển tiếp",
  forwardThenApprove: "Đã chuyển tiếp cho duyệt trước",
  returned: "Đã trả lại",
  /** Nhãn CŨ trước 15/08/2026 (chuyển tiếp = giao hẳn quyền, người chuyển bị thay). */
  legacyForwarded: "Đã chuyển tiếp",
} as const;

const RESTART_ACTIONS: string[] = [
  HISTORY_ACTION.submitted,
  HISTORY_ACTION.resubmitted,
  HISTORY_ACTION.editedRestart,
];

export type ApproverProgressStatus =
  | "approved"
  | "rejected"
  | "returned"
  | "current"
  | "waiting"
  | "skipped";

export interface ApproverProgressRow {
  index: number;
  approverId: string;
  status: ApproverProgressStatus;
  /** Lúc tới lượt người này (ISO) — null nếu chưa tới lượt / không suy ra được. */
  startAt: string | null;
  /** Lúc quyết định (hoặc `now` nếu đang tới lượt) — null nếu không có. */
  endAt: string | null;
  /** Giờ thực tế startAt→endAt (giờ làm việc nếu nhóm bật lịch làm việc). */
  actualHours: number | null;
  /** SLA áp cho người này (giờ) — null = không có SLA. */
  slaHours: number | null;
  /** Hạn hiện hành — CHỈ có với người đang tới lượt (= request.deadlineAt). */
  deadlineAt: string | null;
  /** true = quá hạn/trễ hạn; false = trong hạn/đúng hạn; null = không xét được. */
  late: boolean | null;
}

export type ProgressGroupSettings = Pick<
  ProposalGroup,
  "slaByWorkCalendar" | "approverSlaEnabled" | "slaHours"
> & { approverSteps?: ApproverStepDef[] };

export interface ApproverProgressResult {
  rows: ApproverProgressRow[];
  /** true nếu "Thực tế" tính theo giờ làm việc (nhóm bật slaByWorkCalendar). */
  workCalendar: boolean;
  /** Mốc bắt đầu vòng duyệt hiện tại (lần gửi/gửi lại gần nhất). */
  cycleStartAt: string | null;
}

type Decision = "approved" | "rejected" | "returned";

function hoursBetween(fromIso: string, toIso: string, workCalendar: boolean): number | null {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (workCalendar) return businessHoursBetween(from, to);
  return Math.max(0, (to.getTime() - from.getTime()) / 3_600_000);
}

function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export const sameName = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.trim().toLocaleLowerCase("vi") === b.trim().toLocaleLowerCase("vi");

/**
 * Tính tiến trình từng người duyệt của 1 đề xuất.
 * @param group cài đặt SLA của nhóm (null = đề xuất trực tiếp / không lấy được nhóm → giờ đồng hồ).
 */
export function buildApproverProgress(
  request: Pick<
    RequestInstance,
    | "approvalFlow"
    | "approvers"
    | "approversSnapshot"
    | "approverStepMeta"
    | "history"
    | "submittedAt"
    | "status"
    | "deadlineAt"
  >,
  group: ProgressGroupSettings | null,
  now: Date,
): ApproverProgressResult {
  const workCalendar = group?.slaByWorkCalendar === true;
  const snapshot = request.approversSnapshot ?? [];
  const history = request.history ?? [];
  const nowIso = now.toISOString();

  // ── 1. Vòng duyệt hiện tại = sau lần gửi / gửi lại / sửa-duyệt-lại gần nhất.
  let cycleIdx = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (RESTART_ACTIONS.includes(history[i].action)) {
      cycleIdx = i;
      break;
    }
  }
  const cycleStartAt = cycleIdx >= 0 ? history[cycleIdx].at : request.submittedAt || null;
  const events = history.slice(cycleIdx + 1);

  // ── 2. Quyết định của từng người. Bình thường lấy từ `approvers` (nguồn
  // thật); riêng đề xuất đang "Trả lại" thì approvers đã bị reset hết về
  // pending → suy quyết định của vòng vừa rồi từ lịch sử.
  const stateDecision = (i: number): "pending" | "approved" | "rejected" => {
    const id = snapshot[i]?.id;
    return request.approvers.find((a) => a.id === id)?.decision ?? "pending";
  };
  const fromHistory = request.status === "returned";
  const decisionAt: (string | null)[] = snapshot.map(() => null);
  const decisionOf: (Decision | null)[] = snapshot.map((_, i) => {
    if (fromHistory) return null;
    const d = stateDecision(i);
    return d === "pending" ? null : d;
  });
  const addedAt: (string | null)[] = snapshot.map(() => null);
  const matched = snapshot.map(() => false);
  const addedMatched = snapshot.map(() => false);

  const matchDecision = (actor: string, decision: Decision, at: string) => {
    for (let i = 0; i < snapshot.length; i += 1) {
      if (matched[i] || !sameName(snapshot[i].name, actor)) continue;
      if (!fromHistory && decisionOf[i] !== decision) continue;
      matched[i] = true;
      decisionAt[i] = at;
      if (fromHistory) decisionOf[i] = decision;
      return;
    }
  };
  const matchAdded = (target: string | undefined, at: string) => {
    if (!target) return;
    for (let i = 0; i < snapshot.length; i += 1) {
      if (addedMatched[i] || !sameName(snapshot[i].name, target)) continue;
      addedMatched[i] = true;
      addedAt[i] = at;
      return;
    }
  };

  for (const e of events) {
    switch (e.action) {
      case HISTORY_ACTION.approved:
        matchDecision(e.actor, "approved", e.at);
        break;
      case HISTORY_ACTION.rejected:
        matchDecision(e.actor, "rejected", e.at);
        break;
      case HISTORY_ACTION.returned:
        matchDecision(e.actor, "returned", e.at);
        break;
      case HISTORY_ACTION.approveAndForward:
        matchDecision(e.actor, "approved", e.at);
        matchAdded(e.target, e.at);
        break;
      case HISTORY_ACTION.forwardThenApprove:
      case HISTORY_ACTION.legacyForwarded:
        // Người chuyển chưa quyết định; người nhận được thêm vào lúc này.
        matchAdded(e.target, e.at);
        break;
      default:
        break;
    }
  }

  // ── 3. SLA từng người — bám ĐÚNG cách app tính `deadlineAt`
  // (lib/server/requests.ts: resolveInitialSlaHours/recomputeDeadlineForNextStep).
  const meta =
    request.approverStepMeta && request.approverStepMeta.length === snapshot.length
      ? request.approverStepMeta
      : undefined;
  const groupSla = typeof group?.slaHours === "number" ? group.slaHours : null;
  const initialSla = (() => {
    if (!group) return null;
    if (group.approverSlaEnabled) {
      const first = group.approverSteps?.[0]?.slaHours;
      if (typeof first === "number") return first;
    }
    return groupSla;
  })();
  const slaFor = (i: number): number | null => {
    if (!group) {
      // Không có nhóm: chỉ còn SLA riêng bước đã chụp lúc gửi (nếu có).
      const s = meta?.[i]?.slaHours;
      return typeof s === "number" ? s : null;
    }
    if (request.approvalFlow === "sequential") {
      // Không bật SLA riêng bước: hạn là hạn CHUNG cả đề xuất tính từ lúc gửi,
      // không phải của riêng bước nào → cột SLA "—" (hạn chung vẫn hiện ở
      // cột "Thời hạn" của người đang tới lượt).
      if (!group.approverSlaEnabled) return null;
      // Người đầu: hạn tính lúc gửi bằng SLA bước đầu đã cấu hình. Trừ khi
      // người đầu là người được "chuyển tiếp" chen vào — lúc đó route
      // decision tính lại bằng meta rỗng {} → rơi về SLA chung (nhánh dưới).
      if (i === 0 && !addedAt[0]) return initialSla;
      const s = meta?.[i]?.slaHours;
      return typeof s === "number" ? s : groupSla;
    }
    // Đồng thời / Một người: mọi người cùng bắt đầu lúc gửi, hạn = hạn lúc gửi.
    return initialSla;
  };

  // ── 4. Ghép từng dòng.
  const rows: ApproverProgressRow[] = snapshot.map((approver, i) => {
    const decision = decisionOf[i];
    let status: ApproverProgressStatus;
    if (decision === "approved") status = "approved";
    else if (decision === "rejected") status = "rejected";
    else if (decision === "returned") status = "returned";
    else if (request.status === "pending") {
      status = canApproverAct(request.approvalFlow, request.approvers, approver.id) ? "current" : "waiting";
    } else if (request.status === "returned" || request.status === "draft") status = "waiting";
    else status = "skipped"; // đề xuất đã kết thúc mà người này chưa xử lý

    const reached = status !== "waiting" && status !== "skipped";
    let startAt: string | null = null;
    if (reached) {
      if (request.approvalFlow === "sequential" && i > 0) {
        startAt = laterIso(decisionAt[i - 1], addedAt[i]);
        // Người trước chưa có mốc quyết định → không suy được, trừ khi chính
        // người này được thêm vào sau (chuyển tiếp) — khi đó mốc thêm vẫn đúng.
        if (!decisionAt[i - 1] && !addedAt[i]) startAt = null;
      } else {
        startAt = laterIso(cycleStartAt, addedAt[i]);
      }
    }
    const endAt = status === "current" ? nowIso : reached ? decisionAt[i] : null;
    const actualHours = startAt && endAt ? hoursBetween(startAt, endAt, workCalendar) : null;
    const slaHours = slaFor(i);
    const deadlineAt = status === "current" ? request.deadlineAt ?? null : null;

    let late: boolean | null = null;
    if (status === "current") {
      late = deadlineAt ? new Date(deadlineAt).getTime() <= now.getTime() : null;
    } else if (status === "approved" && actualHours !== null && slaHours !== null) {
      late = actualHours > slaHours + 1e-9;
    }

    return { index: i, approverId: approver.id, status, startAt, endAt, actualHours, slaHours, deadlineAt, late };
  });

  return { rows, workCalendar, cycleStartAt };
}

/** Nhãn pill "Trạng thái thời gian". */
export function progressTimeLabel(row: ApproverProgressRow): string {
  switch (row.status) {
    case "approved":
      return row.late === true ? "Đã duyệt · trễ hạn" : row.late === false ? "Đã duyệt · đúng hạn" : "Đã duyệt";
    case "rejected":
      return "Từ chối";
    case "returned":
      return "Trả lại";
    case "current":
      return row.late === true ? "Quá hạn" : row.late === false ? "Đang tới lượt · trong hạn" : "Đang tới lượt";
    case "waiting":
      return "Chưa tới lượt";
    case "skipped":
      return "Không cần duyệt";
  }
}

/** "2.40h" — null → "—". */
export function formatHours(h: number | null): string {
  return h === null ? "—" : `${h.toFixed(2)}h`;
}

/** Đếm ngược tới hạn "HH:MM:SS" — "Đã quá hạn" khi đã tới/qua hạn. */
export function formatCountdown(deadlineAt: string, now: number): string {
  const diff = new Date(deadlineAt).getTime() - now;
  if (diff <= 0) return "Đã quá hạn";
  const totalSeconds = Math.floor(diff / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * "Quá hạn 1 ngày 3 giờ" — từ 09/10/2026 (review PR #98) dùng CHUNG
 * `latenessMinutes`/`formatLatenessDuration` với nhãn "⏰ Trễ …" ở danh sách
 * (lib/request-overdue.ts) để popup và dòng danh sách luôn cùng con số:
 * `workCalendar` = nhóm bật SLA theo lịch làm việc → phút làm việc (1 ngày =
 * 8,5 giờ), ngược lại giờ đồng hồ (1 ngày = 24 giờ). Bỏ phút lẻ khi >= 1 giờ.
 * Chưa đủ 1 phút → "Vừa quá hạn".
 */
export function formatOverdue(deadlineAt: string, now: number, workCalendar = false): string {
  const d = formatLatenessDuration(latenessMinutes(deadlineAt, now, workCalendar), workCalendar);
  return d ? `Quá hạn ${d}` : "Vừa quá hạn";
}

/** "09:13 06/10/2026" theo giờ máy người xem. */
export function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
