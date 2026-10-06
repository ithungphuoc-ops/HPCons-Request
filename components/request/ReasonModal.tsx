"use client";

import { useState } from "react";
import Modal from "@/components/shared/Modal";
import { cancelButtonClass, confirmButtonClass } from "@/components/shared/form-styles";
import ApprovalTimeFieldControl, { isApprovalTimeValueMissing } from "@/components/request/ApprovalTimeFieldControl";
import DecisionNoteInput from "@/components/request/DecisionNoteInput";
import DecisionAttachmentInput, { useDecisionAttachmentUploader } from "@/components/request/DecisionAttachmentInput";
import type { DecisionNoteMode } from "@/lib/decision-note";
import type { ApprovalTimeField, RequestAttachment } from "@/lib/types";

export default function ReasonModal({
  title,
  confirmLabel,
  extraField,
  noteMode = "required",
  attachmentMode = "hidden",
  onClose,
  onConfirm,
}: {
  title: string;
  confirmLabel: string;
  /** "Mẫu form phê duyệt" khớp đúng (bước × hành động "Từ chối") của người
   * đang xử lý — undefined = không có field nào, giữ nguyên hành vi cũ. */
  extraField?: ApprovalTimeField["field"];
  /** "Ý kiến khi phê duyệt" của nhóm (chỉ áp cho Từ chối). Mặc định
   * "required" — "Trả lại" luôn dùng mặc định này (giữ nguyên như cũ). */
  noteMode?: DecisionNoteMode;
  /** "Đính kèm tệp khi duyệt": Từ chối theo nhóm (mặc định không có ô);
   * Trả lại luôn "optional" (Sếp chốt 06/10/2026). */
  attachmentMode?: DecisionNoteMode;
  onClose: () => void;
  onConfirm: (note: string, approvalTimeValue: unknown, attachments: RequestAttachment[]) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [fieldValue, setFieldValue] = useState<unknown>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteInvalid, setNoteInvalid] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [filesInvalid, setFilesInvalid] = useState(false);
  const uploadPicked = useDecisionAttachmentUploader();

  const handleConfirm = async () => {
    if (noteMode === "required" && !note.trim()) {
      setNoteInvalid(true);
      setError("Cần nhập lý do.");
      return;
    }
    if (extraField && isApprovalTimeValueMissing(extraField, fieldValue)) {
      setError(`Cần điền "${extraField.name}".`);
      return;
    }
    if (attachmentMode === "required" && files.length === 0) {
      setFilesInvalid(true);
      setError("Nhóm này yêu cầu đính kèm tệp.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const attachments = attachmentMode === "hidden" ? [] : await uploadPicked(files);
      await onConfirm(noteMode === "hidden" ? "" : note.trim(), extraField ? fieldValue : undefined, attachments);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={title}
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={cancelButtonClass}>
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            className={confirmButtonClass}
          >
            {submitting ? "Đang gửi..." : confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {extraField && (
          <ApprovalTimeFieldControl field={extraField} value={fieldValue} onChange={setFieldValue} />
        )}
        {/* Ô ghi chú tắt (nhóm bỏ "Có ghi chú") — vẫn giữ hộp xác nhận cho
            hành động không đảo ngược được như Từ chối, tránh bấm nhầm. */}
        {noteMode === "hidden" && !extraField && (
          <p className="text-[14px] text-gray-700">Xác nhận {confirmLabel.toLowerCase()} đề xuất này?</p>
        )}
        <DecisionNoteInput
          mode={noteMode}
          label="Lý do"
          value={note}
          onChange={(v) => {
            setNote(v);
            if (noteInvalid && v.trim()) setNoteInvalid(false);
          }}
          invalid={noteInvalid}
          rows={4}
          autoFocus
          placeholder="Nhập lý do..."
        />
        <DecisionAttachmentInput
          mode={attachmentMode}
          files={files}
          onChange={(next) => {
            setFiles(next);
            if (next.length > 0) setFilesInvalid(false);
          }}
          invalid={filesInvalid}
          disabled={submitting}
        />
        {error && <p className="text-[12px] text-[var(--color-danger-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
