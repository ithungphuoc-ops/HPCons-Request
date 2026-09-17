"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Download, Plus, Search, X } from "lucide-react";
import RequestStatusBadge, { STATUS_LABEL } from "@/components/request/RequestStatusBadge";
import RequestDetailView from "@/components/request/RequestDetailView";
import Avatar from "@/components/request/Avatar";
import ApproverCluster from "@/components/request/ApproverCluster";
import { useRequestContext } from "@/context/RequestContext";
import { primaryButtonClass } from "@/components/shared/form-styles";
import HighlightMatch from "@/components/shared/HighlightMatch";
import { resolveRequestTitle } from "@/lib/request-title";
import { useCurrentSession } from "@/lib/useCurrentSession";
import { useDirectoryAvatars } from "@/lib/useDirectoryAvatars";
import { exportRequestsToExcel } from "@/lib/request-export-excel";
import {
  chuanHoaTimKiem,
  draftLinkFor,
  notableFields,
  notableFieldParts,
  submitterInitial,
} from "@/lib/request-list-format";
import { DEFAULT_GROUP_PERMISSION_RULES } from "@/lib/types";
import {
  matchesRequestView,
  REQUEST_VIEW_EMPTY,
  REQUEST_VIEW_LABEL,
  REQUEST_VIEW_ORDER,
  type RequestListView,
} from "@/lib/request-views";
import type { ListLoadStatus, RequestInstance, RequestListScope } from "@/lib/types";

