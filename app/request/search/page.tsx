"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import RequestStatusBadge from "@/components/request/RequestStatusBadge";
import { inputClass, selectClass } from "@/components/shared/form-styles";
import DatePicker from "@/components/ui/DatePicker";
import { useRequestContext } from "@/context/RequestContext";
import type { ListLoadStatus, RequestInstance, RequestStatus } from "@/lib/types";

const STATUS_OPTIONS: { value: RequestStatus | ""; label: string }[] = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "pending", label: "Đang chờ duyệt" },
  { value: "approved", label: "Đã chấp thuận" },
  { value: "rejected", label: "Đã từ chối" },
  { value: "returned", label: "Đã trả lại" },
];

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageInner />
    </Suspense>
  );
}

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { categoryGroups } = useRequestContext();
  const allGroups = categoryGroups.flatMap((c) => c.groups);

  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [groupId, setGroupId] = useState(searchParams.get("groupId") ?? "");
  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");

  const [requests, setRequests] = useState<RequestInstance[]>([]);
  const [loadStatus, setLoadStatus] = useState<ListLoadStatus>("loading");

  const runSearch = () => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (groupId) query.set("groupId", groupId);
    if (from) query.set("from", from);
    if (to) query.set("to", to);

    router.replace(`/request/search?${query.toString()}`);

    setLoadStatus("loading");
    fetch(`/api/requests/search?${query.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { requests: RequestInstance[] }) => {
        setRequests(data.requests ?? []);
        setLoadStatus(data.requests?.length ? "loaded" : "empty");
      })
      .catch(() => setLoadStatus("error"));
  };

  // Chạy tìm kiếm với bộ lọc đã lưu trên query string khi tải trang lần đầu.
  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearFilters = () => {
    setStatus("");
    setGroupId("");
    setFrom("");
    setTo("");
  };

  return (
    <div className="px-8 py-6">
      <h1 className="text-[23px] font-bold text-gray-900">Tìm kiếm đề xuất</h1>

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-[3px] border border-[var(--color-border)] bg-white p-4">
        <div>
          <label className="mb-1 block text-[11px] text-gray-400">Trạng thái</label>
          <select
            className={`${selectClass} w-[180px]`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-400">Nhóm đề xuất</label>
          <select
            className={`${selectClass} w-[200px]`}
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
          >
            <option value="">Tất cả nhóm</option>
            {allGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-400">Từ ngày</label>
          <DatePicker
            className={`${inputClass} w-[150px] text-left`}
            value={from}
            onChange={setFrom}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-gray-400">Đến ngày</label>
          <DatePicker
            className={`${inputClass} w-[150px] text-left`}
            value={to}
            onChange={setTo}
          />
        </div>
        <button
          type="button"
          onClick={runSearch}
          className="h-[36px] rounded bg-[var(--color-confirm-green)] px-5 text-[13px] font-medium text-white hover:brightness-95"
        >
          Tìm kiếm
        </button>
        <button
          type="button"
          onClick={clearFilters}
          className="h-[36px] rounded px-3 text-[13px] text-gray-500 hover:underline"
        >
          Xóa bộ lọc
        </button>
      </div>

      <div className="mt-4">
        {loadStatus === "loading" && <p className="text-[13px] text-gray-400">Đang tải...</p>}
        {loadStatus === "error" && (
          <p className="text-[13px] text-[var(--color-danger-red)]">Không tải được kết quả.</p>
        )}
        {loadStatus === "empty" && (
          <div className="flex min-h-[160px] items-center justify-center rounded-[3px] border border-dashed border-[var(--color-border)] bg-white">
            <p className="text-[13px] text-gray-400">Không tìm thấy đề xuất phù hợp.</p>
          </div>
        )}
        {loadStatus === "loaded" && (
          <div className="overflow-hidden rounded-[3px] border border-[var(--color-border)] bg-white">
            {requests.map((r) => (
              <Link
                key={r.id}
                href={`/request/requests/${r.id}`}
                className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 text-[13px] last:border-0 hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-800">{r.groupNameSnapshot}</p>
                  <p className="text-[12px] text-gray-400">
                    {r.submittedBy.name} · {new Date(r.submittedAt).toLocaleString("vi-VN")}
                  </p>
                </div>
                <RequestStatusBadge status={r.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
