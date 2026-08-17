"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
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

/** Chữ cái đầu của tên người gửi làm avatar tròn — RequestSubmitter không có
 * sẵn avatarInitial (khác TaggedUser), lấy từ ký tự đầu của name. */
function submitterInitial(r: RequestInstance): string {
  return (r.submittedBy.name?.trim().charAt(0) || "?").toUpperCase();
}

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

  // KHÔNG tự chọn sẵn đề xuất đầu tiên (Sếp chốt 16/08/2026): mặc định danh
  // sách chiếm toàn bộ chiều rộng, box nội dung chỉ hiện khi bấm vào 1 đề xuất.
  const selectedRequest = useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  );

  const baseQuery = scope === "group" && groupId ? `scope=group&groupId=${groupId}` : `scope=${scope}`;
  const selectRequest = (id: string) => {
    router.replace(`/request/list?${baseQuery}&id=${id}`);
  };
  const closeDetail = () => {
    router.replace(`/request/list?${baseQuery}`);
  };

  return (
    <div className="flex h-full">
      <div
        className={`shrink-0 flex-col ${
          selectedRequest
            ? // Đang mở box nội dung: danh sách thu về cột trái (ẩn hẳn trên
              // màn hình nhỏ để box nội dung đủ chỗ đọc — bấm "Đóng" quay lại).
              "hidden w-[320px] border-r border-[var(--color-border)] md:flex"
            : "flex w-full"
        }`}
      >
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
          {/* Dòng danh sách: avatar chữ cái + tiêu đề + dòng phụ "Nhóm · người
              gửi · ngày" + badge trạng thái. Hover: nền sáng nhẹ + vạch xanh
              trái + tiêu đề đổi xanh + mũi tên trượt vào — chỉ đổi màu/mờ/
              translate (không đổi kích thước, không giật layout), 150ms.
              Vạch trái luôn chiếm sẵn 3px (transparent khi thường) nên
              hover/chọn không xê dịch nội dung. */}
          {status === "loaded" &&
            requests.map((r) => {
              if (r.status === "draft") {
                return (
                  <Link
                    key={r.id}
                    href={draftLinkFor(r)}
                    className="group flex w-full cursor-pointer items-center gap-3 border-b border-l-[3px] border-gray-100 border-l-transparent px-4 py-3 text-left transition-colors duration-150 hover:border-l-gray-300 hover:bg-gray-50"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[13px] font-semibold text-gray-500">
                      {submitterInitial(r)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-gray-700">
                          {resolveRequestTitle(r)}
                        </span>
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                          Nháp
                        </span>
                      </div>
                      <span className="mt-0.5 block truncate text-[11px] text-gray-400">
                        {r.groupNameSnapshot} · cập nhật{" "}
                        {new Date(r.updatedAt ?? r.submittedAt).toLocaleString("vi-VN")}
                      </span>
                    </div>
                    <ChevronRight
                      size={15}
                      className="shrink-0 text-gray-300 opacity-0 transition-all duration-150 group-hover:translate-x-0.5 group-hover:opacity-100"
                    />
                  </Link>
                );
              }
              const isActive = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => selectRequest(r.id)}
                  className={`group flex w-full cursor-pointer items-center gap-3 border-b border-l-[3px] border-gray-100 px-4 py-3 text-left transition-colors duration-150 ${
                    isActive
                      ? "border-l-[var(--color-action-blue)] bg-blue-50"
                      : "border-l-transparent hover:border-l-[var(--color-action-blue)] hover:bg-blue-50/40"
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold transition-colors duration-150 ${
                      isActive
                        ? "bg-[var(--color-action-blue)] text-white"
                        : "bg-blue-100 text-[var(--color-action-blue)]"
                    }`}
                  >
                    {submitterInitial(r)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-[13px] font-semibold transition-colors duration-150 ${
                          isActive
                            ? "text-[var(--color-action-blue)]"
                            : "text-gray-800 group-hover:text-[var(--color-action-blue)]"
                        }`}
                      >
                        {resolveRequestTitle(r)}
                      </span>
                      <RequestStatusBadge status={r.status} />
                    </div>
                    {/* Nhóm đề xuất · người gửi · ngày đề nghị (Sếp chốt 17/08/2026) */}
                    <span className="mt-0.5 block truncate text-[11px] text-gray-400">
                      {r.groupNameSnapshot} ·{" "}
                      {r.submittedBy.uid === currentUid ? "Bạn" : r.submittedBy.name} ·{" "}
                      {new Date(r.submittedAt).toLocaleDateString("vi-VN")}
                    </span>
                  </div>
                  <ChevronRight
                    size={15}
                    className={`shrink-0 transition-all duration-150 ${
                      isActive
                        ? "translate-x-0.5 text-[var(--color-action-blue)] opacity-100"
                        : "text-gray-300 opacity-0 group-hover:translate-x-0.5 group-hover:opacity-100"
                    }`}
                  />
                </button>
              );
            })}
        </div>
      </div>

      {selectedRequest && (
        <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
          <button
            type="button"
            onClick={closeDetail}
            className="mb-3 flex items-center gap-1 text-[13px] font-medium text-gray-500 hover:text-gray-800"
          >
            <X size={14} /> Đóng
          </button>
          <RequestDetailView request={selectedRequest} currentUid={currentUid} onActed={load} />
        </div>
      )}
    </div>
  );
}
