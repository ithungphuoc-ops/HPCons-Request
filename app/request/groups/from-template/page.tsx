"use client";

import { useRequestContext } from "@/context/RequestContext";
import { groupTemplates } from "@/lib/mock-data";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import { Layers } from "lucide-react";

export default function FromTemplatePage() {
  return (
    <RequireAdminRole>
      <FromTemplatePageInner />
    </RequireAdminRole>
  );
}

function FromTemplatePageInner() {
  const { openCreateGroup } = useRequestContext();

  return (
    <div className="px-8 py-6">
      <h1 className="text-[23px] font-bold text-gray-900">Tạo nhóm từ mẫu</h1>
      <p className="mt-1 text-[14px] text-gray-500">
        Chọn một mẫu có sẵn để dựng nhanh nhóm đề xuất, sau đó chỉnh sửa lại theo nhu cầu.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groupTemplates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={openCreateGroup}
            className="flex items-center gap-3 rounded-[3px] border border-[var(--color-border)] bg-white p-4 text-left hover:border-[var(--color-action-blue)]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-blue-50 text-[var(--color-action-blue)]">
              <Layers size={16} />
            </span>
            <span className="text-[14px] font-medium text-gray-800">{template.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
