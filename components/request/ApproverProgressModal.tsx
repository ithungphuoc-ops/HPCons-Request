"use client";

import { History } from "lucide-react";
import { useMemo } from "react";
import Modal from "@/components/shared/Modal";
import AvatarWithCard from "@/components/request/AvatarWithCard";
import type { AvatarProfile } from "@/lib/useAvatarProfilesByUids";
import {
  buildApproverProgress,
  formatCountdown,
  formatDeadline,
  formatHours,
  formatOverdue,
  progressTimeLabel,
  type ApproverProgressRow,
  type ProgressGroupSettings,
} from "@/lib/approver-progress";
import { approvalFlowLabels, type RequestInstance } from "@/lib/types";
import { resolveRequestTitle } from "@/lib/request-title";

/**
 * Popup "Tiến trình của người duyệt" — giống Base (Sếp duyệt demo
 * tien-trinh-nguoi-duyet-2026-10-05). Chỉ ĐỌC dữ liệu đề xuất đã tải sẵn +
 * cài đặt SLA của nhóm lấy từ RequestContext (không thêm lượt đọc nào).
 * Mọi tính toán nằm ở lib/approver-progress.ts.
 */

const DOT: Record<string, string> = {
  green: "bg-[var(--color-confirm-green)]",
  blue: "bg-[var(--color-action-blue)]",
  red: "bg-[var(--color-danger-red)]",
  gray: "bg-gray-300 dark:bg-gray-600",
};

function tone(row: ApproverProgressRow): keyof typeof DOT {
  if (row.status === "approved") return row.late === true ? "red" : "green";
  if (row.status === "rejected" || row.status === "returned") return "red";
  if (row.status === "current") return row.late === true ? "red" : "blue";
  return "gray";
}

function dotTone(row: ApproverProgressRow): keyof typeof DOT {
  // Chấm trạng thái: đã duyệt luôn xanh lá (kể cả trễ — trễ thể hiện ở pill).
  if (row.status === "approved") return "green";
  return tone(row);
}

const PILL: Record<keyof typeof DOT, string> = {
  green: "bg-green-50 text-[var(--color-confirm-green)] dark:bg-green-500/10",
  blue: "bg-blue-50 text-[var(--color-action-blue)] dark:bg-blue-500/10",
  red: "bg-red-50 text-[var(--color-danger-red)] dark:bg-red-500/10",
  gray: "border border-[var(--color-border)] bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-gray-400",
};

function StatusDot({ row }: { row: ApproverProgressRow }) {
  return <span className={`inline-block h-[11px] w-[11px] shrink-0 rounded-full ${DOT[dotTone(row)]}`} aria-hidden />;
}

