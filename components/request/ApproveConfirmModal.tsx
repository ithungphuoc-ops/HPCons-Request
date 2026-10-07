"use client";

import { useState } from "react";
import Modal from "@/components/shared/Modal";
import { cancelButtonClass, confirmButtonClass } from "@/components/shared/form-styles";
import ApprovalTimeFieldControl, { isApprovalTimeValueMissing } from "@/components/request/ApprovalTimeFieldControl";
import NoteWithAttachments from "@/components/request/NoteWithAttachments";
import { useDecisionAttachmentUploader } from "@/components/request/DecisionAttachmentInput";
import type { DecisionNoteMode } from "@/lib/decision-note";
import type { ApprovalTimeField, RequestAttachment } from "@/lib/types";

/**
 * Hộp xác nhận "Chấp thuận". Mở khi có ÍT NHẤT 1 trong 2: ô "Ý kiến phê
 * duyệt" (nhóm bật "Có ghi chú" cho Chấp thuận — mặc định bật, Sếp chốt
 * 06/10/2026) hoặc "Mẫu form phê duyệt" khớp đúng bước × "Chấp thuận" của
 * người đang xử lý. Không có cả 2 → RequestDetailView chấp thuận 1 bấm như cũ.
 */
export default function ApproveConfirmModal({
  field,
  noteMode,
  attachmentMode = "hidden",
  onClose,
  onConfirm,
}: {
  field?: ApprovalTimeField["field"];
  noteMode: DecisionNoteMode;
  /** "Đính kèm tệp khi duyệt" của nhóm cho Chấp thuận (mặc định không có ô). */
  attachmentMode?: DecisionNoteMode;
  onClose: () => void;
  onConfirm: (
    note: string | undefined,
    approvalTimeValue: unknown,
    attachments: RequestAttachment[],
  ) => Promise<void>;
}) {
  const [value, setValue] = useState<unknown>(undefined);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteInvalid, setNoteInvalid] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [filesInvalid, setFilesInvalid] = useState(false);
  const uploadPicked = useDecisionAttachmentUploader();

  const handleConfirm = async () => {
    if (field && isApprovalTimeValueMissing(field, value)) {
      setError(`Cần điền "${field.name}".`);
      return;
    }
    if (noteMode === "required" && !note.trim()) {
      setNoteInvalid(true);
      setError("Nhóm này yêu cầu nhập ý kiến khi chấp thuận.");
      return;
    }
    if (attachmentMode === "required" && files.length === 0) {
      setFilesInvalid(true);
      setError("Nhóm này yêu cầu đính kèm tệp khi chấp thuận.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Tệp lên R2 TRƯỚC, rồi mới gửi quyết định (như luồng Điều chỉnh sau duyệt).
      const attachments = attachmentMode === "hidden" ? [] : await uploadPicked(files);
      await onConfirm(
        noteMode === "hidden" ? undefined : note.trim() || undefined,
        field ? value : undefined,
        attachments,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Chấp thuận đề xuất"
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={cancelButtonClass}>
            Hủy bỏ
          </button>
          <button type="button" onClick={handleConfirm} disabled={submitting} className={confirmButtonClass}>
            {submitting ? "Đang gửi..." : "Chấp thuận"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {field && <ApprovalTimeFieldControl field={field} value={value} onChange={setValue} />}
        {/* Ô ý kiến + tệp gọn kiểu Thảo luận (demo dieu-chinh-o-gon-kieu-thao-luan-2026-10-07). */}
        <NoteWithAttachments
          noteMode={noteMode}
          fileMode={attachmentMode}
          noteLabel="Ý kiến phê duyệt"
          note={note}
          onNoteChange={(v) => {
            setNote(v);
            if (noteInvalid && v.trim()) setNoteInvalid(false);
          }}
          noteInvalid={noteInvalid}
          autoFocus={!field}
          files={files}
          onFilesChange={(next) => {
            setFiles(next);
            if (next.length > 0) setFilesInvalid(false);
          }}
          filesInvalid={filesInvalid}
          disabled={submitting}
        />
        {error && <p className="text-[12px] text-[var(--color-danger-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
