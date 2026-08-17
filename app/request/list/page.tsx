"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Plus, X } from "lucide-react";
import RequestStatusBadge from "@/components/request/RequestStatusBadge";
import RequestDetailView from "@/components/request/RequestDetailView";
import { useRequestContext } from "@/context/RequestContext";
import { primaryButtonClass } from "@/components/shared/form-styles";
import { resolveRequestTitle, TITLE_FIELD_CODES } from "@/lib/request-title";
import type { ListLoadStatus, ProposalField, RequestInstance, RequestListScope } from "@/lib/types";

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

/**
 * Ảnh đại diện: ưu tiên ảnh THẬT từ hồ sơ app tổng (users/{uid}.avatarUrl —
 * xem /api/directory/avatars), lỗi tải/chưa có ảnh thì rơi về vòng tròn chữ
 * cái đầu — không bao giờ hiện ô ảnh vỡ.
 */
function Avatar({
  url,
  initial,
  size,
  className = "",
  fallbackClassName,
}: {
  url: string | null | undefined;
  initial: string;
  size: number;
  className?: string;
  /** class cho vòng tròn chữ cái (màu nền/chữ tuỳ ngữ cảnh: xanh, xám...). */
  fallbackClassName: string;
}) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- ảnh R2 ngoài domain, kích thước nhỏ, không cần next/image
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${fallbackClassName} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initial}
    </span>
  );
}

/** Field "nổi bật" đáng hiện trên dòng danh sách: kiểu lựa chọn/bộ phận/ngày/
 * số — giá trị ngắn, đọc phát hiểu ngay (giống chuỗi phụ của Base.vn thật). */
const NOTABLE_FIELD_TYPES = new Set(["single_choice", "department_select", "date", "datetime", "integer", "decimal", "currency"]);

function formatListValue(field: ProposalField, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "";
  const s = String(value);
  if (field.dataType === "date" || field.dataType === "datetime") {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return new Date(t).toLocaleDateString("vi-VN");
  }
  return s;
}

/** Tối đa 3 mẩu "Tên field: giá trị" cho chuỗi thông tin phụ của 1 dòng —
 * không hard-code tên field nào, nhóm nào cũng tự ra thông tin của nhóm đó. */
function notableFieldParts(r: RequestInstance): string[] {
  return r.fieldsSnapshot
    .filter((f) => NOTABLE_FIELD_TYPES.has(f.dataType) && !(f.code && TITLE_FIELD_CODES.has(f.code)))
    .sort((a, b) => a.order - b.order)
    .map((f) => ({ name: f.name, value: formatListValue(f, r.values[f.id]) }))
    .filter((x) => x.value)
    .slice(0, 3)
    .map((x) => `${x.name}: ${x.value}`);
}

/** Cụm avatar người duyệt chồng nhau (tối đa 3 + "+N"), mỗi avatar có chấm
 * quyết định nhỏ đè góc: ✓ xanh đã duyệt / ✕ đỏ từ chối / xám đang chờ —
 * icon kèm màu (không chỉ dựa màu). */
