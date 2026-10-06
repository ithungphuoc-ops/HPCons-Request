"use client";

import { useState } from "react";
import Modal from "@/components/shared/Modal";
import { cancelButtonClass, textareaClass } from "@/components/shared/form-styles";
import { ADJUSTMENT_CANCEL_REASON_MAX_LENGTH } from "@/lib/adjustment-settings";

/**
 * Hộp xác nhận "Huỷ điều chỉnh" đang chờ duyệt (06/10/2026) — chỉ người đã gửi
 * điều chỉnh hoặc Owner/Admin thấy nút mở hộp này. Lý do KHÔNG bắt buộc, ghi
 * vào dòng lịch sử "Đã huỷ điều chỉnh chờ duyệt".
 */
export default function AdjustmentCancelModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Huỷ điều chỉnh đang chờ duyệt"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={submitting} className={cancelButtonClass}>
            Không huỷ
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            data-testid="adjustment-cancel-confirm"
            className="flex h-[38px] flex-1 items-center justify-center rounded bg-[var(--color-danger-red)] text-[14px] font-semibold text-white hover:brightness-95 disabled:opacity-60"
          >
            {submitting ? "Đang huỷ..." : "Xác nhận huỷ"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-[13px] text-gray-600">
          Điều chỉnh này sẽ bị huỷ, chưa có hiệu lực và không báo Kho/Thu mua. Người duyệt điều chỉnh sẽ không
          còn phải xử lý. Sau khi huỷ có thể gửi điều chỉnh mới.
        </p>
        <label className="text-[14px] font-medium text-gray-700" htmlFor="adj-cancel-reason">
          Lý do huỷ <span className="text-[12px] font-normal text-gray-400">(không bắt buộc)</span>
        </label>
        <textarea
          id="adj-cancel-reason"
          value={reason}
          maxLength={ADJUSTMENT_CANCEL_REASON_MAX_LENGTH}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          disabled={submitting}
          placeholder="Ví dụ: người duyệt nghỉ phép, gửi lại cho người khác"
          className={textareaClass}
        />
        {error && (
          <p className="text-[12px] text-[var(--color-danger-red)]" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
