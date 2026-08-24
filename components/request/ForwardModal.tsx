"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import Modal from "@/components/shared/Modal";
import TagUserInput from "@/components/shared/TagUserInput";
import {
  cancelButtonClass,
  confirmButtonClass,
  textareaClass,
} from "@/components/shared/form-styles";
import ApprovalTimeFieldControl, { isApprovalTimeValueMissing } from "@/components/request/ApprovalTimeFieldControl";
import type { ApprovalTimeField, TaggedUser } from "@/lib/types";

/** "approve_and_forward" = "Chấp nhận và chuyển tiếp" (đã duyệt xong, đẩy
 * thêm 1 người cấp trên duyệt tiếp — người chuyển VẪN được ghi đã duyệt).
 * "forward_then_approve" = "Chuyển tiếp và Duyệt" (đưa người khác duyệt/xem
 * TRƯỚC, xong rồi mới quay lại chính mình duyệt tiếp) — khớp 2 luồng Sếp
 * chốt 15/08/2026 khi Nhung góp ý "chuyển tiếp là giao quyền luôn". */
export type ForwardMode = "approve_and_forward" | "forward_then_approve";

const MODE_LABEL: Record<ForwardMode, string> = {
  approve_and_forward: "Chấp nhận và chuyển tiếp",
  forward_then_approve: "Chuyển tiếp và Duyệt",
};

const MODE_NOTE: Record<ForwardMode, string> = {
  approve_and_forward:
    "Bạn được ghi nhận ĐÃ DUYỆT ngay, đồng thời thêm người bạn chọn vào duyệt tiếp sau bạn. Dùng khi bạn duyệt xong rồi đẩy lên cho 1 người cấp trên hơn duyệt thêm.",
  forward_then_approve:
    "Người bạn chọn xử lý TRƯỚC, sau đó mới quay lại tới lượt bạn — bạn KHÔNG mất quyền duyệt, quyết định của bạn vẫn ở trạng thái chờ. Dùng khi bạn chưa hiểu rõ đề xuất mà người kia hiểu, muốn xem qua trước rồi mới tự quyết định.",
};

export default function ForwardModal({
  /** "Mẫu form phê duyệt" khớp đúng bước của người đang xử lý — key theo
   * ĐÚNG ForwardMode (không phải ApprovalTimeField.decisionAction, xem cách
   * quy đổi ở RequestDetailView.tsx: "approve_and_forward" ~ "approveAndForward",
   * "forward_then_approve" ~ "forward"). undefined/thiếu key = không có field. */
  extraFieldByMode,
  /** Nhóm có cho phép "Chuyển tiếp và Duyệt" (người nhận xử lý TRƯỚC, quay lại
   * người chuyển sau) không — cờ `permissionRules.approversCanDelegateApproval`
   * của nhóm, mặc định `true` (giữ đúng hành vi cũ — trước đây LUÔN cho phép,
   * không có cờ nào). Sếp chốt 24/08/2026: kịch bản thật là A chưa hiểu đề
   * xuất, chuyển cho B hiểu rõ hơn duyệt TRƯỚC (trách nhiệm đầu tiên là B),
   * B duyệt xong quay lại A duyệt, rồi mới tới người kế tiếp — khớp đúng
   * "forward_then_approve" đã có sẵn, chỉ thiếu cờ bật/tắt theo nhóm. Tắt cờ
   * này → chỉ còn "Chấp nhận và chuyển tiếp" trong danh sách chọn. */
  allowForwardThenApprove = true,
  onClose,
  onConfirm,
}: {
  extraFieldByMode?: Partial<Record<ForwardMode, ApprovalTimeField["field"]>>;
  allowForwardThenApprove?: boolean;
  onClose: () => void;
  onConfirm: (mode: ForwardMode, target: TaggedUser, note: string, approvalTimeValue?: unknown) => Promise<void>;
}) {
  const availableModes = (Object.keys(MODE_LABEL) as ForwardMode[]).filter(
    (m) => m !== "forward_then_approve" || allowForwardThenApprove,
  );
  const [mode, setMode] = useState<ForwardMode>(availableModes[0] ?? "approve_and_forward");
  const [target, setTarget] = useState<TaggedUser[]>([]);
  const [note, setNote] = useState("");
  const [fieldValue, setFieldValue] = useState<unknown>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extraField = extraFieldByMode?.[mode];

  const handleConfirm = async () => {
    if (target.length === 0) {
      setError("Chọn người nhận chuyển tiếp.");
      return;
    }
    if (extraField && isApprovalTimeValueMissing(extraField, fieldValue)) {
      setError(`Cần điền "${extraField.name}".`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(mode, target[0], note, extraField ? fieldValue : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Chuyển tiếp đề xuất"
      width={480}
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
            {submitting ? "Đang gửi..." : "Xác nhận"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-gray-700">
            Hình thức chuyển tiếp
          </label>
          <div className="flex flex-col gap-2">
            {availableModes.map((m) => (
              <label
                key={m}
                className={`flex cursor-pointer items-start gap-2 rounded border px-3 py-2 text-[13px] ${
                  mode === m
                    ? "border-[var(--color-action-blue)] bg-blue-50"
                    : "border-[var(--color-border)]"
                }`}
              >
                <input
                  type="radio"
                  name="forward-mode"
                  className="mt-0.5"
                  checked={mode === m}
                  onChange={() => {
                    setMode(m);
                    setFieldValue(undefined);
                  }}
                />
                <span className="flex-1">{MODE_LABEL[m]}</span>
                <span title={MODE_NOTE[m]} className="mt-0.5 shrink-0 text-gray-400">
                  <HelpCircle size={14} />
                </span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-gray-700">
            Người nhận <span className="text-[var(--color-danger-red)]">*</span>
          </label>
          <TagUserInput
            value={target}
            onChange={(users) => setTarget(users.slice(-1))}
            placeholder="Gõ @ để tìm người nhận"
          />
        </div>
        {extraField && <ApprovalTimeFieldControl field={extraField} value={fieldValue} onChange={setFieldValue} />}
        <div>
          <label className="mb-1 block text-[13px] font-medium text-gray-700">Lý do/ghi chú</label>
          <textarea
            className={textareaClass}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {error && <p className="text-[12px] text-[var(--color-danger-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
