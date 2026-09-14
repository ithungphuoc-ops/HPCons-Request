"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import GroupPickerModal from "@/components/request/GroupPickerModal";
import RequestStatusBadge from "@/components/request/RequestStatusBadge";
import { primaryButtonClass } from "@/components/shared/form-styles";
import type { RequestInstance } from "@/lib/types";

export default function RequestHomePage() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const [recentMine, setRecentMine] = useState<RequestInstance[]>([]);

  useEffect(() => {
    fetch("/api/requests?scope=inbox")
      .then((res) => (res.ok ? res.json() : { requests: [] }))
      .then((data: { requests: RequestInstance[] }) => setInboxCount(data.requests?.length ?? 0))
      .catch(() => {});

    fetch("/api/requests?scope=mine")
      .then((res) => (res.ok ? res.json() : { requests: [] }))
      .then((data: { requests: RequestInstance[] }) => setRecentMine((data.requests ?? []).slice(0, 5)))
      .catch(() => {});
  }, []);

  return (
    <div className="px-8 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[23px] font-bold text-gray-900">Trang chủ Request</h1>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className={`${primaryButtonClass} gap-1.5`}
        >
          <Plus size={15} /> Tạo đề xuất
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/request/list?scope=sent-to-me"
          className="rounded-[3px] border border-[var(--color-border)] bg-white p-5 hover:border-[var(--color-action-blue)]"
        >
          <p className="text-[14px] text-gray-500">Chờ tôi duyệt</p>
          <p className="mt-1 text-[28px] font-bold text-gray-900">{inboxCount}</p>
        </Link>
        <Link
          href="/request/list?scope=mine"
          className="rounded-[3px] border border-[var(--color-border)] bg-white p-5 hover:border-[var(--color-action-blue)]"
        >
          <p className="text-[14px] text-gray-500">Đề xuất của tôi</p>
          <p className="mt-1 text-[14px] text-[var(--color-action-blue)]">Xem tất cả →</p>
        </Link>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-gray-800">Đề xuất gần đây của tôi</h2>
          <Link href="/request/search" className="text-[12px] text-[var(--color-action-blue)] hover:underline">
            Tìm kiếm nâng cao →
          </Link>
        </div>
        {recentMine.length === 0 ? (
          <div className="flex min-h-[140px] items-center justify-center rounded-[3px] border border-dashed border-[var(--color-border)] bg-white">
            <p className="text-[14px] text-gray-400">Bạn chưa tạo đề xuất nào.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[3px] border border-[var(--color-border)] bg-white">
            {recentMine.map((r) => (
              <Link
                key={r.id}
                href={
                  r.status === "draft"
                    ? r.groupId
                      ? `/request/groups/${r.groupId}/submit?draftId=${r.id}`
                      : `/request/direct/new?draftId=${r.id}`
                    : `/request/list?scope=mine&id=${r.id}`
                }
                className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 text-[14px] last:border-0 hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-800">{r.groupNameSnapshot}</p>
                </div>
                <RequestStatusBadge status={r.status} />
              </Link>
            ))}
          </div>
        )}
      </div>

      {pickerOpen && <GroupPickerModal onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