function TimePill({ row }: { row: ApproverProgressRow }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${PILL[tone(row)]}`}
    >
      {progressTimeLabel(row)}
    </span>
  );
}

function Deadline({ row, now }: { row: ApproverProgressRow; now: number }) {
  if (row.status !== "current" || !row.deadlineAt) return <span className="text-gray-400">—</span>;
  const late = new Date(row.deadlineAt).getTime() <= now;
  return (
    <div className="tabular-nums">
      <div>{formatDeadline(row.deadlineAt)}</div>
      <div
        className={`text-[12.5px] font-semibold ${
          late ? "text-[var(--color-danger-red)]" : "text-[var(--color-action-blue)]"
        }`}
      >
        {late ? formatOverdue(row.deadlineAt, now) : `Còn ${formatCountdown(row.deadlineAt, now)}`}
      </div>
    </div>
  );
}

export default function ApproverProgressModal({
  request,
  group,
  avatarProfiles,
  now,
  onClose,
}: {
  request: RequestInstance;
  /** Cài đặt SLA của nhóm — null: đề xuất trực tiếp / không tìm thấy nhóm (giờ đồng hồ). */
  group: ProgressGroupSettings | null;
  avatarProfiles: Record<string, AvatarProfile>;
  now: number;
  onClose: () => void;
}) {
  const { rows, workCalendar } = useMemo(
    () => buildApproverProgress(request, group, new Date(now)),
    [request, group, now],
  );
  const snapshot = request.approversSnapshot;
  const sharedSla =
    request.approvalFlow === "sequential" && group && !group.approverSlaEnabled && typeof group.slaHours === "number"
      ? group.slaHours
      : null;

  const person = (index: number, size: number) => {
    const a = snapshot[index];
    const title = avatarProfiles[a.id]?.title;
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <AvatarWithCard
          name={a.name}
          username={a.username}
          avatarInitial={a.avatarInitial}
          kind={a.kind}
          profile={avatarProfiles[a.id] ?? { url: null, title: null }}
          size={size}
          fallbackClassName="bg-[var(--color-action-blue)] font-semibold text-white"
        />
        <div className="min-w-0">
          <div className="truncate font-semibold text-[var(--color-text-primary)]">{a.name}</div>
          {title && <div className="truncate text-[12px] text-gray-500">{title}</div>}
        </div>
      </div>
    );
  };

  const hoursCell = (row: ApproverProgressRow) => (
    <span className="whitespace-nowrap tabular-nums">
      <b className="text-[var(--color-text-primary)]">{formatHours(row.actualHours)}</b>
      <span className="text-gray-500"> / {formatHours(row.slaHours)}</span>
    </span>
  );

  return (
    <Modal title="Tiến trình của người duyệt" width={920} onClose={onClose}>
      <div className="-mx-6 -mt-5 mb-1 flex items-start gap-3 border-b border-[var(--color-border)] px-6 py-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-[var(--color-action-blue)] text-[var(--color-action-blue)]">
          <History size={16} />
        </span>
        <div className="min-w-0">
          <div className="break-words text-[14px] font-semibold text-[var(--color-text-primary)]">
            {resolveRequestTitle(request)}
          </div>
          <div className="text-[12.5px] text-gray-500">
            Tổng cộng {snapshot.length} người duyệt · Luồng phê duyệt: {approvalFlowLabels[request.approvalFlow]}
            {workCalendar ? " · Giờ thực tế tính theo giờ làm việc" : ""}
            {sharedSla !== null ? ` · Hạn chung cả đề xuất: ${sharedSla} giờ` : ""}
          </div>
        </div>
      </div>

      {snapshot.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-gray-500">Đề xuất chưa có người duyệt.</p>
      ) : (
        <>
          <table className="hidden w-full border-collapse text-[13.5px] sm:table">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[11px] font-bold uppercase text-[var(--color-action-blue)]">
                <th className="whitespace-nowrap px-2 py-2.5">Trạng thái</th>
                <th className="whitespace-nowrap px-2 py-2.5">Người duyệt</th>
                <th className="whitespace-nowrap px-2 py-2.5">Trạng thái thời gian</th>
                <th className="whitespace-nowrap px-2 py-2.5">Thực tế / SLA</th>
                <th className="whitespace-nowrap px-2 py-2.5">Thời hạn</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.approverId} className="border-b border-[var(--color-border)] align-top last:border-b-0">
                  <td className="px-2 py-3 pt-4">
                    <StatusDot row={row} />
                  </td>
                  <td className="max-w-[280px] px-2 py-3">{person(row.index, 32)}</td>
                  <td className="px-2 py-3 pt-3.5">
                    <TimePill row={row} />
                  </td>
                  <td className="px-2 py-3 pt-3.5">{hoursCell(row)}</td>
                  <td className="px-2 py-3 pt-3.5">
                    <Deadline row={row} now={now} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-col gap-2 sm:hidden">
            {rows.map((row) => (
              <div key={row.approverId} className="rounded-md border border-[var(--color-border)] p-2.5">
                <div className="flex items-center gap-2.5">
                  <StatusDot row={row} />
                  <div className="min-w-0 flex-1">{person(row.index, 30)}</div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[13px]">
                  <TimePill row={row} />
                  {hoursCell(row)}
                </div>
                {row.status === "current" && row.deadlineAt && (
                  <div className="mt-2 flex items-start justify-between gap-2 text-[13px]">
                    <span className="text-gray-500">Thời hạn</span>
                    <span className="text-right">
                      <Deadline row={row} now={now} />
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