function ApproverCluster({
  request,
  avatars,
}: {
  request: RequestInstance;
  avatars: Record<string, string | null>;
}) {
  if (request.approversSnapshot.length === 0) return null;
  const decisionById = new Map(request.approvers.map((a) => [a.id, a.decision]));
  const shown = request.approversSnapshot.slice(0, 3);
  const extra = request.approversSnapshot.length - shown.length;
  return (
    // Tách rời từng người, có khoảng cách — KHÔNG chồng avatar lên nhau
    // (Sếp góp ý 17/08/2026 sau khi xem bản đầu).
    <span className="flex items-center gap-1.5">
      {shown.map((user) => {
        const decision = decisionById.get(user.id) ?? "pending";
        return (
          <span key={user.id} className="relative" title={`${user.name} — ${decision === "approved" ? "đã duyệt" : decision === "rejected" ? "từ chối" : "đang chờ"}`}>
            <Avatar
              url={avatars[user.id]}
              initial={user.avatarInitial || user.name.charAt(0).toUpperCase()}
              size={24}
              fallbackClassName="bg-gray-200 text-gray-600"
            />
            <span
              className={`absolute -bottom-0.5 -right-0.5 flex h-[11px] w-[11px] items-center justify-center rounded-full ring-1 ring-white ${
                decision === "approved" ? "bg-emerald-500" : decision === "rejected" ? "bg-red-500" : "bg-gray-300"
              }`}
            >
              {decision === "approved" && <Check size={8} strokeWidth={3.5} className="text-white" />}
              {decision === "rejected" && <X size={8} strokeWidth={3.5} className="text-white" />}
            </span>
          </span>
        );
      })}
      {extra > 0 && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-500">
          +{extra}
        </span>
      )}
    </span>
  );
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
  // Ảnh đại diện thật từ app tổng (uid → URL, null = chưa có ảnh) — tải 1 lần
  // cho mọi uid xuất hiện trong danh sách, cache trong phiên (đổi scope không
  // tải lại uid đã biết).
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});
  const avatarCache = useRef(new Map<string, string | null>());

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

  useEffect(() => {
    const uids = new Set<string>();
    for (const r of requests) {
      uids.add(r.submittedBy.uid);
      for (const a of r.approversSnapshot) uids.add(a.id);
    }
    const missing = [...uids].filter((u) => !avatarCache.current.has(u));
    if (missing.length === 0) {
      setAvatars(Object.fromEntries(avatarCache.current));
      return;
    }
    fetch(`/api/directory/avatars?uids=${missing.join(",")}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { avatars?: Record<string, string | null> } | null) => {
        for (const [uid, url] of Object.entries(data?.avatars ?? {})) {
          avatarCache.current.set(uid, url);
        }
        setAvatars(Object.fromEntries(avatarCache.current));
      })
      .catch(() => {
        // Lỗi tải avatar không chặn danh sách — mọi người hiện chữ cái đầu.
      });
  }, [requests]);

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
                    <Avatar
                      url={avatars[r.submittedBy.uid]}
                      initial={submitterInitial(r)}
                      size={36}
                      fallbackClassName="bg-gray-100 text-gray-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px]">
                          <span className="font-semibold text-gray-700">{resolveRequestTitle(r)}</span>
                          <span className="text-gray-400">
                            {"   "}Nhóm: {r.groupNameSnapshot} · cập nhật{" "}
                            {new Date(r.updatedAt ?? r.submittedAt).toLocaleString("vi-VN")}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                          Nháp
                        </span>
                      </div>
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
                  <Avatar
                    url={avatars[r.submittedBy.uid]}
                    initial={submitterInitial(r)}
                    size={36}
                    className={isActive ? "ring-2 ring-[var(--color-action-blue)]" : ""}
                    fallbackClassName={
                      isActive
                        ? "bg-[var(--color-action-blue)] text-white"
                        : "bg-blue-100 text-[var(--color-action-blue)]"
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      {/* Tiêu đề + thông tin phụ trên CÙNG 1 dòng, chữ to bằng
                          nhau như Base.vn thật (Sếp chốt 17/08/2026) — tiêu đề
                          đậm, phần thông tin nhạt hơn, dài quá thì cắt "...". */}
                      <span className="truncate text-[13px]">
                        <span
                          className={`font-semibold transition-colors duration-150 ${
                            isActive
                              ? "text-[var(--color-action-blue)]"
                              : "text-gray-800 group-hover:text-[var(--color-action-blue)]"
                          }`}
                        >
                          {resolveRequestTitle(r)}
                        </span>
                        <span className="text-gray-400">
                          {"   "}
                          {[
                            `Nhóm: ${r.groupNameSnapshot}`,
                            ...notableFieldParts(r),
                            r.submittedBy.uid === currentUid ? "Bạn" : r.submittedBy.name,
                          ].join(" · ")}
                          <span className="sm:hidden">
                            {" · "}
                            {new Date(r.submittedAt).toLocaleDateString("vi-VN")}
                          </span>
                        </span>
                      </span>
                      <div className="flex shrink-0 items-center gap-3">
                        {/* Cụm người duyệt (ảnh + chấm quyết định) — ẩn trên màn
                            hình hẹp, đã có badge trạng thái tổng thay thế. */}
                        <span className="hidden md:flex">
                          <ApproverCluster request={r} avatars={avatars} />
                        </span>
                        <RequestStatusBadge status={r.status} />
                        <span className="hidden w-[72px] text-right text-[11px] tabular-nums text-gray-400 sm:block">
                          {new Date(r.submittedAt).toLocaleDateString("vi-VN")}
                        </span>
                      </div>
                    </div>
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
