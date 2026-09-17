"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ListFilter, Plus, Search } from "lucide-react";
import GroupPickerModal from "@/components/request/GroupPickerModal";
import RequestHomeRow from "@/components/request/RequestHomeRow";
import { primaryButtonClass } from "@/components/shared/form-styles";
import { useCurrentSession } from "@/lib/useCurrentSession";
import { useDirectoryAvatars } from "@/lib/useDirectoryAvatars";
import { exportRequestsToExcel } from "@/lib/request-export-excel";
import { chuanHoaTimKiem, draftLinkFor, notableFields } from "@/lib/request-list-format";
import { resolveRequestTitle } from "@/lib/request-title";
import { matchesRequestView, type RequestListView } from "@/lib/request-views";
import type { ListLoadStatus, RequestInstance } from "@/lib/types";

/**
 * Trang chủ Request (/request) — viết lại 17/09/2026 theo giao diện danh
 * sách tổng thể của Base.vn, thay cho bản cũ (2 ô thống kê + 5 đề xuất gần
 * đây). Xem openspec/changes/... và demo đã Sếp duyệt.
 *
 * Nguồn dữ liệu: TÁI DÙNG đúng `GET /api/requests?scope=all` mà trang
 * /request/list đang dùng cho tab "Tất cả" — đây CHÍNH LÀ "mọi đề xuất tài
 * khoản hiện tại được quyền xem" (isMine || isSentToMe || isFollowing, xem
 * app/api/requests/route.ts) mà Sếp yêu cầu, không phải chọn tuỳ tiện.
 * KHÔNG redirect route này sang /request/list — đây là trang riêng, chỉ
 * dùng chung API/logic hiển thị.
 */

// 9 tab: 4 "góc nhìn" suy ra lúc đọc (lib/request-views.ts) + 5 trạng thái
// thật. Gộp thành 1 dải theo đúng thứ tự Sếp yêu cầu.
type StatusTab = "pending" | "approved" | "rejected" | "returned" | "draft";
type HomeTab = RequestListView | StatusTab;

const HOME_TAB_ORDER: HomeTab[] = [
  "all",
  "turn",
  "overdue",
  "pending",
  "approved",
  "rejected",
  "returned",
  "bookmarked",
  "draft",
];

const HOME_TAB_LABEL: Record<HomeTab, string> = {
  all: "Tất cả",
  turn: "Đến lượt duyệt",
  overdue: "Quá hạn",
  pending: "Chờ xử lý",
  approved: "Đã chấp thuận",
  rejected: "Đã từ chối",
  returned: "Đã trả lại",
  bookmarked: "Đã đánh dấu",
  draft: "Đã lưu nháp",
};

const HOME_TAB_EMPTY: Record<Exclude<HomeTab, "all">, string> = {
  turn: "Không có đề xuất nào đang chờ đến lượt bạn duyệt.",
  overdue: "Không có đề xuất nào quá hạn xử lý.",
  pending: "Không có đề xuất nào đang chờ xử lý.",
  approved: "Không có đề xuất nào đã chấp thuận.",
  rejected: "Không có đề xuất nào đã từ chối.",
  returned: "Không có đề xuất nào đã trả lại.",
  bookmarked: "Bạn chưa đánh dấu đề xuất nào. Bấm ngôi sao ở 1 dòng để đánh dấu.",
  draft: "Bạn chưa lưu nháp nào.",
};

const STATUS_TABS = new Set<HomeTab>(["pending", "approved", "rejected", "returned", "draft"]);

function matchesHomeTab(tab: HomeTab, r: RequestInstance, uid: string | null, now: number): boolean {
  if (STATUS_TABS.has(tab)) return r.status === tab;
  return matchesRequestView(tab as RequestListView, r, uid, now);
}

const PAGE_SIZE = 20;

