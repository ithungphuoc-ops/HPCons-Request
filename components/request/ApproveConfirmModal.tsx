"use client";

import { useState } from "react";
import Modal from "@/components/shared/Modal";
import { cancelButtonClass, confirmButtonClass } from "@/components/shared/form-styles";
import ApprovalTimeFieldControl, { isApprovalTimeValueMissing } from "@/components/request/ApprovalTimeFieldControl";
import DecisionNoteInput from "@/components/request/DecisionNoteInput";
import type { DecisionNoteMode } from "@/lib/decision-note";
import type { ApprovalTimeField } from "@/lib/types";

/**
 * Hộp xác nhận "Chấp thuận". Mở khi có ÍT NHẤT 1 trong 2: ô "Ý kiến phê
 * duyệt" (nhóm bật "Có ghi chú" cho Chấp thuận — mặc định bật, Sếp chốt
 * 06/10/2026) hoặc "Mẫu form phê duyệt" khớp đúng bước × "Chấp thuận" của
 * người đang xử lý. Không có cả 2 → RequestDetailView chấp thuận 1 bấm như cũ.
 */
export default function ApproveConfirmModal({
  field,
  noteMode,
  onClose,
  onConfirm,
}: {
  field?: ApprovalTimeField["field"];
  noteMode: DecisionNoteMode;
  onClose: () => void;
  onConfirm: (note: string | undefined, approvalTimeValue: unknown) => Promise<void>;
}) {
  const [value, setValue] = useState<unknown>(undefined);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteInvalid, setNoteInvalid] = useState(false);

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
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(noteMode === "hidden" ? undefined : note.trim() || undefined, field ? value : undefined);
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
        <DecisionNoteInput
          mode={noteMode}
          label="Ý kiến phê duyệt"
          value={note}
          onChange={(v) => {
            setNote(v);
            if (noteInvalid && v.trim()) setNoteInvalid(false);
          }}
          invalid={noteInvalid}
          autoFocus={!field}
        />
        {error && <p className="text-[12px] text-[var(--color-danger-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
