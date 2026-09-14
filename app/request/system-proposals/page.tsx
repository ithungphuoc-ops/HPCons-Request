"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import RequestStatusBadge from "@/components/request/RequestStatusBadge";
import type { ListLoadStatus, RequestInstance } from "@/lib/types";

export default function SystemProposalsPage() {
  return (
    <RequireAdminRole>
      <SystemProposalsPageInner />
    </RequireAdminRole>
  );
}

function SystemProposalsPageInner() {
  const [requests, setRequests] = useState<RequestInstance[]>([]);
  const [status, setStatus] = useState<ListLoadStatus>("loading");
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const load = () => {
    setStatus("loading");
    fetch("/api/requests?scope=system")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { requests: RequestInstance[] }) => {
        setRequests(data.requests ?? []);
        setStatus(data.requests?.length ? "loaded" : "empty");
      })
      .catch(() => setStatus("error"));
  };

  useEffect(load, []);

  const restore = async (id: string) => {
    setRestoringId(id);
    try {
      const res = await fetch(`/api/requests/${id}/restore`, { method: "POST" });
      if (res.ok) load();
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div className="px-8 py-6">
      <h1 className="text-[23px] font-bold text-gray-900">Tất cả đề xuất hệ thống</h1>
      <p className="mt-1 text-[14px] text-gray-500">
        Toàn bộ đề xuất trong công ty, kể cả đề xuất đã bị xóa (có thể khôi phục).
      </p>

      {status === "loading" && <p className="mt-6 text-[14px] text-gray-400">Đang tải...</p>}
      {status === "error" && (
        <p className="mt-6 text-[14px] text-[var(--color-danger-red)]">Không tải được danh sách.</p>
      )}
      {status === "empty" && (
        <div className="mt-6 flex min-h-[200px] items-center justify-center rounded-[3px] border border-dashed border-[var(--color-border)] bg-white">
          <p className="text-[14px] text-gray-400">Chưa có đề xuất nào trong hệ thống.</p>
        </div>
      )}

      {status === "loaded" && (
        <div className="mt-6 overflow-hidden rounded-[3px] border border-[var(--color-border)] bg-white">
          <table className="w-full text-[14px]">
            <thead className="bg-gray-50 text-left text-[12px] text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Mã</th>
                <th className="px-4 py-2 font-medium">Nhóm đề xuất</th>
                <th className="px-4 py-2 font-medium">Người tạo</th>
                <th className="px-4 py-2 font-medium">Trạng thái</th>
                <th className="px-4 py-2 font-medium">Ngày gửi</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-gray-100 ${r.deletedAt ? "bg-red-50/40" : ""}`}
                >
                  <td className="px-4 py-2.5 text-gray-500">{r.code ?? r.id.slice(0, 8)}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/request/requests/${r.id}`}
                      className="font-medium text-[var(--color-action-blue)] hover:underline"
                    >
                      {r.groupNameSnapshot}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{r.submittedBy.name}</td>
                  <td className="px-4 py-2.5">
                    <RequestStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">
                    {new Date(r.submittedAt).toLocaleDateString("vi-VN")}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {r.deletedAt ? (
                      <button
                        type="button"
                        onClick={() => restore(r.id)}
                        disabled={restoringId === r.id}
                        className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2.5 py-1 text-[12px] font-medium text-[var(--color-danger-red)] hover:bg-red-50 disabled:opacity-60"
                      >
                        <RotateCcw size={13} /> Khôi phục
                      </button>
                    ) : (
                      <span className="text-[12px] text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
