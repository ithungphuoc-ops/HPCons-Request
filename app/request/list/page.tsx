"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import RequestStatusBadge from "@/components/request/RequestStatusBadge";
import RequestDetailView from "@/components/request/RequestDetailView";
import { useRequestContext } from "@/context/RequestContext";
import { primaryButtonClass } from "@/components/shared/form-styles";
import { resolveRequestTitle } from "@/lib/request-title";
import type { ListLoadStatus, RequestInstance, RequestListScope } from "@/lib/types";

const scopeLabels: Record<RequestListScope, string> = {
  all: "Tất cả",
  "sent-to-me": "Gửi đến tôi",
  mine: "Tôi gửi đi",
  following: "Đang theo dõi",
  group: "Nhóm đề xuất",
};

function draftLinkFor(r: RequestInstance): string {
  return r.groupId
    ? `/request/groups/${r.groupId}/submit?draftId=${r.id}`
    : `/request/direct/new?draftId=${r.id}`;
}

export default function RequestListPage() {
  return (
    <Suspense fallback={null}>
      <RequestListPageInner />
    </Suspense>
  );
}

function RequestListPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scope = (searchParams.get("scope") as RequestListScope) || "all";
  const groupId = searchParams.get("groupId");
  const selectedId = searchParams.get("id");
  const { getGroupById } = useRequestContext();
  const group = scope === "group" && groupId ? getGroupById(groupId) : undefined;

  const [requests, setRequests] = useState<RequestInstance[]>([]);
  const [status, setStatus] = useState<ListLoadStatus>("loading");
  const [currentUid, setCurrentUid] = useState<string | null>(null);

  const load = () => {
    setStatus("loading");
    const query =
      scope === "group" && groupId ? `scope=group&groupId=${groupId}` : `scope=${scope}`;
    fetch(`/api/requests?${query}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { requests: RequestInstance[] }) => {
        setRequests(data.requests ?? []);
        setStatus(data.requests?.length ? "loaded" : "empty");
      })
      .catch(() => setStatus("error"));
  };

  useEffect(load, [scope, groupId]);

  useEffect(() => {
    fetch("/api/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { uid: string } | null) => setCurrentUid(data?.uid ?? null))
      .catch(() => setCurrentUid(null));
  }, []);

  const effectiveSelectedId = selectedId ?? requests[0]?.id ?? null;
  const selectedRequest = useMemo(
    () => requests.find((r) => r.id === effectiveSelectedId) ?? null,
    [requests, effectiveSelectedId],
  );

  const selectRequest = (id: string) => {
    const query = scope === "group" && groupId ? `scope=group&groupId=${groupId}` : `scope=${scope}`;
    router.replace(`/request/list?${query}&id=${id}`);
  };

  return (
    <div className="flex h-full">
      <div className="flex w-[320px] shrink-0 flex-col border-r border-[var(--color-border)]">
        <div className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-[16px] font-semibold text-gray-900">
              {scope === "group" ? (group?.name ?? "Nhóm đề xuất") : "Danh sách đề xuất"}
            </h1>
            <p className="truncate text-[12px] text-gray-400">
              {scope === "group" ? "Đề xuất trong nhóm này" : (scopeLabels[scope] ?? scope)}
            </p>
          </div>
          {scope === "group" && groupId && (
            <Link
              href={`/request/groups/${groupId}/submit`}
              className={`${primaryButtonClass} shrink-0 gap-1 px-3`}
            >
              <Plus size={14} /> Tạo đề xuất
            </Link>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {status === "loading" && (
            <p className="px-4 py-6 text-[13px] text-gray-400">Đang tải...</p>
          )}
          {status === "error" && (
            <p className="px-4 py-6 text-[13px] text-[var(--color-danger-red)]">
              Không tải được danh sách đề xuất.
            </p>
          )}
          {status === "empty" && (
            <p className="px-4 py-6 text-[13px] text-gray-400">Không có đề xuất nào ở mục này.</p>
          )}
          {status === "loaded" &&
            requests.map((r) => {
              if (r.status === "draft") {
                return (
                  <Link
                    key={r.id}
                    href={draftLinkFor(r)}
                    className="flex flex-col gap-1 border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50"
                  >
                    <span className="truncate text-[13px] font-medium text-gray-800">
                      {resolveRequestTitle(r)}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      Nháp · cập nhật {new Date(r.updatedAt ?? r.submittedAt).toLocaleString("vi-VN")}
                    </span>
                  </Link>
                );
              }
              const isActive = r.id === effectiveSelectedId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => selectRequest(r.id)}
                  className={`flex w-full flex-col gap-1 border-b border-gray-100 px-4 py-3 text-left ${
                    isActive ? "bg-blue-50" : "hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-gray-800">
                      {resolveRequestTitle(r)}
                    </span>
                    <RequestStatusBadge status={r.status} />
                  </div>
                  <span className="truncate text-[11px] text-gray-400">
                    {r.submittedBy.uid === currentUid ? "Bạn" : r.submittedBy.name} ·{" "}
                    {new Date(r.submittedAt).toLocaleDateString("vi-VN")}
                  </span>
                </button>
              );
            })}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        {status === "loaded" && selectedRequest ? (
          <RequestDetailView request={selectedRequest} currentUid={currentUid} onActed={load} />
        ) : (
          <div className="flex h-full min-h-[300px] items-center justify-center">
            <p className="text-[13px] text-gray-400">Chọn một đề xuất bên trái để xem chi tiết.</p>
          </div>
        )}
      </div>
    </div>
  );
}
