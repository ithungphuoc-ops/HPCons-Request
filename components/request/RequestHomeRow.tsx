"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, MoreHorizontal, SquareArrowOutUpRight, Star } from "lucide-react";
import Avatar from "@/components/request/Avatar";
import ApproverCluster from "@/components/request/ApproverCluster";
import RequestStatusBadge from "@/components/request/RequestStatusBadge";
import HighlightMatch from "@/components/shared/HighlightMatch";
import { draftLinkFor, notableFieldParts, submitterInitial } from "@/lib/request-list-format";
import { resolveRequestTitle } from "@/lib/request-title";
import { isRequestOverdue } from "@/lib/request-views";
import type { RequestInstance } from "@/lib/types";

/**
 * Chấm cuối dòng — Sếp chốt 17/09/2026 (đọc thẳng từ status + deadlineAt có
 * sẵn, KHÔNG cần thêm dữ liệu mới):
 *   - Xám  = đã xử lý xong (approved/rejected/returned)
 *   - Xanh = đang xử lý (pending, chưa quá hạn)
 *   - Đỏ   = quá hạn (pending + đã quá deadlineAt, dùng lại isRequestOverdue())
 * Nháp (chưa gửi) → null, không hiện chấm (Sếp chốt: nháp chưa vào quy trình
 * duyệt nên chưa có gì để "xử lý").
 */
function processingDot(r: RequestInstance, now: number): "active" | "overdue" | "done" | null {
  if (r.status === "draft") return null;
  if (r.status === "pending") return isRequestOverdue(r, now) ? "overdue" : "active";
  return "done";
}

const DOT_CLASS: Record<"active" | "overdue" | "done", string> = {
  active: "bg-[var(--color-action-blue)]",
  overdue: "bg-[var(--color-danger-red)]",
  done: "bg-gray-300",
};
const DOT_TITLE: Record<"active" | "overdue" | "done", string> = {
  active: "Đang xử lý — đang chờ duyệt, chưa quá hạn",
  overdue: "Quá hạn — đã qua thời hạn duyệt mà vẫn đang chờ xử lý",
  done: "Đã xử lý — đã có kết quả cuối cùng",
};

/**
 * 1 hàng đề xuất kiểu Base.vn — ngôi sao · tên+tóm tắt · trạng thái ·
 * người gửi › người duyệt · ngày · menu 3 chấm · chấm xử lý.
 * Dùng cho Trang chủ (/request) — xem app/request/page.tsx.
 */