export default function RequestHomePage() {
  const router = useRouter();
  const { session } = useCurrentSession();
  const currentUid = session?.uid ?? null;

  const [requests, setRequests] = useState<RequestInstance[]>([]);
  const [status, setStatus] = useState<ListLoadStatus>("loading");
  const [tab, setTab] = useState<HomeTab>("all");
  const [searchText, setSearchText] = useState("");
  const [filterGroup, setFilterGroup] = useState<string>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bookmarkingIds, setBookmarkingIds] = useState<Set<string>>(new Set());
  // Mốc thời gian tính "Quá hạn" — làm mới mỗi phút, giữ trong state để
  // useMemo không đổi số mỗi lần render (xem lib/request-views.ts).
  const [now, setNow] = useState(() => Date.now());

  const avatars = useDirectoryAvatars(requests);

  const load = () => {
    setStatus("loading");
    fetch("/api/requests?scope=all")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { requests: RequestInstance[] }) => {
        setRequests(data.requests ?? []);
        setStatus(data.requests?.length ? "loaded" : "empty");
      })
      .catch(() => setStatus("error"));
  };

  useEffect(load, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Đổi tìm kiếm/bộ lọc/tab → về trang đầu (tiêu chí nghiệm thu #4).
  useEffect(() => {
    setPage(1);
  }, [searchText, filterGroup, tab]);

  const groupOptions = useMemo(
    () => [...new Set(requests.map((r) => r.groupNameSnapshot))].sort((a, b) => a.localeCompare(b, "vi")),
    [requests],
  );

  /** Lọc theo tìm kiếm + Nhóm, CHƯA áp tab — số đếm trên mỗi tab phải đếm
   * trên đúng tập này để luôn khớp số dòng thấy sau khi bấm (xem lý do
   * tương tự ở app/request/list/page.tsx). */
  const preTabRequests = useMemo(() => {
    const q = chuanHoaTimKiem(searchText);
    return requests.filter((r) => {
      if (filterGroup !== "all" && r.groupNameSnapshot !== filterGroup) return false;
      if (q) {
        const haystack = chuanHoaTimKiem(
          [r.code ?? "", resolveRequestTitle(r), ...notableFields(r).map((x) => x.value), r.submittedBy.name].join(" | "),
        );
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [requests, searchText, filterGroup]);

  const tabCounts = useMemo(() => {
    const counts = {} as Record<HomeTab, number>;
    for (const t of HOME_TAB_ORDER) counts[t] = preTabRequests.filter((r) => matchesHomeTab(t, r, currentUid, now)).length;
    return counts;
  }, [preTabRequests, currentUid, now]);

  const filteredRequests = useMemo(
    () => preTabRequests.filter((r) => matchesHomeTab(tab, r, currentUid, now)),
    [preTabRequests, tab, currentUid, now],
  );

  // Phân trang PHÍA TRÌNH DUYỆT trên dữ liệu đã tải theo scope=all — giữ
  // đúng kiến trúc hiện tại (API không hỗ trợ limit/cursor), Sếp đã duyệt
  // hướng này 17/09/2026. Nâng lên phân trang server thật để sau nếu số
  // lượng đề xuất tăng nhiều.
  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pagedRequests = filteredRequests.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const openRequest = (r: RequestInstance) => {
    if (r.status === "draft") router.push(draftLinkFor(r));
    else router.push(`/request/list?scope=all&id=${r.id}`);
  };

  const toggleBookmark = async (id: string) => {
    if (!currentUid || bookmarkingIds.has(id)) return;
    setBookmarkingIds((prev) => new Set(prev).add(id));
    // Optimistic — đổi ngay `bookmarkedByUids` trong mảng requests (không
    // phải state cục bộ riêng) để tab "Đã đánh dấu" và số đếm cập nhật
    // ngay lập tức, đúng bài học rút ra từ RequestDetailView.tsx.
    setRequests((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const has = (r.bookmarkedByUids ?? []).includes(currentUid);
        return { ...r, bookmarkedByUids: has ? (r.bookmarkedByUids ?? []).filter((u) => u !== currentUid) : [...(r.bookmarkedByUids ?? []), currentUid] };
      }),
    );
    try {
      const res = await fetch(`/api/requests/${id}/bookmark`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { bookmarkedByUids: string[] };
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, bookmarkedByUids: data.bookmarkedByUids } : r)));
    } catch {
      load(); // rollback an toàn nhất: nạp lại đúng dữ liệu thật từ server
    } finally {
      setBookmarkingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const exportExcel = async () => {
    try {
      await exportRequestsToExcel(filteredRequests);
    } catch {
      alert("Xuất Excel thất bại — thử tải lại trang rồi bấm lại.");
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Thanh tiêu đề + công cụ */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-6 py-3.5">
        <h1 className="text-[18px] font-bold text-gray-900">Danh sách đề xuất</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Tìm theo mã, tên, phòng ban, người gửi..."
              aria-label="Tìm theo mã đề nghị, tên đề xuất, phòng ban, hoặc người gửi"
              className="h-9 w-[240px] rounded-md border border-[var(--color-border)] pl-8 pr-2.5 text-[14px] text-gray-800 outline-none transition-colors duration-150 focus:border-[var(--color-action-blue)]"
            />
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              aria-expanded={filterOpen}
              className={`flex h-9 items-center gap-1.5 rounded-md border px-3 text-[14px] font-medium transition-colors duration-150 ${
                filterGroup !== "all"
                  ? "border-[var(--color-action-blue)] text-[var(--color-action-blue)]"
                  : "border-[var(--color-border)] text-gray-700 hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)]"
              }`}
            >
              <ListFilter size={14} /> Bộ lọc{filterGroup !== "all" ? " (1)" : ""}
            </button>
            {filterOpen && (
              <div className="absolute right-0 top-11 z-10 w-[260px] rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-lg">
                <label className="block text-[12px] font-medium text-gray-500">Nhóm đề xuất</label>
                <select
                  value={filterGroup}
                  onChange={(e) => setFilterGroup(e.target.value)}
                  className="mt-1 h-9 w-full cursor-pointer rounded border border-[var(--color-border)] px-2 text-[14px] text-gray-700 outline-none focus:border-[var(--color-action-blue)]"
                >
                  <option value="all">Tất cả nhóm</option>
                  {groupOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                {filterGroup !== "all" && (
                  <button
                    type="button"
                    onClick={() => setFilterGroup("all")}
                    className="mt-2 text-[12.5px] font-medium text-gray-500 hover:text-gray-800"
                  >
                    Xoá bộ lọc
                  </button>
                )}
              </div>
            )}
          </div>
          {filteredRequests.length > 0 && (
            <button
              type="button"
              onClick={exportExcel}
              title="Xuất Excel danh sách đang lọc"
              className="flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 text-[14px] font-medium text-gray-700 transition-colors duration-150 hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)]"
            >
              <Download size={14} /> Xuất Excel
            </button>
          )}
          <button type="button" onClick={() => setPickerOpen(true)} className={`${primaryButtonClass} h-9 gap-1.5`}>
            <Plus size={15} /> Tạo đề xuất
          </button>
        </div>
      </div>

      {/* 9 tab: 4 góc nhìn + 5 trạng thái */}
      <div role="group" aria-label="Lọc danh sách đề xuất" className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] px-4">
        {HOME_TAB_ORDER.map((t) => {
          const isActive = tab === t;
          return (
            <button
              key={t}
              type="button"
              aria-pressed={isActive}
              onClick={() => setTab(t)}
              className={`relative shrink-0 cursor-pointer whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] transition-colors duration-150 ${
                isActive
                  ? "border-[var(--color-action-blue)] font-semibold text-[var(--color-action-blue)]"
                  : "border-transparent font-medium text-gray-500 hover:text-gray-800"
              }`}
            >
              {HOME_TAB_LABEL[t]}
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[12px] font-semibold ${isActive ? "bg-[var(--color-action-blue)] text-white" : "bg-gray-100 text-gray-500"}`}>
                {tabCounts[t]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Danh sách */}
      <div className="flex-1 overflow-y-auto">
        {status === "loading" && <p className="px-6 py-6 text-[14px] text-gray-500">Đang tải...</p>}
        {status === "error" && (
          <div className="px-6 py-6">
            <p className="text-[14px] text-[var(--color-danger-red)]">Không tải được danh sách đề xuất.</p>
            <button type="button" onClick={load} className="mt-2 text-[13px] font-medium text-[var(--color-action-blue)] hover:underline">
              Thử lại
            </button>
          </div>
        )}
        {status !== "loading" && status !== "error" && filteredRequests.length === 0 && (
          <p className="px-6 py-8 text-center text-[14px] text-gray-500">
            {tab === "all" ? "Không có đề xuất nào khớp bộ lọc hiện tại." : HOME_TAB_EMPTY[tab]}
          </p>
        )}
        {status !== "loading" && status !== "error" && filteredRequests.length > 0 && (
          <div className="mx-4 my-3 overflow-hidden rounded-lg border border-[var(--color-border)] bg-white">
            {pagedRequests.map((r) => (
              <RequestHomeRow
                key={r.id}
                request={r}
                avatars={avatars}
                currentUid={currentUid}
                searchText={searchText}
                now={now}
                bookmarked={currentUid !== null && (r.bookmarkedByUids ?? []).includes(currentUid)}
                bookmarking={bookmarkingIds.has(r.id)}
                onToggleBookmark={() => toggleBookmark(r.id)}
                onOpen={() => openRequest(r)}
              />
            ))}
          </div>
        )}

        {status === "loaded" && totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pb-4 text-[13px] text-gray-500">
            <button
              type="button"
              disabled={pageSafe <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Trang trước"
            >
              ‹
            </button>
            Trang <b className="text-gray-800">{pageSafe}</b> / {totalPages}
            <button
              type="button"
              disabled={pageSafe >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[var(--color-border)] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Trang sau"
            >
              ›
            </button>
          </div>
        )}
      </div>

      {pickerOpen && <GroupPickerModal onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
