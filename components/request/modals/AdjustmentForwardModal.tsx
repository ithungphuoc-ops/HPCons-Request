"use client";

import { useState } from "react";
import Modal from "@/components/shared/Modal";
import TagUserInput from "@/components/shared/TagUserInput";
import { cancelButtonClass, confirmButtonClass } from "@/components/shared/form-styles";
import type { TaggedUser } from "@/lib/types";

/**
 * "Chuyển tiếp" 1 điều chỉnh sau duyệt đang chờ sang người khác xử lý — Decision
 * 6 của change add-adjustment-approval-gate (người duyệt mặc định vắng mặt, vd
 * Trưởng phòng Thu mua cung ứng nghỉ thai sản). KHÁC `ForwardModal.tsx` (luồng
 * duyệt CHÍNH của đề xuất, có thêm lựa chọn "chấp thuận và chuyển tiếp"/"chuyển
 * tiếp cho duyệt trước") — đây chỉ đổi người xử lý, đơn giản hơn nhiều.
 */
export default function AdjustmentForwardModal({
  currentApproverName,
  excludeIds,
  onClose,
  onConfirm,
}: {
  currentApproverName: string;
  /** Người đề nghị điều chỉnh + những người đang trong danh sách duyệt — ẩn
   * khỏi gợi ý (máy chủ vẫn chặn lại nếu gọi thẳng API). */
  excludeIds?: string[];
  onClose: () => void;
  onConfirm: (user: TaggedUser) => Promise<void>;
}) {
  const [selected, setSelected] = useState<TaggedUser[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (selected.length === 0) {
      setError("Chọn 1 người để chuyển tiếp xử lý.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(selected[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Chuyển tiếp điều chỉnh sau duyệt"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={cancelButtonClass}>
            Hủy bỏ
          </button>
          <button type="button" onClick={handleConfirm} disabled={submitting} className={confirmButtonClass}>
            {submitting ? "Đang chuyển tiếp..." : "Xác nhận chuyển tiếp"}
          </button>
        </>
      }
    >
      {/* Đủ cao để danh sách gợi ý (gõ @) không bị khung hộp thoại cắt mất. */}
      <div className="flex min-h-[260px] flex-col gap-2">
        <p className="text-[13px] text-gray-500">
          Đang giao cho <span className="font-medium text-gray-700">{currentApproverName}</span> — chọn người khác
          xử lý thay (ví dụ vắng mặt tạm thời). Người nhận thay đúng phần duyệt của bạn, không được là người
          đề nghị điều chỉnh hay người duyệt còn lại.
        </p>
        <label className="text-[14px] font-medium text-gray-700">Chuyển tiếp cho</label>
        <TagUserInput
          value={selected}
          onChange={(users) => setSelected(users.slice(-1))}
          placeholder="Gõ @ để tìm người xử lý thay"
          excludeIds={excludeIds}
        />
        {error && <p className="text-[12px] text-[var(--color-danger-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