const scopeLabels: Record<RequestListScope, string> = {
  all: "Tất cả",
  "sent-to-me": "Gửi đến tôi",
  mine: "Tôi gửi đi",
  following: "Đang theo dõi",
  group: "Nhóm đề xuất",
};


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
  const { isAdmin } = useCurrentSession();

  const [requests, setRequests] = useState<RequestInstance[]>([]);
  const [status, setStatus] = useState<ListLoadStatus>("loading");
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  // Bộ lọc client-side trên danh sách đã tải (Sếp yêu cầu 17/08/2026):
  // tìm theo tên (không dấu), lọc trạng thái, lọc nhóm.
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterGroup, setFilterGroup] = useState<string>("all");
  // Góc nhìn (tab) — bộ lọc SUY RA lúc đọc, không phải trạng thái của đề xuất.
  // Xem lib/request-views.ts để biết vì sao 3 thứ này không nằm trong RequestStatus.
  const [view, setView] = useState<RequestListView>("all");
  // Mốc thời gian để tính "Quá hạn". Giữ trong state thay vì gọi Date.now()
  // thẳng trong useMemo: nếu gọi thẳng thì mỗi lần render lại cho số khác
  // nhau, React không coi memo là ổn định và số đếm trên tab nhấp nháy.
  // Làm mới mỗi phút là đủ — hạn xử lý tính theo giờ.
  const [now, setNow] = useState(() => Date.now());

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

  // Đổi scope/nhóm thì reset bộ lọc — tránh cảnh mang bộ lọc cũ sang danh
  // sách mới (select Nhóm trỏ tới nhóm không tồn tại → hiển thị trống + bảng
  // rỗng khó hiểu).
  useEffect(() => {
    setSearchText("");
    setFilterStatus("all");
    setFilterGroup("all");
    setView("all");
  }, [scope, groupId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    fetch("/api/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { uid: string } | null) => setCurrentUid(data?.uid ?? null))
      .catch(() => setCurrentUid(null));
  }, []);

  const avatars = useDirectoryAvatars(requests);

  // KHÔNG tự chọn sẵn đề xuất đầu tiên (Sếp chốt 16/08/2026): mặc định danh
  // sách chiếm toàn bộ chiều rộng, box nội dung chỉ hiện khi bấm vào 1 đề xuất.
  const selectedRequest = useMemo(
    () => requests.find((r) => r.id === selectedId) ?? null,
    [requests, selectedId],
  );

  /** Danh sách tên nhóm duy nhất trong trang hiện tại — làm option cho bộ lọc Nhóm. */
  const groupOptions = useMemo(
    () => [...new Set(requests.map((r) => r.groupNameSnapshot))].sort((a, b) => a.localeCompare(b, "vi")),
    [requests],
  );

  /**
   * Lọc theo ô tìm kiếm + 2 select, CHƯA áp góc nhìn (tab).
   *
   * Tách riêng là có chủ ý: số đếm trên mỗi tab phải đếm trên đúng tập này,
   * nhờ vậy con số trên tab LUÔN khớp với số dòng thấy sau khi bấm vào. Nếu
   * đếm trên `requests` thô thì tab ghi "5" mà bấm vào ra 0 dòng khi đang bật
   * một bộ lọc khác — kiểu sai số khó chịu nhất với người dùng.
   */
  const preViewRequests = useMemo(() => {
    const q = chuanHoaTimKiem(searchText);
    return requests.filter((r) => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (filterGroup !== "all" && r.groupNameSnapshot !== filterGroup) return false;
      if (q) {
        // Tìm trên: MÃ đề nghị (Sếp thêm 13/09/2026) + tên đề xuất + GIÁ TRỊ các
        // field nổi bật (gồm phòng ban) + tên người gửi (Sếp chốt 17/08/2026) — đều
        // không phụ thuộc dấu.
        const haystack = chuanHoaTimKiem(
          [
            r.code ?? "",
            resolveRequestTitle(r),
            ...notableFields(r).map((x) => x.value),
            r.submittedBy.name,
          ].join(" | "),
        );
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [requests, searchText, filterStatus, filterGroup]);

  const viewCounts = useMemo(() => {
    const counts = {} as Record<RequestListView, number>;
    for (const v of REQUEST_VIEW_ORDER) {
      counts[v] = preViewRequests.filter((r) => matchesRequestView(v, r, currentUid, now)).length;
    }
    return counts;
  }, [preViewRequests, currentUid, now]);

  const filteredRequests = useMemo(
    () => preViewRequests.filter((r) => matchesRequestView(view, r, currentUid, now)),
    [preViewRequests, view, currentUid, now],
  );

  // `permissionRules.defaultFollowersCanExportData`/`defaultApproversCanExportData`
  // — CHỈ áp dụng khi đang xem đúng 1 nhóm cụ thể (scope=group, có group config
  // để đọc cờ); các scope khác (all/mine/sent-to-me/following) trộn nhiều
  // nhóm khác nhau, giữ hành vi cũ (luôn hiện) vì không có 1 bộ cờ duy nhất để
  // áp dụng. Owner/Admin (app tổng) luôn thấy; là chủ ÍT NHẤT 1 đề xuất đang
  // xem cũng luôn thấy (không bị tính là "chỉ follower/approver").
  const canExport = useMemo(() => {
    if (isAdmin) return true;
    if (scope !== "group" || !group) return true;
    if (currentUid && filteredRequests.some((r) => r.submittedBy.uid === currentUid)) return true;
    const rules = { ...DEFAULT_GROUP_PERMISSION_RULES, ...group.permissionRules };
    const isApproverHere = Boolean(
      currentUid && filteredRequests.some((r) => r.approversSnapshot.some((a) => a.id === currentUid)),
    );
    const isFollowerHere = Boolean(
      currentUid && filteredRequests.some((r) => r.followers.some((f) => f.id === currentUid)),
    );
    if (isApproverHere && !rules.defaultApproversCanExportData) return false;
    if (isFollowerHere && !rules.defaultFollowersCanExportData) return false;
    return true;
  }, [isAdmin, scope, group, currentUid, filteredRequests]);

  /** Xuất danh sách ĐANG LỌC ra file Excel .xlsx — logic thật nằm ở
   * lib/request-export-excel.ts, dùng chung với Trang chủ (/request). */
  const exportExcel = async () => {
    try {
      await exportRequestsToExcel(filteredRequests);
    } catch {
      alert("Xuất Excel thất bại — thử tải lại trang rồi bấm lại.");
    }
  };

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
            <p className="truncate text-[12px] text-gray-500">
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

        {/* Dải tab "góc nhìn" (Sếp chốt 14/09/2026) — Đến lượt duyệt / Quá hạn /
            Đã đánh dấu. KHÁC với select "Trạng thái" ngay bên dưới: select lọc
            theo trạng thái THẬT của đề xuất, còn dải tab này lọc theo quan hệ
            giữa đề xuất và NGƯỜI ĐANG XEM tại THỜI ĐIỂM XEM. Hai thứ chồng
            nhau được (vd: tab "Quá hạn" + trạng thái "Chờ xử lý").

            Hiện ở CẢ 2 chế độ (bảng toàn màn hình và cột thu gọn) — khác thanh
            công cụ bên dưới vốn chỉ hiện ở chế độ bảng — vì khi đang mở một đề
            xuất thì vẫn cần đổi tab để nhảy sang việc khác. Lưu ý: dưới khổ md
            (768px), lúc đang mở một đề xuất thì cả cột trái bị ẩn (`hidden
            md:flex` ở trên) nên dải tab cũng không thấy — đóng đề xuất lại là
            hiện. */}
        {status === "loaded" && (
          <div
            role="group"
            aria-label="Lọc nhanh danh sách đề xuất"
            className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] px-2"
          >
            {REQUEST_VIEW_ORDER.map((v) => {
              const isActive = view === v;
              return (
                <button
                  key={v}
                  type="button"
                  // CỐ Ý không dùng role="tab"/"tablist": mẫu ARIA Tabs đòi
                  // phải có phần tử role="tabpanel" tương ứng + điều hướng
                  // bằng phím mũi tên. App không có cả hai, khai role="tab"
                  // suông thì trình đọc màn hình đọc "tab, đã chọn" rồi không
                  // có panel nào để nhảy tới. Đây thực chất là nhóm nút bật/tắt
                  // lọc, nên dùng aria-pressed — phím Tab gốc chạy đúng ngay.
                  aria-pressed={isActive}
                  onClick={() => setView(v)}
                  className={`relative shrink-0 cursor-pointer whitespace-nowrap border-b-2 px-3 py-2.5 text-[14px] transition-colors duration-150 ${
                    isActive
                      ? "border-[var(--color-action-blue)] font-semibold text-[var(--color-action-blue)]"
                      : "border-transparent font-medium text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {REQUEST_VIEW_LABEL[v]}
                  <span
                    className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[12px] font-semibold ${
                      isActive ? "bg-[var(--color-action-blue)] text-white" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {viewCounts[v]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Thanh công cụ: tìm kiếm (không dấu) + lọc trạng thái/nhóm + Xuất
            Excel — chỉ hiện ở chế độ bảng toàn màn hình (Sếp yêu cầu 17/08/2026). */}
        {status === "loaded" && !selectedRequest && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
            <label className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Tìm theo mã, tên, phòng ban, người gửi..."
                aria-label="Tìm theo mã đề nghị, tên đề xuất, phòng ban, hoặc người gửi"
                className="h-8 w-[220px] rounded border border-[var(--color-border)] pl-8 pr-2.5 text-[14px] text-gray-800 outline-none transition-colors duration-150 focus:border-[var(--color-action-blue)]"
              />
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="h-8 cursor-pointer rounded border border-[var(--color-border)] px-2 text-[14px] text-gray-700 outline-none transition-colors duration-150 focus:border-[var(--color-action-blue)]"
              aria-label="Lọc theo trạng thái"
            >
              <option value="all">Trạng thái: Tất cả</option>
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={filterGroup}
              onChange={(e) => setFilterGroup(e.target.value)}
              className="h-8 max-w-[240px] cursor-pointer rounded border border-[var(--color-border)] px-2 text-[14px] text-gray-700 outline-none transition-colors duration-150 focus:border-[var(--color-action-blue)]"
              aria-label="Lọc theo nhóm đề xuất"
            >
              <option value="all">Nhóm: Tất cả</option>
              {groupOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {canExport && (
              <button
                type="button"
                onClick={exportExcel}
                disabled={filteredRequests.length === 0}
                className="ml-auto flex h-8 cursor-pointer items-center gap-1.5 rounded border border-[var(--color-border)] px-3 text-[14px] font-medium text-gray-700 transition-colors duration-150 hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--color-border)] disabled:hover:text-gray-700"
              >
                <Download size={14} /> Xuất Excel
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {status === "loading" && (
            <p className="px-4 py-6 text-[14px] text-gray-500">Đang tải...</p>
          )}
          {status === "error" && (
            <p className="px-4 py-6 text-[14px] text-[var(--color-danger-red)]">
              Không tải được danh sách đề xuất.
            </p>
          )}
          {status === "empty" && (
            <p className="px-4 py-6 text-[14px] text-gray-500">Không có đề xuất nào ở mục này.</p>
          )}
          {/* CHƯA chọn đề xuất nào (danh sách toàn màn hình): kẻ BẢNG cột cố
              định thẳng hàng — Sếp chốt 17/08/2026 sau khi chê bản chuỗi tự do
              "thụt vào thụt ra". Bảng rộng cuộn ngang trong khung riêng (theo
              chuẩn responsive nội bộ), không làm cả trang cuộn ngang. */}
          {status === "loaded" && !selectedRequest && (
            <div className="px-4 py-4">
              <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-white">
                <table className="w-full min-w-[1000px] table-fixed border-collapse text-[14px]">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-gray-50 text-left text-[12px] uppercase tracking-wider text-gray-500">
                      <th className="w-[26%] px-4 py-2.5 font-semibold">Tên đề xuất</th>
                      <th className="w-[10%] px-4 py-2.5 font-semibold">Nhóm</th>
                      <th className="px-4 py-2.5 font-semibold">Thông tin</th>
                      <th className="w-[12%] px-4 py-2.5 font-semibold">Người gửi</th>
                      <th className="w-[160px] px-4 py-2.5 font-semibold">Người duyệt</th>
                      <th className="w-[150px] px-4 py-2.5 font-semibold">Trạng thái</th>
                      <th className="w-[104px] px-4 py-2.5 text-right font-semibold">Ngày</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredRequests.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                          {/* Nói rõ đang rỗng VÌ tab nào, thay vì câu chung chung
                              "không khớp bộ lọc" khiến người dùng không biết gỡ đâu. */}
                          {view === "all"
                            ? "Không có đề xuất nào khớp bộ lọc hiện tại."
                            : REQUEST_VIEW_EMPTY[view]}
                        </td>
                      </tr>
                    )}
                    {filteredRequests.map((r) => {
                      const isDraft = r.status === "draft";
                      return (
                        <tr
                          key={r.id}
                          tabIndex={0}
                          onClick={() => (isDraft ? router.push(draftLinkFor(r)) : selectRequest(r.id))}
                          onKeyDown={(e) => {
                            // Cho phép mở bằng bàn phím (Tab tới dòng, Enter/Space mở)
                            // — tr onClick suông không focus được bằng Tab.
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (isDraft) router.push(draftLinkFor(r));
                              else selectRequest(r.id);
                            }
                          }}
                          className="group cursor-pointer transition-colors duration-150 hover:bg-blue-50/40 focus-visible:bg-blue-50/60 focus-visible:outline-none"
                        >
                          <td className="px-4 py-2.5">
                            <span className="flex items-center gap-2.5">
                              <Avatar
                                url={avatars[r.submittedBy.uid]}
                                initial={submitterInitial(r)}
                                name={r.submittedBy.name}
                                size={28}
                                fallbackClassName={
                                  isDraft ? "bg-gray-100 text-gray-500" : "bg-blue-100 text-[var(--color-action-blue)]"
                                }
                              />
                              {/* Bỏ truncate (yêu cầu Sếp 18/08/2026) — Tên đề xuất phải hiện ĐẦY ĐỦ, tự
                                  xuống dòng thay vì cắt "...", để đổi lấy chỗ đã thu hẹp cột Nhóm/Thông tin.
                                  Vẫn giữ title tooltip làm lưới an toàn phòng khi JSX này được tái sử dụng
                                  ở chỗ khác có bề rộng hẹp hơn (phát hiện qua code review 18/08/2026). */}
                              <span
                                className="min-w-0 break-words font-semibold text-gray-800 transition-colors duration-150 group-hover:text-[var(--color-action-blue)]"
                                title={resolveRequestTitle(r)}
                              >
                                <HighlightMatch text={resolveRequestTitle(r)} query={searchText} />
                              </span>
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="block truncate text-gray-500" title={r.groupNameSnapshot}>
                              {r.groupNameSnapshot}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="block truncate text-gray-500" title={isDraft ? undefined : notableFieldParts(r).join(" · ")}>
                              {isDraft ? (
                                `Cập nhật ${new Date(r.updatedAt ?? r.submittedAt).toLocaleString("vi-VN")}`
                              ) : notableFieldParts(r).length > 0 ? (
                                <HighlightMatch text={notableFieldParts(r).join(" · ")} query={searchText} />
                              ) : (
                                "—"
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="block truncate text-gray-500">
                              {r.submittedBy.uid === currentUid ? (
                                "Bạn"
                              ) : (
                                <HighlightMatch text={r.submittedBy.name} query={searchText} />
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            {!isDraft && r.approversSnapshot.length > 0 ? (
                              <ApproverCluster request={r} avatars={avatars} />
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <RequestStatusBadge status={r.status} />
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                            {new Date(isDraft ? (r.updatedAt ?? r.submittedAt) : r.submittedAt).toLocaleDateString("vi-VN")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ĐANG mở box nội dung (cột trái 320px): dòng rút gọn 2 tầng —
              bảng 7 cột không nhét vừa cột hẹp. Giữ hover/active như cũ. */}
          {status === "loaded" && selectedRequest && filteredRequests.length === 0 && (
            <p className="px-3 py-6 text-[14px] text-gray-500">
              {view === "all" ? "Không có đề xuất nào khớp bộ lọc hiện tại." : REQUEST_VIEW_EMPTY[view]}
            </p>
          )}
          {status === "loaded" &&
            selectedRequest &&
            filteredRequests.map((r) => {
              if (r.status === "draft") {
                return (
                  <Link
                    key={r.id}
                    href={draftLinkFor(r)}
                    className="flex w-full cursor-pointer items-center gap-2.5 border-b border-l-[3px] border-gray-100 border-l-transparent px-3 py-2.5 text-left transition-colors duration-150 hover:border-l-gray-300 hover:bg-gray-50"
                  >
                    <Avatar
                      url={avatars[r.submittedBy.uid]}
                      initial={submitterInitial(r)}
                      name={r.submittedBy.name}
                      size={28}
                      fallbackClassName="bg-gray-100 text-gray-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[14px] font-semibold text-gray-700">
                          {resolveRequestTitle(r)}
                        </span>
                        <span className="shrink-0">
                          <RequestStatusBadge status={r.status} />
                        </span>
                      </div>
                      {/* Mã đề nghị thay tên nhóm (Sếp chốt 13/09/2026) — đề xuất cũ chưa có mã
                          thì vẫn hiện tên nhóm để dòng không trống. */}
                      <span className="mt-0.5 block truncate text-[12px] text-gray-500">
                        {r.code ?? r.groupNameSnapshot} · {new Date(r.updatedAt ?? r.submittedAt).toLocaleDateString("vi-VN")}
                      </span>
                    </div>
                  </Link>
                );
              }
              const isActive = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => selectRequest(r.id)}
                  className={`flex w-full cursor-pointer items-center gap-2.5 border-b border-l-[3px] border-gray-100 px-3 py-2.5 text-left transition-colors duration-150 ${
                    isActive
                      ? "border-l-[var(--color-action-blue)] bg-blue-50"
                      : "border-l-transparent hover:border-l-[var(--color-action-blue)] hover:bg-blue-50/40"
                  }`}
                >
                  <Avatar
                    url={avatars[r.submittedBy.uid]}
                    initial={submitterInitial(r)}
                    name={r.submittedBy.name}
                    size={28}
                    fallbackClassName={
                      isActive
                        ? "bg-[var(--color-action-blue)] text-white"
                        : "bg-blue-100 text-[var(--color-action-blue)]"
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-[14px] font-semibold ${
                          isActive ? "text-[var(--color-action-blue)]" : "text-gray-800"
                        }`}
                      >
                        {resolveRequestTitle(r)}
                      </span>
                      <span className="shrink-0">
                        <RequestStatusBadge status={r.status} />
                      </span>
                    </div>
                    {/* Mã đề nghị thay tên nhóm (Sếp chốt 13/09/2026) — fallback tên nhóm khi chưa có mã. */}
                    <span className="mt-0.5 block truncate text-[12px] text-gray-500">
                      <HighlightMatch text={r.code ?? r.groupNameSnapshot} query={searchText} /> ·{" "}
                      {new Date(r.submittedAt).toLocaleDateString("vi-VN")}
                    </span>
                  </div>
                </button>
              );
            })}
        </div>
      </div>

      {/* px-8 = 64px lề hai bên — trên điện thoại 390px thì đó là 1/5 bề ngang
          còn lại, nên thu về px-4 và chỉ nới ra từ khổ md. */}
      {selectedRequest && (
        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-4 md:px-8 md:py-6">
          <button
            type="button"
            onClick={closeDetail}
            className="mb-3 flex items-center gap-1 text-[14px] font-medium text-gray-500 hover:text-gray-800"
          >
            <X size={14} /> Đóng
          </button>
          <RequestDetailView request={selectedRequest} currentUid={currentUid} onActed={load} />
        </div>
      )}
    </div>
  );
}
