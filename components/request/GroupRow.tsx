"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, Send, Star } from "lucide-react";
import { useRequestContext } from "@/context/RequestContext";
import { approvalFlowLabels, type ProposalGroup } from "@/lib/types";

export default function GroupRow({
  group,
  index,
  selected,
  onToggleSelect,
}: {
  group: ProposalGroup;
  index: number;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const { toggleGroupStatus, toggleGroupPinned } = useRequestContext();
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const handleToggleStatus = async () => {
    setToggling(true);
    setToggleError(null);
    try {
      await toggleGroupStatus(group.id);
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="flex min-h-[48px] items-center gap-3 border-b border-gray-100 px-4 py-2 text-[14px] last:border-0 hover:bg-gray-50">
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(group.id)}
        aria-label={`Chọn nhóm ${group.name}`}
        className="h-4 w-4 shrink-0 rounded border-[var(--color-border)]"
      />

      <span className="w-6 shrink-0 text-center text-gray-400">{index + 1}</span>

      <button
        type="button"
        onClick={() => toggleGroupPinned(group.id)}
        aria-label={group.pinned ? "Bỏ đánh dấu quan trọng" : "Đánh dấu quan trọng"}
        aria-pressed={group.pinned}
        className="shrink-0 text-gray-300 hover:text-amber-400"
      >
        <Star size={15} fill={group.pinned ? "currentColor" : "none"} className={group.pinned ? "text-amber-400" : ""} />
      </button>

      <div className="min-w-0 flex-[2]">
        <Link
          href={`/request/groups/${group.id}/general`}
          className="truncate font-medium text-gray-800 hover:text-[var(--color-action-blue)]"
        >
          {group.name}
        </Link>
        <p className="truncate text-[12px] text-gray-400">{group.description}</p>
      </div>

      <span className="flex-1 truncate text-gray-600">{approvalFlowLabels[group.approvalFlow]}</span>

      <span className="w-[90px] shrink-0 text-gray-600">
        {group.slaHours !== null ? `${group.slaHours} giờ` : "—"}
      </span>

      <div className="flex w-[110px] shrink-0 flex-col items-start gap-0.5">
        <button
          type="button"
          role="switch"
          aria-checked={group.status === "active"}
          aria-label={`Trạng thái nhóm ${group.name}: ${group.status === "active" ? "Đang khả dụng" : "Đang tạm đóng"}`}
          onClick={handleToggleStatus}
          disabled={toggling}
          className={`relative h-5 w-9 rounded-full transition-colors ${
            group.status === "active" ? "bg-[var(--color-confirm-green)]" : "bg-gray-300"
          } disabled:opacity-60`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
              group.status === "active" ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
        <span className="text-[12px] text-gray-400">
          {group.status === "active" ? "Đang khả dụng" : "Đang tạm đóng"}
        </span>
        {toggleError && <span className="text-[12px] text-[var(--color-danger-red)]">{toggleError}</span>}
      </div>

      <Link
        href={`/request/groups/${group.id}/submit`}
        aria-label={`Gửi đề xuất từ nhóm ${group.name}`}
        title="Gửi đề xuất"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-[var(--color-action-blue)]"
      >
        <Send size={15} />
      </Link>

      <Link
        href={`/request/groups/${group.id}/general`}
        aria-label={`Sửa nhóm ${group.name}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-[var(--color-action-blue)]"
      >
        <Pencil size={15} />
      </Link>
    </div>
  );
}
