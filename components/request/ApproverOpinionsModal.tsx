"use client";

import { useState } from "react";
import { CheckCircle2, Forward, MessageSquare, Paperclip, Undo2, XCircle } from "lucide-react";
import Modal from "@/components/shared/Modal";
import FilePreviewModal from "@/components/request/FilePreviewModal";
import { fileExtLabel } from "@/components/request/DecisionAttachmentInput";
import Avatar from "@/components/request/Avatar";
import AvatarWithCard from "@/components/request/AvatarWithCard";
import { OPINION_VERB, type ApproverOpinion, type ApproverOpinionKind } from "@/lib/approver-opinions";
import type { AttachmentChange } from "@/lib/decision-attachment-edit";
import {
  DecisionAttachmentEditError,
  DecisionAttachmentEditMenu,
  type DecisionAttachmentEditor,
} from "@/components/request/DecisionAttachmentEditMenu";
import { formatDeadline } from "@/lib/approver-progress";
import { resolveRequestTitle } from "@/lib/request-title";
import type { AvatarProfile } from "@/lib/useAvatarProfilesByUids";
import type { RequestAttachment, RequestInstance } from "@/lib/types";

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

/** Chip tệp người duyệt đính kèm cùng ý kiến — bấm mở popup xem trước/tải
 * (FilePreviewModal, cùng cách mở tài liệu đính kèm sẵn có). Tệp không còn
 * trong đề xuất (`path` rỗng) → chỉ hiện tên, không bấm được.
 *
 * "Sửa tệp đính kèm khi duyệt" (06/10/2026): `editor` có → nút ⋯ (Thay / Gỡ)
 * cạnh tệp người xem được sửa; `former` = tệp đã gỡ/đã thay hiện gạch ngang
 * thu gọn (chỉ Owner/Admin còn mở được); `changes` = dòng lịch sử nhỏ. */
export function OpinionAttachmentChips({
  files,
  onOpen,
  former = [],
  changes = [],
  editor,
}: {
  files: RequestAttachment[];
  onOpen: (file: RequestAttachment) => void;
  former?: RequestAttachment[];
  changes?: AttachmentChange[];
  editor?: DecisionAttachmentEditor;
}) {
  if (files.length === 0 && former.length === 0) return null;
  const canOpenFormer = editor?.canOpenRemoved === true;
  return (
    <>
      {files.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="opinion-attachments">
          {files.map((f, i) => (
            <span key={`${f.path || f.name}-${i}`} className="inline-flex max-w-full flex-col">
              <span className="inline-flex max-w-full items-center rounded bg-white ring-1 ring-inset ring-[var(--color-border)]">
                <button
                  type="button"
                  disabled={!f.path}
                  onClick={() => f.path && onOpen(f)}
                  title={f.path ? `Xem / tải ${f.name}` : "Tệp không còn trong đề xuất"}
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12.5px] text-[var(--color-action-blue)] hover:bg-blue-50 disabled:cursor-default disabled:text-gray-400 disabled:hover:bg-white"
                >
                  <span className="shrink-0 rounded bg-[var(--color-action-blue)] px-1 text-[10px] font-bold text-white">
                    {fileExtLabel(f.name)}
                  </span>
                  <span className="min-w-0 wrap-anywhere">{f.name}</span>
                  {f.size > 0 && (
                    <span className="shrink-0 text-gray-400">({(f.size / 1024 / 1024).toFixed(1)}MB)</span>
                  )}
                  <Paperclip size={11} className="shrink-0 text-gray-400" />
                </button>
                <DecisionAttachmentEditMenu file={f} editor={editor} />
              </span>
              <DecisionAttachmentEditError file={f} editor={editor} />
            </span>
          ))}
        </div>
      )}
      {former.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5" data-testid="opinion-former-attachments">
          {former.map((f, i) => (
            <button
              key={`former-${f.path}-${i}`}
              type="button"
              disabled={!canOpenFormer}
              onClick={() => canOpenFormer && onOpen(f)}
              title={canOpenFormer ? `Tệp đã gỡ/đã thay — xem lại ${f.name}` : "Tệp đã gỡ/đã thay"}
              className="inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11.5px] text-gray-400 line-through ring-1 ring-inset ring-[var(--color-border)] enabled:hover:bg-gray-50 disabled:cursor-default"
            >
              <span className="min-w-0 wrap-anywhere">{f.name}</span>
            </button>
          ))}
        </div>
      )}
      {changes.length > 0 && (
        <ul className="mt-1 border-l-2 border-[var(--color-border)] pl-2 text-[12px] text-gray-500" data-testid="opinion-attachment-log">
          {changes.map((c, i) => (
            <li key={`${c.at}-${i}`} className="break-words">
              {attachmentChangeText(c)}
              {c.at ? ` · ${formatDeadline(c.at)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** "Hồ Hữu Phương đã thay tệp "a" bằng "b"" / "… đã gỡ tệp "a"". */
export function attachmentChangeText(c: AttachmentChange): string {
  const who = c.by || "Ai đó";
  return c.kind === "replaced"
    ? `${who} đã thay tệp "${c.oldName}" bằng "${c.newName ?? ""}"`
    : `${who} đã gỡ tệp "${c.oldName}"`;
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
  attachmentEditor,
}: {
  request: RequestInstance;
  opinions: ApproverOpinion[];
  avatarProfiles: Record<string, AvatarProfile>;
  focusApproverId?: string | null;
  onShowAll?: () => void;
  onClose: () => void;
  /** Nút ⋯ Thay / Gỡ tệp ("Sửa tệp đính kèm khi duyệt", 06/10/2026). */
  attachmentEditor?: DecisionAttachmentEditor;
}) {
  const shown = focusApproverId ? opinions.filter((o) => o.approverId === focusApproverId) : opinions;
  const focusName = focusApproverId
    ? request.approversSnapshot.find((a) => a.id === focusApproverId)?.name
    : undefined;
  // Mới nhất lên đầu, giống Thảo luận.
  const ordered = shown.slice().reverse();
  // Bấm chip tệp → thay popup ý kiến bằng popup xem trước; đóng xem trước là
  // quay lại danh sách ý kiến (không chồng 2 hộp thoại).
  const [previewing, setPreviewing] = useState<RequestAttachment | null>(null);

  if (previewing) {
    return <FilePreviewModal requestId={request.id} attachment={previewing} onClose={() => setPreviewing(null)} />;
  }

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
                    {o.note ? (
                      <>
                        <span className="font-semibold text-gray-700">Ý kiến phê duyệt:</span>{" "}
                        <span className="whitespace-pre-wrap break-words text-gray-700">{o.note}</span>
                      </>
                    ) : (
                      <span className="font-semibold text-gray-700">Tệp đính kèm:</span>
                    )}
                    <OpinionAttachmentChips
                      files={o.attachments}
                      former={o.formerAttachments}
                      changes={o.attachmentChanges}
                      editor={attachmentEditor}
                      onOpen={setPreviewing}
                    />
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
