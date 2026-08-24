"use client";

import { useState } from "react";
import Modal from "@/components/shared/Modal";
import { cancelButtonClass, confirmButtonClass } from "@/components/shared/form-styles";
import ApprovalTimeFieldControl, { isApprovalTimeValueMissing } from "@/components/request/ApprovalTimeFieldControl";
import type { ApprovalTimeField } from "@/lib/types";

/**
 * Trước đây "Chấp thuận" là hành động 1-bấm-xong, không có hộp thoại nào —
 * modal này CHỈ mở ra khi có "Mẫu form phê duyệt" khớp đúng bước × "Chấp
 * thuận" của người đang xử lý (xem RequestDetailView.tsx). Không có field
 * khớp thì giữ nguyên hành vi cũ, không hiện modal này.
 */
export default function ApproveConfirmModal({
  field,
  onClose,
  onConfirm,
}: {
  field: ApprovalTimeField["field"];
  onClose: () => void;
  onConfirm: (approvalTimeValue: unknown) => Promise<void>;
}) {
  const [value, setValue] = useState<unknown>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (isApprovalTimeValueMissing(field, value)) {
      setError(`Cần điền "${field.name}".`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(value);
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
        <ApprovalTimeFieldControl field={field} value={value} onChange={setValue} />
        {error && <p className="text-[12px] text-[var(--color-danger-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
