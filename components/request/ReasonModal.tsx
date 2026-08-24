"use client";

import { useState } from "react";
import Modal from "@/components/shared/Modal";
import { cancelButtonClass, confirmButtonClass, textareaClass } from "@/components/shared/form-styles";
import ApprovalTimeFieldControl, { isApprovalTimeValueMissing } from "@/components/request/ApprovalTimeFieldControl";
import type { ApprovalTimeField } from "@/lib/types";

export default function ReasonModal({
  title,
  confirmLabel,
  extraField,
  onClose,
  onConfirm,
}: {
  title: string;
  confirmLabel: string;
  /** "Mẫu form phê duyệt" khớp đúng (bước × hành động "Từ chối") của người
   * đang xử lý — undefined = không có field nào, giữ nguyên hành vi cũ. */
  extraField?: ApprovalTimeField["field"];
  onClose: () => void;
  onConfirm: (note: string, approvalTimeValue?: unknown) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [fieldValue, setFieldValue] = useState<unknown>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!note.trim()) {
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
      await onConfirm(note.trim(), extraField ? fieldValue : undefined);
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
        <div>
          <label className="mb-1 block text-[13px] font-medium text-gray-700">
            Lý do <span className="text-[var(--color-danger-red)]">*</span>
          </label>
          <textarea
            className={textareaClass}
            rows={4}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Nhập lý do..."
          />
        </div>
        {error && <p className="text-[12px] text-[var(--color-danger-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
