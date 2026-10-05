"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Settings } from "lucide-react";
import { useRequestContext } from "@/context/RequestContext";
import CategorySettingsModal from "@/components/request/CategorySettingsModal";
import GroupRow from "@/components/request/GroupRow";
import { sortGroupsByNumber } from "@/lib/group-sort";
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

  // Logo + "Tên hiển thị khi in / tải file" RIÊNG cho từng công ty (02-HPCons/
  // 03-EQUI...) — sửa trong popup CategorySettingsModal (Sếp chốt 01/10 + 05/10/2026).
  const letterheadName = category.letterheadImageName;
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Xếp theo số đầu tên nhóm (0. → 1.0. → 1.1. …), Sếp chốt 05/10/2026 — xem lib/group-sort.ts.
  const groups = useMemo(() => sortGroupsByNumber(category.groups), [category.groups]);

  return (
    <div className="mb-4 overflow-hidden rounded-[3px] border border-[var(--color-border)] bg-[var(--color-card-bg)] shadow-sm">
      <div className="flex w-full items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => toggleCategoryCollapsed(category.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight size={16} className="shrink-0 text-gray-400" />
          ) : (
            <ChevronDown size={16} className="shrink-0 text-gray-400" />
          )}
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-gray-800">
              {category.code} - {category.name}
            </p>
            <p className="text-[12px] text-gray-400">{category.groups.length} nhóm đề xuất</p>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {letterheadName && (
            <span
              className="hidden max-w-[140px] truncate text-[11px] text-gray-400 sm:inline"
              title={letterheadName}
            >
              {letterheadName}
            </span>
          )}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex h-7 shrink-0 items-center gap-1 rounded border border-[var(--color-border)] px-2 text-[12px] font-medium text-gray-600 hover:bg-gray-50"
          >
            <Settings size={13} />
            Cài đặt thông tin
          </button>
        </div>
      </div>
      {settingsOpen && <CategorySettingsModal category={category} onClose={() => setSettingsOpen(false)} />}

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
          {groups.map((group, index) => (
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
