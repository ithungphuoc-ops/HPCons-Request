"use client";

import { useState } from "react";
import Modal from "@/components/shared/Modal";
import { cancelButtonClass, confirmButtonClass } from "@/components/shared/form-styles";
import ApprovalTimeFieldControl, { isApprovalTimeValueMissing } from "@/components/request/ApprovalTimeFieldControl";
import DecisionNoteInput from "@/components/request/DecisionNoteInput";
import type { DecisionNoteMode } from "@/lib/decision-note";
import type { ApprovalTimeField } from "@/lib/types";

export default function ReasonModal({
  title,
  confirmLabel,
  extraField,
  noteMode = "required",
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
  onClose: () => void;
  onConfirm: (note: string, approvalTimeValue?: unknown) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [fieldValue, setFieldValue] = useState<unknown>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteInvalid, setNoteInvalid] = useState(false);

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
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(noteMode === "hidden" ? "" : note.trim(), extraField ? fieldValue : undefined);
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
        {error && <p className="text-[12px] text-[var(--color-danger-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
