"use client";

import { useEffect, useState } from "react";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import type { GroupHistoryEntry, ListLoadStatus } from "@/lib/types";

export default function GroupHistoryPage() {
  return (
    <RequireAdminRole>
      <GroupHistoryPageInner />
    </RequireAdminRole>
  );
}

function GroupHistoryPageInner() {
  const [entries, setEntries] = useState<GroupHistoryEntry[]>([]);
  const [status, setStatus] = useState<ListLoadStatus>("loading");

  useEffect(() => {
    fetch("/api/groups/history")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { entries: GroupHistoryEntry[] }) => {
        setEntries(data.entries ?? []);
        setStatus(data.entries?.length ? "loaded" : "empty");
      })
      .catch(() => setStatus("error"));
  }, []);

  return (
    <div className="px-8 py-6">
      <h1 className="text-[23px] font-bold text-gray-900">Lịch sử chỉnh sửa nhóm</h1>
      <p className="mt-1 text-[14px] text-gray-500">
        Ghi lại người thực hiện, thời gian và giá trị trước/sau mỗi lần chỉnh sửa nhóm đề xuất.
      </p>

      {status === "loading" && <p className="mt-6 text-[14px] text-gray-400">Đang tải...</p>}
      {status === "error" && (
        <p className="mt-6 text-[14px] text-[var(--color-danger-red)]">Không tải được lịch sử.</p>
      )}
      {status === "empty" && (
        <div className="mt-6 flex min-h-[200px] items-center justify-center rounded-[3px] border border-dashed border-[var(--color-border)] bg-white">
          <p className="text-[14px] text-gray-400">Chưa có thay đổi nào được ghi lại.</p>
        </div>
      )}

      {status === "loaded" && (
        <div className="mt-6 flex flex-col gap-3">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="overflow-hidden rounded-[3px] border border-[var(--color-border)] bg-white p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[14px] font-medium text-gray-800">
                  <span className="text-[var(--color-action-blue)]">{entry.actor}</span>{" "}
                  {entry.action.toLowerCase()} nhóm{" "}
                  <span className="font-semibold">{entry.groupName}</span>
                </p>
                <span className="shrink-0 text-[12px] text-gray-400">
                  {new Date(entry.at).toLocaleString("vi-VN")}
                </span>
              </div>

              {entry.changes.length > 0 && (
                <table className="mt-3 w-full text-[12px]">
                  <thead className="text-left text-gray-400">
                    <tr>
                      <th className="w-1/3 py-1 font-medium">Trường</th>
                      <th className="w-1/3 py-1 font-medium">Trước</th>
                      <th className="w-1/3 py-1 font-medium">Sau</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.changes.map((c, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="py-1.5 text-gray-600">{c.field}</td>
                        <td className="py-1.5 text-gray-500">{c.before}</td>
                        <td className="py-1.5 font-medium text-gray-800">{c.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
