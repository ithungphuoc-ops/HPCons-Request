"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useRequestContext } from "@/context/RequestContext";
import GroupRow from "@/components/request/GroupRow";
import type { CategoryGroup } from "@/lib/types";

export default function GroupCategoryCard({
  category,
  selectedIds,
  onToggleSelect,
}: {
  category: CategoryGroup;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const { collapsedCategoryIds, toggleCategoryCollapsed } = useRequestContext();
  const collapsed = collapsedCategoryIds.has(category.id);

  return (
    <div className="mb-4 overflow-hidden rounded-[3px] border border-[var(--color-border)] bg-[var(--color-card-bg)] shadow-sm">
      <button
        type="button"
        onClick={() => toggleCategoryCollapsed(category.id)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight size={16} className="shrink-0 text-gray-400" />
        ) : (
          <ChevronDown size={16} className="shrink-0 text-gray-400" />
        )}
        <div>
          <p className="text-[14px] font-semibold text-gray-800">
            {category.code} - {category.name}
          </p>
          <p className="text-[12px] text-gray-400">{category.groups.length} nhóm đề xuất</p>
        </div>
      </button>

      {!collapsed && (
        <div>
          <div className="flex items-center gap-3 bg-[var(--color-category-header-bg)] px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-category-header-text)]">
            <span className="w-4 shrink-0" />
            <span className="w-6 shrink-0 text-center">STT</span>
            <span className="w-[15px] shrink-0" />
            <span className="min-w-0 flex-[2]">Tên nhóm</span>
            <span className="flex-1">Quy trình</span>
            <span className="w-[90px] shrink-0">Thời hạn</span>
            <span className="w-[110px] shrink-0">Trạng thái</span>
            <span className="w-8 shrink-0" />
          </div>
          {category.groups.map((group, index) => (
            <GroupRow
              key={group.id}
              group={group}
              index={index}
              selected={selectedIds.has(group.id)}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
