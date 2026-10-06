"use client";

import { useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import Modal from "@/components/shared/Modal";
import TagUserInput from "@/components/shared/TagUserInput";
import {
  cancelButtonClass,
  confirmButtonClass,
} from "@/components/shared/form-styles";
import ApprovalTimeFieldControl, { isApprovalTimeValueMissing } from "@/components/request/ApprovalTimeFieldControl";
import DecisionNoteInput from "@/components/request/DecisionNoteInput";
import DecisionAttachmentInput, { useDecisionAttachmentUploader } from "@/components/request/DecisionAttachmentInput";
import type { DecisionNoteMode } from "@/lib/decision-note";
import type { ApprovalTimeField, RequestAttachment, TaggedUser } from "@/lib/types";

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
  /** "Ý kiến khi phê duyệt" của nhóm theo từng kiểu chuyển tiếp
   * ("approve_and_forward" ~ approveAndForward, "forward_then_approve" ~
   * forward). Thiếu key = có ô, không bắt buộc (hành vi cũ). */
  noteModeByMode,
  /** "Đính kèm tệp khi duyệt" theo từng kiểu chuyển tiếp — thiếu key = không có ô. */
  attachmentModeByMode,
  onClose,
  onConfirm,
}: {
  extraFieldByMode?: Partial<Record<ForwardMode, ApprovalTimeField["field"]>>;
  allowForwardThenApprove?: boolean;
  noteModeByMode?: Partial<Record<ForwardMode, DecisionNoteMode>>;
  attachmentModeByMode?: Partial<Record<ForwardMode, DecisionNoteMode>>;
  onClose: () => void;
  onConfirm: (
    mode: ForwardMode,
    target: TaggedUser,
    note: string,
    approvalTimeValue: unknown,
    attachments: RequestAttachment[],
  ) => Promise<void>;
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
  const [noteInvalid, setNoteInvalid] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [filesInvalid, setFilesInvalid] = useState(false);
  const uploadPicked = useDecisionAttachmentUploader();

  // Góp ý CodeRabbit (review PR #4, 24/08/2026): nếu `allowForwardThenApprove`
  // đổi từ true → false NGAY LÚC modal đang mở (nhóm vừa bị tắt cờ), radio
  // "Chuyển tiếp và Duyệt" biến mất khỏi danh sách nhưng `mode` state cũ vẫn
  // giữ giá trị đó — bấm "Xác nhận" sẽ gửi 1 mode không còn hiện trên UI.
  // Đưa mode về lựa chọn khả dụng đầu tiên trong trường hợp đó.
  useEffect(() => {
    if (!availableModes.includes(mode)) {
      setMode(availableModes[0] ?? "approve_and_forward");
      setFieldValue(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowForwardThenApprove]);

  const extraField = extraFieldByMode?.[mode];
  const noteMode: DecisionNoteMode = noteModeByMode?.[mode] ?? "optional";
  const attachmentMode: DecisionNoteMode = attachmentModeByMode?.[mode] ?? "hidden";

  const handleConfirm = async () => {
    if (target.length === 0) {
      setError("Chọn người nhận chuyển tiếp.");
      return;
    }
    if (extraField && isApprovalTimeValueMissing(extraField, fieldValue)) {
      setError(`Cần điền "${extraField.name}".`);
      return;
    }
    if (noteMode === "required" && !note.trim()) {
      setNoteInvalid(true);
      setError("Nhóm này yêu cầu nhập ý kiến khi chuyển tiếp.");
      return;
    }
    if (attachmentMode === "required" && files.length === 0) {
      setFilesInvalid(true);
      setError("Nhóm này yêu cầu đính kèm tệp khi chuyển tiếp.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Kiểu đang chọn tắt ô tệp → không gửi tệp (dù trước đó đã chọn ở kiểu khác).
      const attachments = attachmentMode === "hidden" ? [] : await uploadPicked(files);
      await onConfirm(
        mode,
        target[0],
        noteMode === "hidden" ? "" : note.trim(),
        extraField ? fieldValue : undefined,
        attachments,
      );
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
          <label className="mb-1.5 block text-[14px] font-medium text-gray-700">
            Hình thức chuyển tiếp
          </label>
          <div className="flex flex-col gap-2">
            {availableModes.map((m) => (
              <label
                key={m}
                className={`flex cursor-pointer items-start gap-2 rounded border px-3 py-2 text-[14px] ${
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
                    setNoteInvalid(false);
                    setFilesInvalid(false);
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
          <label className="mb-1 block text-[14px] font-medium text-gray-700">
            Người nhận <span className="text-[var(--color-danger-red)]">*</span>
          </label>
          <TagUserInput
            value={target}
            onChange={(users) => setTarget(users.slice(-1))}
            placeholder="Gõ @ để tìm người nhận"
          />
        </div>
        {extraField && <ApprovalTimeFieldControl field={extraField} value={fieldValue} onChange={setFieldValue} />}
        <DecisionNoteInput
          mode={noteMode}
          label="Lý do/ghi chú"
          value={note}
          onChange={(v) => {
            setNote(v);
            if (noteInvalid && v.trim()) setNoteInvalid(false);
          }}
          invalid={noteInvalid}
          placeholder=""
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
