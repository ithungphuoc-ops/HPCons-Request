"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import Modal from "@/components/shared/Modal";
import {
  cancelButtonClass,
  confirmButtonClass,
  inputClass,
  selectClass,
} from "@/components/shared/form-styles";
import { validateFieldName, validateFieldOptions } from "@/lib/validation";
import type { ApprovalTimeField, ApproverStepDef, FieldDataType, ProposalGroup } from "@/lib/types";

/** Loại dữ liệu hợp lý cho field lúc DUYỆT (khác `AddFieldModal` — không cần
 * bảng/tệp/công thức/chọn phòng ban/chọn người ở đây, chỉ cần nhập nhanh lúc
 * xử lý quyết định). */
const APPROVAL_TIME_DATA_TYPES: FieldDataType[] = [
  "short_text",
  "paragraph",
  "integer",
  "decimal",
  "currency",
  "date",
  "datetime",
  "single_choice",
  "multiple_choice",
];

const DATA_TYPE_LABELS: Record<FieldDataType, string> = {
  integer: "Số nguyên",
  decimal: "Số thập phân",
  short_text: "Văn bản ngắn",
  paragraph: "Đoạn văn bản",
  date: "Ngày",
  datetime: "Ngày giờ",
  single_choice: "Một lựa chọn",
  multiple_choice: "Nhiều lựa chọn",
  file: "Tệp tin",
  table: "Bảng",
  currency: "Tiền tệ",
  formula: "Công thức",
  base_table: "Bảng (cơ sở)",
  section_title: "Tiêu đề mục",
  department_select: "Chọn phòng ban",
  user_select: "Chọn người",
};

const DECISION_ACTION_LABELS: Record<ApprovalTimeField["decisionAction"], string> = {
  approve: "Chấp thuận",
  reject: "Từ chối",
  forward: "Chuyển tiếp",
  approveAndForward: "Chấp thuận và chuyển tiếp",
};

const choiceTypes: FieldDataType[] = ["single_choice", "multiple_choice"];