export default function RequestHomeRow({
  request: r,
  avatars,
  currentUid,
  searchText,
  now,
  bookmarked,
  bookmarking,
  onToggleBookmark,
  onOpen,
}: {
  request: RequestInstance;
  avatars: Record<string, string | null>;
  currentUid: string | null;
  searchText: string;
  now: number;
  bookmarked: boolean;
  bookmarking: boolean;
  onToggleBookmark: () => void;
  onOpen: () => void;
}) {
  const isDraft = r.status === "draft";
  const dot = processingDot(r, now);
  const summaryParts = notableFieldParts(r);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Bấm ra ngoài đóng menu — menu cần đóng được thật (không chỉ dựa hover CSS)
  // để dùng được trên máy chạm.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const linkFor = () => `${window.location.origin}${isDraft ? draftLinkFor(r) : `/request/list?scope=all&id=${r.id}`}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(linkFor());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API có thể bị chặn (http, quyền trình duyệt) — im lặng bỏ qua,
      // không phải lỗi nghiệp vụ đáng chặn người dùng bằng alert().
    }
    setMenuOpen(false);
  };

  const openInNewTab = () => {
    window.open(linkFor(), "_blank", "noopener,noreferrer");
    setMenuOpen(false);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="grid grid-cols-[26px_minmax(0,1fr)_118px_196px_84px_22px_12px] items-center gap-3.5 border-b border-[var(--color-border)] px-4 py-3 last:border-0 hover:bg-blue-50/40 cursor-pointer transition-colors duration-150"
    >
      {/* A. Ngôi sao đánh dấu — không mở chi tiết khi bấm */}
      <button
        type="button"
        disabled={!currentUid || bookmarking}
        onClick={(e) => {
          e.stopPropagation();
          onToggleBookmark();
        }}
        aria-pressed={bookmarked}
        aria-label={bookmarked ? "Bỏ đánh dấu đề xuất" : "Đánh dấu đề xuất"}
        title={bookmarked ? "Bỏ đánh dấu" : "Đánh dấu đề xuất"}
        className={`flex h-5 w-5 items-center justify-center ${bookmarked ? "text-amber-500" : "text-gray-300 hover:text-amber-400"}`}
      >
        <Star size={16} fill={bookmarked ? "currentColor" : "none"} />
      </button>

      {/* B+C. Tên đề xuất + thông tin tóm tắt động */}
      <div className="min-w-0">
        <p className="truncate text-[14px] font-semibold text-gray-800" title={resolveRequestTitle(r)}>
          <HighlightMatch text={resolveRequestTitle(r)} query={searchText} />
        </p>
        <p className="mt-0.5 truncate text-[12px] text-gray-500" title={summaryParts.length ? summaryParts.join(" · ") : undefined}>
          {isDraft ? (
            `Chưa gửi · cập nhật ${new Date(r.updatedAt ?? r.submittedAt).toLocaleDateString("vi-VN")}`
          ) : summaryParts.length > 0 ? (
            <>
              Nhóm: {r.groupNameSnapshot}
              {" · "}
              <HighlightMatch text={summaryParts.join(" · ")} query={searchText} />
            </>
          ) : (
            `Nhóm: ${r.groupNameSnapshot}`
          )}
        </p>
      </div>

      {/* D. Trạng thái tổng thể */}
      <div>
        <RequestStatusBadge status={r.status} />
      </div>

      {/* E+F. Người gửi › người duyệt */}
      <div className="flex items-center gap-1.5 overflow-hidden">
        {isDraft ? (
          <span className="text-[12px] text-gray-400">— chưa gửi —</span>
        ) : (
          <>
            <Avatar
              url={avatars[r.submittedBy.uid]}
              initial={submitterInitial(r)}
              size={22}
              fallbackClassName="bg-blue-100 text-[var(--color-action-blue)]"
            />
            <span className="w-[76px] shrink-0 truncate text-[12.5px] text-gray-700">
              {r.submittedBy.uid === currentUid ? "Bạn" : <HighlightMatch text={r.submittedBy.name} query={searchText} />}
            </span>
            {r.approversSnapshot.length > 0 && (
              <>
                <span className="shrink-0 text-gray-300">›</span>
                <ApproverCluster request={r} avatars={avatars} />
              </>
            )}
          </>
        )}
      </div>

      {/* G. Ngày — ngày GỬI (submittedAt); nháp dùng ngày cập nhật gần nhất vì chưa có ngày gửi */}
      <div className="text-right text-[12.5px] tabular-nums text-gray-500">
        {new Date(isDraft ? (r.updatedAt ?? r.submittedAt) : r.submittedAt).toLocaleDateString("vi-VN")}
      </div>

      {/* Menu 3 chấm — 2 hành động thật, chạy hoàn toàn phía trình duyệt */}
      <div ref={menuRef} className="relative flex items-center justify-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          aria-label="Thêm hành động"
          aria-expanded={menuOpen}
          className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <MoreHorizontal size={16} />
        </button>
        {menuOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-7 z-10 min-w-[210px] rounded-lg border border-[var(--color-border)] bg-white p-1 shadow-lg"
          >
            <button
              type="button"
              onClick={copyLink}
              className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-50"
            >
              <Link2 size={14} /> {copied ? "Đã sao chép!" : "Sao chép địa chỉ liên kết"}
            </button>
            <button
              type="button"
              onClick={openInNewTab}
              className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-50"
            >
              <SquareArrowOutUpRight size={14} /> Mở liên kết trong tab mới
            </button>
          </div>
        )}
      </div>

      {/* Chấm xử lý cuối dòng */}
      <div className="flex justify-center" title={dot ? DOT_TITLE[dot] : undefined}>
        {dot && <span className={`h-2 w-2 rounded-full ${DOT_CLASS[dot]}`} />}
      </div>
    </div>
  );
}
