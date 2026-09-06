"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AlertTriangle, FileSpreadsheet, Pencil, Plus, Trash2 } from "lucide-react";
import { useRequestContext } from "@/context/RequestContext";
import FieldListItem from "@/components/request/FieldListItem";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import ApprovalTimeFieldModal from "@/components/request/modals/ApprovalTimeFieldModal";
import { fieldDataTypeLabels, type ApprovalTimeField } from "@/lib/types";

const DECISION_ACTION_LABELS: Record<ApprovalTimeField["decisionAction"], string> = {
  approve: "Chấp thuận",
  reject: "Từ chối",
  forward: "Chuyển tiếp",
  approveAndForward: "Chấp thuận và chuyển tiếp",
};

export default function ProposalFormPage() {
  return (
    <RequireAdminRole>
      <ProposalFormPageInner />
    </RequireAdminRole>
  );
}

function ProposalFormPageInner() {
  const params = useParams<{ groupId: string }>();
  const { getGroupById, reorderFields, updateGroup, openAddFieldModal, openEditFieldModal } =
    useRequestContext();
  const group = getGroupById(params.groupId);
  const [approvalTimeModal, setApprovalTimeModal] = useState<{ editing: ApprovalTimeField | null } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (!group) return null;

  const approvalTimeFields = group.approvalTimeFields ?? [];

  const saveApprovalTimeField = (field: ApprovalTimeField) => {
    const exists = approvalTimeFields.some((f) => f.id === field.id);
    updateGroup(group.id, {
      approvalTimeFields: exists
        ? approvalTimeFields.map((f) => (f.id === field.id ? field : f))
        : [...approvalTimeFields, field],
    });
    setApprovalTimeModal(null);
  };

  const removeApprovalTimeField = (id: string) => {
    updateGroup(group.id, { approvalTimeFields: approvalTimeFields.filter((f) => f.id !== id) });
  };

  const stepLabelByCode = new Map(
    group.approverSteps
      .filter((s) => s.kind === "fixed" && s.code)
      .map((s, i) => [s.code as string, s.name?.trim() || `Bước ${group.approverSteps.indexOf(s) + 1 || i + 1}`]),
  );

  const sortedFields = [...group.fields].sort((a, b) => a.order - b.order);

  // Nhắc nhở nếu có trường tên đúng "Tên đề xuất" nhưng CHƯA bật "Tự động ghép
  // giá trị" (computedFrom) — phát hiện 06/09/2026: Sếp hay quên quay lại bấm
  // "Sửa trường dữ liệu" sau khi thêm trường này ở nhóm mới, khiến trường vẫn
  // ở dạng gõ tay thay vì tự khoá + tự tính như các nhóm đã cấu hình đúng. Chỉ
  // NHẮC (không tự bật hộ) — Admin vẫn phải tự vào điền mẫu chuỗi, vì hệ thống
  // không biết trước nên ghép từ những trường nào.
  const tenDeXuatField = sortedFields.find(
    (f) => f.name.trim().toLowerCase() === "tên đề xuất",
  );
  const showTenDeXuatReminder = !!tenDeXuatField && !tenDeXuatField.computedFrom;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedFields.findIndex((f) => f.id === active.id);
    const newIndex = sortedFields.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sortedFields, oldIndex, newIndex);
    reorderFields(group.id, reordered.map((f) => f.id));
  };

  const handleToggleRequired = (fieldId: string, required: boolean) => {
    updateGroup(group.id, {
      fields: group.fields.map((f) => (f.id === fieldId ? { ...f, required } : f)),
    });
  };

  const handleEdit = (field: (typeof sortedFields)[number]) => {
    openEditFieldModal(group.id, field);
  };

  const handleRemove = (fieldId: string) => {
    updateGroup(group.id, {
      fields: group.fields.filter((f) => f.id !== fieldId),
    });
  };

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-800">Mẫu biểu đề xuất</h2>
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-gray-500">
            <FileSpreadsheet size={14} className="text-green-600" />
            Kéo thả tệp Excel để nhập trường dữ liệu tùy chỉnh, hoặc{" "}
            <button type="button" className="text-[var(--color-action-blue)] hover:underline">
              tải tệp mẫu
            </button>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={() => openAddFieldModal(group.id)}
          className="flex h-[34px] shrink-0 items-center gap-1.5 rounded bg-[var(--color-action-blue)] px-3 text-[13px] font-medium text-white hover:brightness-95"
        >
          <Plus size={15} /> Thêm
        </button>
      </div>

      {showTenDeXuatReminder && (
        <div className="mb-3 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p>
            Chưa thiết lập tự động ghép cho <b>&quot;Tên đề xuất&quot;</b> — trường này đang cho gõ tay tự do, sẽ
            không tự khoá và ghép từ các trường khác như các nhóm đã cấu hình.{" "}
            <button
              type="button"
              onClick={() => handleEdit(tenDeXuatField!)}
              className="font-medium underline underline-offset-2 hover:text-amber-900"
            >
              Bấm vào đây để cấu hình ngay
            </button>
            .
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-[3px] border border-[var(--color-border)]">
        {sortedFields.length === 0 ? (
          <div className="flex min-h-[140px] items-center justify-center text-[13px] text-gray-400">
            Chưa có trường dữ liệu nào. Nhấn &quot;Thêm&quot; để tạo trường đầu tiên.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortedFields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
              {sortedFields.map((field) => (
                <FieldListItem
                  key={field.id}
                  field={field}
                  onToggleRequired={handleToggleRequired}
                  onEdit={handleEdit}
                  onRemove={handleRemove}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div className="mb-4 mt-8 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-gray-800">
            Mẫu form phê duyệt <span className="ml-1 rounded-full bg-[var(--color-cat-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-cat-text)]">MỚI</span>
          </h2>
          <p className="mt-1 text-[12px] text-gray-500">
            Field chỉ hiện cho ĐÚNG người duyệt lúc xử lý ĐÚNG hành động — không phải người gửi điền.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setApprovalTimeModal({ editing: null })}
          className="flex h-[34px] shrink-0 items-center gap-1.5 rounded border border-[var(--color-border)] px-3 text-[13px] font-medium text-gray-700 hover:bg-gray-50"
        >
          <Plus size={15} /> Thêm
        </button>
      </div>

      <div className="overflow-hidden rounded-[3px] border border-[var(--color-border)]">
        {approvalTimeFields.length === 0 ? (
          <div className="flex min-h-[100px] items-center justify-center text-[13px] text-gray-400">
            Chưa có trường nào trong Mẫu form phê duyệt.
          </div>
        ) : (
          approvalTimeFields.map((atf) => (
            <div
              key={atf.id}
              className="flex items-center justify-between gap-3 border-b border-gray-50 px-4 py-3 text-[13px] last:border-0"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-800">{atf.field.name}</p>
                <p className="mt-0.5 text-[12px] text-gray-400">
                  Liên kết đến: <b>{stepLabelByCode.get(atf.approverStepCode) ?? atf.approverStepCode}</b>
                  {" · "}Thuộc phần duyệt: <b>{DECISION_ACTION_LABELS[atf.decisionAction]}</b>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                  {fieldDataTypeLabels[atf.field.dataType]}
                </span>
                <button
                  type="button"
                  onClick={() => setApprovalTimeModal({ editing: atf })}
                  aria-label={`Sửa trường ${atf.field.name}`}
                  className="text-gray-400 hover:text-[var(--color-action-blue)]"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => removeApprovalTimeField(atf.id)}
                  aria-label={`Xóa trường ${atf.field.name}`}
                  className="text-gray-400 hover:text-[var(--color-danger-red)]"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {approvalTimeModal && (
        <ApprovalTimeFieldModal
          group={group}
          editing={approvalTimeModal.editing}
          onClose={() => setApprovalTimeModal(null)}
          onSave={saveApprovalTimeField}
        />
      )}
    </div>
  );
}