export default function ApprovalTimeFieldModal({
  group,
  editing,
  onClose,
  onSave,
}: {
  group: ProposalGroup;
  editing: ApprovalTimeField | null;
  onClose: () => void;
  onSave: (field: ApprovalTimeField) => void;
}) {
  const fixedSteps = group.approverSteps.filter(
    (s): s is Extract<ApproverStepDef, { kind: "fixed" }> => s.kind === "fixed" && Boolean(s.code),
  );

  const [name, setName] = useState(editing?.field.name ?? "");
  const [dataType, setDataType] = useState<FieldDataType>(editing?.field.dataType ?? "short_text");
  const [required, setRequired] = useState(editing?.field.required ?? false);
  const [options, setOptions] = useState<string[]>(editing?.field.options?.length ? editing.field.options : [""]);
  const [approverStepCode, setApproverStepCode] = useState(
    editing?.approverStepCode ?? fixedSteps[0]?.code ?? "",
  );
  const [decisionAction, setDecisionAction] = useState<ApprovalTimeField["decisionAction"]>(
    editing?.decisionAction ?? "approve",
  );
  const [errors, setErrors] = useState<{ name?: string; options?: string; step?: string }>({});

  useEffect(() => {
    if (!choiceTypes.includes(dataType)) setOptions([""]);
  }, [dataType]);

  if (fixedSteps.length === 0) {
    return (
      <Modal title="Thêm trường (Mẫu form phê duyệt)" width={480} onClose={onClose}>
        <p className="text-[13px] text-gray-500">
          Nhóm chưa có bước duyệt kiểu &quot;Cố định&quot; nào — Mẫu form phê duyệt chỉ áp dụng được cho
          bước cố định. Vào tab &quot;Thiết lập chung&quot; thêm ít nhất 1 bước cố định trước.
        </p>
      </Modal>
    );
  }

  const handleSubmit = () => {
    const nameCheck = validateFieldName(name);
    const cleanedOptions = options.map((o) => o.trim()).filter(Boolean);
    const optionsCheck = validateFieldOptions(dataType, cleanedOptions);
    if (!nameCheck.valid || !optionsCheck.valid) {
      setErrors({ name: nameCheck.error, options: optionsCheck.error });
      return;
    }
    if (!approverStepCode) {
      setErrors({ step: "Chọn 1 bước duyệt cố định để gắn trường này." });
      return;
    }
    setErrors({});
    onSave({
      id: editing?.id ?? crypto.randomUUID(),
      approverStepCode,
      decisionAction,
      field: {
        id: editing?.field.id ?? crypto.randomUUID(),
        name: name.trim(),
        code: editing?.field.code,
        dataType,
        required,
        order: editing?.field.order ?? 0,
        options: choiceTypes.includes(dataType) ? cleanedOptions : undefined,
      },
    });
  };

  return (
    <Modal
      title={editing ? "Sửa trường (Mẫu form phê duyệt)" : "Thêm trường (Mẫu form phê duyệt)"}
      width={640}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={cancelButtonClass}>
            Bỏ qua
          </button>
          <button type="button" onClick={handleSubmit} className={confirmButtonClass}>
            Lưu lại
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-1">
        <p className="text-[12px] text-gray-500">
          Field chỉ hiện cho ĐÚNG người duyệt lúc xử lý ĐÚNG hành động — không phải người gửi điền.
        </p>

        <Row label="Tên trường" required>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          {errors.name && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{errors.name}</p>}
        </Row>

        <div className="grid grid-cols-2 gap-4">
          <Row label="Loại dữ liệu">
            <select className={selectClass} value={dataType} onChange={(e) => setDataType(e.target.value as FieldDataType)}>
              {APPROVAL_TIME_DATA_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DATA_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Bắt buộc trả lời?">
            <select className={selectClass} value={required ? "yes" : "no"} onChange={(e) => setRequired(e.target.value === "yes")}>
              <option value="no">Không</option>
              <option value="yes">Có</option>
            </select>
          </Row>
        </div>

        {choiceTypes.includes(dataType) && (
          <Row label="Các phương án">
            <div className="flex flex-col gap-2">
              {options.map((opt, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    value={opt}
                    onChange={(e) => setOptions((prev) => prev.map((o, i) => (i === index ? e.target.value : o)))}
                    placeholder={`Phương án ${index + 1}`}
                  />
                  <button
                    type="button"
                    aria-label="Xóa phương án"
                    onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                    className="text-gray-400 hover:text-[var(--color-danger-red)]"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setOptions((prev) => [...prev, ""])}
                className="flex items-center gap-1 self-start text-[12px] text-[var(--color-action-blue)]"
              >
                <Plus size={13} /> Thêm phương án
              </button>
              {errors.options && <p className="text-[12px] text-[var(--color-danger-red)]">{errors.options}</p>}
            </div>
          </Row>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Row label="Liên kết đến (Khối người duyệt)">
            <select className={selectClass} value={approverStepCode} onChange={(e) => setApproverStepCode(e.target.value)}>
              {fixedSteps.map((s, i) => (
                <option key={s.code} value={s.code}>
                  {s.name?.trim() || `Bước ${group.approverSteps.indexOf(s) + 1 || i + 1}`}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-gray-400">Chỉ liệt kê bước duyệt cố định</p>
            {errors.step && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{errors.step}</p>}
          </Row>
          <Row label="Thuộc phần duyệt">
            <select
              className={selectClass}
              value={decisionAction}
              onChange={(e) => setDecisionAction(e.target.value as ApprovalTimeField["decisionAction"])}
            >
              {(Object.keys(DECISION_ACTION_LABELS) as ApprovalTimeField["decisionAction"][]).map((a) => (
                <option key={a} value={a}>
                  {DECISION_ACTION_LABELS[a]}
                </option>
              ))}
            </select>
          </Row>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[13px] font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-[var(--color-danger-red)]">*</span>}
      </p>
      {children}
    </div>
  );
}
