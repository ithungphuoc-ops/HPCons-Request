"use client";

import { CheckCircle2, Forward, MessageSquare, Undo2, XCircle } from "lucide-react";
import Modal from "@/components/shared/Modal";
import Avatar from "@/components/request/Avatar";
import AvatarWithCard from "@/components/request/AvatarWithCard";
import { OPINION_VERB, type ApproverOpinion, type ApproverOpinionKind } from "@/lib/approver-opinions";
import { formatDeadline } from "@/lib/approver-progress";
import { resolveRequestTitle } from "@/lib/request-title";
import type { AvatarProfile } from "@/lib/useAvatarProfilesByUids";
import type { RequestInstance } from "@/lib/types";

/** Biểu tượng + màu theo hành động — dùng chung cho popup và Thảo luận. */
export const OPINION_TONE: Record<
  ApproverOpinionKind,
  { Icon: typeof CheckCircle2; text: string; border: string }
> = {
  approved: { Icon: CheckCircle2, text: "text-[var(--color-confirm-green)]", border: "border-[var(--color-confirm-green)]" },
  approveAndForward: { Icon: CheckCircle2, text: "text-[var(--color-action-blue)]", border: "border-[var(--color-action-blue)]" },
  rejected: { Icon: XCircle, text: "text-[var(--color-danger-red)]", border: "border-[var(--color-danger-red)]" },
  forward: { Icon: Forward, text: "text-teal-600", border: "border-teal-500" },
  returned: { Icon: Undo2, text: "text-orange-500", border: "border-orange-400" },
};

/** "Đã chấp thuận" / "Đã chuyển tiếp cho X". */
export function opinionActionText(o: ApproverOpinion, capitalize = false): string {
  const verb = OPINION_VERB[o.kind];
  const text = (o.kind === "forward" || o.kind === "approveAndForward") && o.target ? `${verb} cho ${o.target}` : verb;
  return capitalize ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Ảnh người có ý kiến — ghép được vào danh sách duyệt thì dùng ảnh thật. */
export function OpinionAvatar({
  opinion,
  request,
  avatarProfiles,
  size,
}: {
  opinion: ApproverOpinion;
  request: Pick<RequestInstance, "approversSnapshot">;
  avatarProfiles: Record<string, AvatarProfile>;
  size: number;
}) {
  const approver = opinion.approverIndex !== null ? request.approversSnapshot[opinion.approverIndex] : undefined;
  if (approver) {
    return (
      <AvatarWithCard
        name={approver.name}
        username={approver.username}
        avatarInitial={approver.avatarInitial}
        kind={approver.kind}
        profile={avatarProfiles[approver.id] ?? { url: null, title: null }}
        size={size}
        fallbackClassName="bg-[var(--color-action-blue)] font-semibold text-white"
      />
    );
  }
  return (
    <Avatar
      url={null}
      initial={opinion.actor.trim().charAt(0).toUpperCase() || "?"}
      name={opinion.actor}
      size={size}
      fallbackClassName="bg-gray-400 font-semibold text-white"
    />
  );
}

/**
 * Popup "Ý kiến của người duyệt" (Sếp duyệt demo y-kien-nguoi-duyet-2026-10-06).
 * Chỉ ĐỌC — ý kiến trích từ `request.history` (lib/approver-opinions.ts).
 * `focusApproverId` (bấm bong bóng cạnh tên) → chỉ hiện ý kiến của người đó.
 */
export default function ApproverOpinionsModal({
  request,
  opinions,
  avatarProfiles,
  focusApproverId,
  onShowAll,
  onClose,
}: {
  request: RequestInstance;
  opinions: ApproverOpinion[];
  avatarProfiles: Record<string, AvatarProfile>;
  focusApproverId?: string | null;
  onShowAll?: () => void;
  onClose: () => void;
}) {
  const shown = focusApproverId ? opinions.filter((o) => o.approverId === focusApproverId) : opinions;
  const focusName = focusApproverId
    ? request.approversSnapshot.find((a) => a.id === focusApproverId)?.name
    : undefined;
  // Mới nhất lên đầu, giống Thảo luận.
  const ordered = shown.slice().reverse();

  return (
    <Modal title="Ý kiến của người duyệt" width={720} onClose={onClose}>
      <div className="-mx-6 -mt-5 mb-1 flex items-start gap-3 border-b border-[var(--color-border)] px-6 py-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-[var(--color-confirm-green)] text-[var(--color-confirm-green)]">
          <MessageSquare size={15} />
        </span>
        <div className="min-w-0">
          <div className="break-words text-[14px] font-semibold text-[var(--color-text-primary)]">
            {resolveRequestTitle(request)}
          </div>
          <div className="text-[12.5px] text-gray-500">
            Tổng cộng {shown.length} ý kiến
            {focusName ? ` của ${focusName}` : ""}
            {focusApproverId && onShowAll && opinions.length > shown.length && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={onShowAll}
                  className="font-medium text-[var(--color-action-blue)] hover:underline"
                >
                  Xem tất cả {opinions.length} ý kiến
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {ordered.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-gray-500">Chưa có ý kiến nào.</p>
      ) : (
        <div className="flex flex-col">
          {ordered.map((o) => {
            const tone = OPINION_TONE[o.kind];
            const Icon = tone.Icon;
            return (
              <div
                key={o.key}
                className="flex items-start gap-2.5 border-b border-[var(--color-border)] py-3 last:border-b-0 sm:gap-3"
              >
                <OpinionAvatar opinion={o} request={request} avatarProfiles={avatarProfiles} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-[var(--color-text-primary)]">{o.actor}</div>
                  <div className="text-[12.5px] text-gray-500">
                    {opinionActionText(o, true)} vào lúc {formatDeadline(o.at)}
                  </div>
                  <div className={`mt-1.5 border-l-[3px] pl-2.5 text-[14px] ${tone.border}`}>
                    <span className="font-semibold text-gray-700">Ý kiến phê duyệt:</span>{" "}
                    <span className="whitespace-pre-wrap break-words text-gray-700">{o.note}</span>
                  </div>
                </div>
                <Icon size={18} className={`mt-0.5 shrink-0 ${tone.text}`} aria-label={opinionActionText(o, true)} />
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
