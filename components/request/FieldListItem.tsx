"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2, Zap } from "lucide-react";
import { fieldDataTypeLabels, type ProposalField } from "@/lib/types";

interface FieldListItemProps {
  field: ProposalField;
  onToggleRequired: (fieldId: string, required: boolean) => void;
  onEdit: (field: ProposalField) => void;
  onRemove: (fieldId: string) => void;
}

export default function FieldListItem({ field, onToggleRequired, onEdit, onRemove }: FieldListItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });
  const [copied, setCopied] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isTable = field.dataType === "table" || field.dataType === "base_table";

  const copyCode = async () => {
    if (!field.code) return;
    await navigator.clipboard.writeText(`\${${field.code}}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRemove = () => {
    if (window.confirm(`Xóa trường "${field.name}"? Dữ liệu đã nhập ở trường này trên các đề xuất cũ sẽ không còn hiển thị.`)) {
      onRemove(field.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 border-b border-gray-100 bg-white px-3 py-3 text-[14px] last:border-0 ${
        isDragging ? "opacity-60 shadow-md" : ""
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Kéo để đổi thứ tự trường ${field.name}`}
        className="cursor-grab text-gray-300 hover:text-gray-500 active:cursor-grabbing"
      >
        <GripVertical size={16} />
      </button>

      <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{field.name}</span>

      {field.code && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={copyCode}
            title={
              isTable
                ? `Sao chép mã trường "${field.code}" — trong mẫu in, dùng \${column.${field.code}.0} (STT), \${column.${field.code}.1}, \${column.${field.code}.2}... cho từng cột`
                : `Sao chép mã trường \${${field.code}}`
            }
            aria-label={`Sao chép mã trường của ${field.name}`}
            className="rounded p-1 text-gray-300 opacity-0 transition-opacity hover:text-yellow-500 group-hover:opacity-100"
          >
            <Zap size={14} />
          </button>
          {copied && (
            <span className="absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-[12px] text-white">
              Đã sao chép mã trường
            </span>
          )}
        </div>
      )}

      <span className={`shrink-0 text-[12px] ${field.required ? "text-[var(--color-action-blue)]" : "text-gray-400"}`}>
        {field.required ? "Bắt buộc" : "Không bắt buộc"}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={field.required}
        aria-label={`Bắt buộc trả lời cho trường ${field.name}`}
        onClick={() => onToggleRequired(field.id, !field.required)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          field.required ? "bg-[var(--color-action-blue)]" : "bg-gray-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            field.required ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>

      <span className="shrink-0 rounded bg-gray-100 px-2 py-1 text-[12px] font-medium text-gray-600">
        {fieldDataTypeLabels[field.dataType]}
      </span>

      <button
        type="button"
        onClick={() => onEdit(field)}
        aria-label={`Sửa trường ${field.name}`}
        className="shrink-0 text-gray-300 hover:text-[var(--color-action-blue)]"
      >
        <Pencil size={15} />
      </button>

      <button
        type="button"
        onClick={handleRemove}
        aria-label={`Xóa trường ${field.name}`}
        className="shrink-0 text-gray-300 hover:text-[var(--color-danger-red)]"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}
