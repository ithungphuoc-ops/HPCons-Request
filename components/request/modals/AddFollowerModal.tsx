"use client";

import { useState } from "react";
import Modal from "@/components/shared/Modal";
import TagUserInput from "@/components/shared/TagUserInput";
import { cancelButtonClass, confirmButtonClass } from "@/components/shared/form-styles";
import type { TaggedUser } from "@/lib/types";

/** Thêm 1 người theo dõi vào đề xuất ĐÃ TỒN TẠI (kể cả đã duyệt/từ chối xong)
 * — khác form sửa nháp hiện có, xem design.md của change
 * add-request-detail-base-parity, capability request-followers-management. */
export default function AddFollowerModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (user: TaggedUser) => Promise<void>;
}) {
  const [selected, setSelected] = useState<TaggedUser[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (selected.length === 0) {
      setError("Chọn 1 người để thêm vào danh sách theo dõi.");
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
      title="Thêm người theo dõi"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={cancelButtonClass}>
            Hủy bỏ
          </button>
          <button type="button" onClick={handleConfirm} disabled={submitting} className={confirmButtonClass}>
            {submitting ? "Đang thêm..." : "Thêm"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <label className="text-[13px] font-medium text-gray-700">Người theo dõi</label>
        <TagUserInput
          value={selected}
          onChange={(users) => setSelected(users.slice(-1))}
          placeholder="Gõ @ để tìm người cần thêm"
        />
        {error && <p className="text-[12px] text-[var(--color-danger-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
