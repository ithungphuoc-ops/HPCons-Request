"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Plus, Search, X } from "lucide-react";
import RequestStatusBadge, { STATUS_LABEL } from "@/components/request/RequestStatusBadge";
import RequestDetailView from "@/components/request/RequestDetailView";
import { useRequestContext } from "@/context/RequestContext";
import { primaryButtonClass } from "@/components/shared/form-styles";
import HighlightMatch from "@/components/shared/HighlightMatch";
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

/** Tối đa 3 cặp {tên field, giá trị} nổi bật của 1 đề xuất — dùng chung cho
 * chuỗi hiển thị lẫn phạm vi tìm kiếm (chỉ tìm trên GIÁ TRỊ, không tìm trên
 * tên field để khỏi khớp nhầm mọi dòng có cùng field). */
function notableFields(r: RequestInstance): { name: string; value: string }[] {
  return r.fieldsSnapshot
    .filter((f) => NOTABLE_FIELD_TYPES.has(f.dataType) && !(f.code && TITLE_FIELD_CODES.has(f.code)))
    .sort((a, b) => a.order - b.order)
    .map((f) => ({ name: f.name, value: formatListValue(f, r.values[f.id]) }))
    .filter((x) => x.value)
    .slice(0, 3);
}

function notableFieldParts(r: RequestInstance): string[] {
  return notableFields(r).map((x) => `${x.name}: ${x.value}`);
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

/** Bỏ dấu tiếng Việt + hạ chữ thường để tìm kiếm không phụ thuộc dấu ("de nghi" khớp "Đề nghị"). */
function chuanHoaTimKiem(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim();
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
  // Bộ lọc client-side trên danh sách đã tải (Sếp yêu cầu 17/08/2026):
  // tìm theo tên (không dấu), lọc trạng thái, lọc nhóm.
  const [searchText, setSearchText] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterGroup, setFilterGroup] = useState<string>("all");

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
  }, [scope, groupId]);

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

  /** Danh sách tên nhóm duy nhất trong trang hiện tại — làm option cho bộ lọc Nhóm. */
  const groupOptions = useMemo(
    () => [...new Set(requests.map((r) => r.groupNameSnapshot))].sort((a, b) => a.localeCompare(b, "vi")),
    [requests],
  );

  const filteredRequests = useMemo(() => {
    const q = chuanHoaTimKiem(searchText);
    return requests.filter((r) => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (filterGroup !== "all" && r.groupNameSnapshot !== filterGroup) return false;
      if (q) {
        // Tìm trên: tên đề xuất + GIÁ TRỊ các field nổi bật (gồm phòng ban)
        // + tên người gửi (Sếp chốt 17/08/2026) — đều không phụ thuộc dấu.
        const haystack = chuanHoaTimKiem(
          [
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

  /** Xuất danh sách ĐANG LỌC ra file Excel .xlsx — thư viện tải lười lúc bấm,
   * không cộng vào bundle lúc mở trang. */
  const exportExcel = async () => {
    try {
      await doExportExcel();
    } catch {
      alert("Xuất Excel thất bại — thử tải lại trang rồi bấm lại.");
    }
  };

  const doExportExcel = async () => {
    const XLSX = await import("xlsx");
    const rows = filteredRequests.map((r) => ({
      "Tên đề xuất": resolveRequestTitle(r),
      "Nhóm": r.groupNameSnapshot,
      "Thông tin": notableFieldParts(r).join(" · "),
      "Người gửi": r.submittedBy.name,
      "Người duyệt": r.approversSnapshot.map((a) => a.name).join(", "),
      "Trạng thái": STATUS_LABEL[r.status],
      "Ngày": new Date(r.status === "draft" ? (r.updatedAt ?? r.submittedAt) : r.submittedAt).toLocaleDateString("vi-VN"),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 32 }, { wch: 22 }, { wch: 48 }, { wch: 20 }, { wch: 30 }, { wch: 14 }, { wch: 11 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Đề xuất");
    XLSX.writeFile(wb, `danh-sach-de-xuat-${new Date().toISOString().slice(0, 10)}.xlsx`);
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
                placeholder="Tìm theo tên, phòng ban, người gửi..."
                aria-label="Tìm theo tên đề xuất, phòng ban, hoặc người gửi"
                className="h-8 w-[220px] rounded border border-[var(--color-border)] pl-8 pr-2.5 text-[13px] text-gray-800 outline-none transition-colors duration-150 focus:border-[var(--color-action-blue)]"
              />
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="h-8 cursor-pointer rounded border border-[var(--color-border)] px-2 text-[13px] text-gray-700 outline-none transition-colors duration-150 focus:border-[var(--color-action-blue)]"
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
              className="h-8 max-w-[240px] cursor-pointer rounded border border-[var(--color-border)] px-2 text-[13px] text-gray-700 outline-none transition-colors duration-150 focus:border-[var(--color-action-blue)]"
              aria-label="Lọc theo nhóm đề xuất"
            >
              <option value="all">Nhóm: Tất cả</option>
              {groupOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={exportExcel}
              disabled={filteredRequests.length === 0}
              className="ml-auto flex h-8 cursor-pointer items-center gap-1.5 rounded border border-[var(--color-border)] px-3 text-[13px] font-medium text-gray-700 transition-colors duration-150 hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--color-border)] disabled:hover:text-gray-700"
            >
              <Download size={14} /> Xuất Excel
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {status === "loading" && (
            <p className="px-4 py-6 text-[13px] text-gray-500">Đang tải...</p>
          )}
          {status === "error" && (
            <p className="px-4 py-6 text-[13px] text-[var(--color-danger-red)]">
              Không tải được danh sách đề xuất.
            </p>
          )}
          {status === "empty" && (
            <p className="px-4 py-6 text-[13px] text-gray-500">Không có đề xuất nào ở mục này.</p>
          )}
          {/* CHƯA chọn đề xuất nào (danh sách toàn màn hình): kẻ BẢNG cột cố
              định thẳng hàng — Sếp chốt 17/08/2026 sau khi chê bản chuỗi tự do
              "thụt vào thụt ra". Bảng rộng cuộn ngang trong khung riêng (theo
              chuẩn responsive nội bộ), không làm cả trang cuộn ngang. */}
          {status === "loaded" && !selectedRequest && (
            <div className="px-4 py-4">
              <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-white">
                <table className="w-full min-w-[1000px] table-fixed border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
                      <th className="w-[32%] px-4 py-2.5 font-semibold">Tên đề xuất</th>
                      <th className="w-[8%] px-4 py-2.5 font-semibold">Nhóm</th>
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
                          Không có đề xuất nào khớp bộ lọc hiện tại.
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
                            <span className="flex items-start gap-2.5">
                              <Avatar
                                url={avatars[r.submittedBy.uid]}
                                initial={submitterInitial(r)}
                                size={28}
                                fallbackClassName={
                                  isDraft ? "bg-gray-100 text-gray-500" : "bg-blue-100 text-[var(--color-action-blue)]"
                                }
                              />
                              {/* Bỏ truncate (yêu cầu Sếp 18/08/2026) — Tên đề xuất phải hiện ĐẦY ĐỦ, tự
                                  xuống dòng thay vì cắt "...", để đổi lấy chỗ đã thu hẹp cột Nhóm/Thông tin. */}
                              <span
                                className="min-w-0 break-words font-semibold text-gray-800 transition-colors duration-150 group-hover:text-[var(--color-action-blue)]"
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
                      size={28}
                      fallbackClassName="bg-gray-100 text-gray-500"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-semibold text-gray-700">
                          {resolveRequestTitle(r)}
                        </span>
                        <span className="shrink-0">
                          <RequestStatusBadge status={r.status} />
                        </span>
                      </div>
                      <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                        {r.groupNameSnapshot} · {new Date(r.updatedAt ?? r.submittedAt).toLocaleDateString("vi-VN")}
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
                        className={`truncate text-[13px] font-semibold ${
                          isActive ? "text-[var(--color-action-blue)]" : "text-gray-800"
                        }`}
                      >
                        {resolveRequestTitle(r)}
                      </span>
                      <span className="shrink-0">
                        <RequestStatusBadge status={r.status} />
                      </span>
                    </div>
                    <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                      {r.groupNameSnapshot} · {new Date(r.submittedAt).toLocaleDateString("vi-VN")}
                    </span>
                  </div>
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
