"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/shared/Modal";
import TagUserInput from "@/components/shared/TagUserInput";
import ApproverStepsEditor, {
  toApproverSteps,
  type DraftApproverStep,
} from "@/components/request/ApproverStepsEditor";
import {
  cancelButtonClass,
  confirmButtonClass,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/shared/form-styles";
import { useRequestContext } from "@/context/RequestContext";
import { categoryOptions } from "@/lib/mock-data";
import {
  approvalFlowDescriptions,
  approvalFlowLabels,
  type ApprovalFlowType,
  type TaggedUser,
} from "@/lib/types";
import { validateGroupName, validateSlaHours } from "@/lib/validation";

const flowOptions: ApprovalFlowType[] = ["concurrent", "sequential", "single"];

export default function CreateGroupModal() {
  const router = useRouter();
  const { createGroupOpen, closeCreateGroup, createGroup } = useRequestContext();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [approverSteps, setApproverSteps] = useState<DraftApproverStep[]>([]);
  const [notifyManager, setNotifyManager] = useState(true);
  const [approvalFlow, setApprovalFlow] = useState<ApprovalFlowType>("concurrent");

  const [category, setCategory] = useState("");
  const [slaHours, setSlaHours] = useState<string>("");
  const [usedFor, setUsedFor] = useState<TaggedUser[]>([]);
  const [followers, setFollowers] = useState<TaggedUser[]>([]);
  const [description, setDescription] = useState("");

  const [errors, setErrors] = useState<{ name?: string; sla?: string; approvers?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  if (!createGroupOpen) return null;

  const handleSubmit = async () => {
    const nameCheck = validateGroupName(name);
    const slaValue = slaHours.trim() === "" ? null : Number(slaHours);
    const slaCheck = validateSlaHours(slaValue);
    const steps = toApproverSteps(approverSteps);

    if (!nameCheck.valid || !slaCheck.valid || !steps) {
      setErrors({
        name: nameCheck.error,
        sla: slaCheck.error,
        approvers: steps ? undefined : "Còn bước duyệt chưa chọn người cố định.",
      });
      return;
    }

    setErrors({});
    setSubmitError(null);
    setSubmitting(true);
    try {
      const group = await createGroup({
        name: name.trim(),
        description,
        category: category || "Chưa phân loại",
        approvalFlow,
        slaHours: slaValue,
        notifyManager,
        usedFor,
        approverSteps: steps,
        followers,
      });
      resetForm();
      // Đưa thẳng sang trang thiết lập mẫu biểu — nhóm mới tạo chưa có
      // trường dữ liệu nào, nếu chỉ đóng modal thì admin không biết đi đâu
      // để dựng form tiếp theo.
      router.push(`/request/groups/${group.id}/form`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Có lỗi xảy ra, vui lòng thử lại.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setName("");
    setApproverSteps([]);
    setNotifyManager(true);
    setApprovalFlow("concurrent");
    setCategory("");
    setSlaHours("");
    setUsedFor([]);
    setFollowers([]);
    setDescription("");
    setAdvancedOpen(false);
    setErrors({});
    setSubmitError(null);
  };

  const handleClose = () => {
    closeCreateGroup();
    resetForm();
  };

  return (
    <Modal
      title="Thêm nhóm đề xuất mới"
      width={760}
      onClose={handleClose}
      footer={
        <>
          <button type="button" onClick={handleClose} className={cancelButtonClass}>
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className={confirmButtonClass}
          >
            {submitting ? "Đang tạo..." : "Tạo nhóm đề xuất"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FieldRow label="Tên nhóm đề xuất" required description='Ví dụ "Đề xuất xin nghỉ phép".'>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nhập tên nhóm đề xuất"
          />
          {errors.name && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{errors.name}</p>}
        </FieldRow>

        <FieldRow
          label="Người xét duyệt"
          description="Từng bước là 1 người cố định hoặc tự động lấy trưởng đơn vị của người gửi."
        >
          <ApproverStepsEditor value={approverSteps} onChange={setApproverSteps} />
          {errors.approvers && (
            <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{errors.approvers}</p>
          )}
        </FieldRow>

        <FieldRow label="Báo quản lý trực tiếp" description="Yêu cầu thông báo tới người quản lý trực tiếp của người tạo.">
          <select
            className={selectClass}
            value={notifyManager ? "yes" : "no"}
            onChange={(e) => setNotifyManager(e.target.value === "yes")}
          >
            <option value="yes">Có</option>
            <option value="no">Không</option>
          </select>
        </FieldRow>

        <FieldRow label="Quy trình xử lý" description={approvalFlowDescriptions[approvalFlow]}>
          <select
            className={selectClass}
            value={approvalFlow}
            onChange={(e) => setApprovalFlow(e.target.value as ApprovalFlowType)}
          >
            {flowOptions.map((flow) => (
              <option key={flow} value={flow}>
                {approvalFlowLabels[flow]}
              </option>
            ))}
          </select>
        </FieldRow>

        <div className="flex justify-center py-1">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="text-[13px] font-medium text-[var(--color-action-blue)] hover:underline"
          >
            {advancedOpen ? "− Ẩn tùy chọn nâng cao" : "+ Thêm tùy chọn nâng cao"}
          </button>
        </div>

        {advancedOpen && (
          <div className="flex flex-col gap-4 border-t border-[var(--color-border)] pt-4">
            <FieldRow label="Phân loại" description="Gom nhóm theo phòng ban hoặc nghiệp vụ.">
              <input
                className={inputClass}
                list="category-options"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Chọn hoặc nhập phân loại mới"
              />
              <datalist id="category-options">
                {categoryOptions.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </FieldRow>

            <FieldRow label="Thời hạn xử lý (giờ)" description="Thời gian chuẩn để xử lý đề xuất.">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={slaHours}
                onChange={(e) => setSlaHours(e.target.value)}
                placeholder="Ví dụ: 24"
              />
              {errors.sla && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{errors.sla}</p>}
            </FieldRow>

            <FieldRow label="Sử dụng cho" description="Để trống nghĩa là toàn công ty được tạo.">
              <TagUserInput value={usedFor} onChange={setUsedFor} placeholder="Gõ @ để tìm người dùng" />
            </FieldRow>

            <FieldRow label="Người theo dõi" description="Nhận cập nhật mặc định của mọi đề xuất trong nhóm.">
              <TagUserInput value={followers} onChange={setFollowers} />
            </FieldRow>

            <FieldRow label="Mô tả nhóm đề xuất" description="Quy định sử dụng, hồ sơ cần đính kèm.">
              <textarea
                className={textareaClass}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FieldRow>
          </div>
        )}

        {submitError && (
          <p className="text-[13px] text-[var(--color-danger-red)]">{submitError}</p>
        )}
      </div>
    </Modal>
  );
}

function FieldRow({
  label,
  description,
  required,
  children,
}: {
  label: string;
  description?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="w-[200px] shrink-0 pt-1.5">
        <p className="text-[13px] font-medium text-gray-700">
          {label}
          {required && <span className="ml-0.5 text-[var(--color-danger-red)]">*</span>}
        </p>
        {description && <p className="mt-0.5 text-[12px] leading-snug text-gray-400">{description}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
