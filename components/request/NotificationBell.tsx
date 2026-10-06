"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AtSign,
  Bell,
  CheckCircle2,
  Eye,
  History,
  Inbox,
  MessageSquare,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Undo2,
  UserX,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { listenRequestChanges } from "@/lib/firebase/request-change-signal";
import {
  REQUEST_VIEWED_EVENT,
  type NotificationEntry,
  type NotificationFeed,
  type NotificationKind,
} from "@/lib/notification-feed";

/** Tải lại dự phòng khi tab đang mở — tín hiệu tức thì mới là đường chính. */
const FALLBACK_REFRESH_MS = 120_000;
/** Gom nhiều tín hiệu sát nhau thành 1 lần tải. */
const DEBOUNCE_MS = 800;

/** "5 phút trước" / "Hôm qua 14:20" — dễ đọc hơn dãy "09:37:16 15/9/2026".
 * Giờ đầy đủ vẫn còn, nằm ở `title` của dòng (rê chuột là thấy). */
function nhanThoiGian(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const phut = Math.floor((now - t) / 60000);
  if (phut < 1) return "Vừa xong";
  if (phut < 60) return `${phut} phút trước`;
  const gio = Math.floor(phut / 60);
  if (gio < 24) return `${gio} giờ trước`;
  const d = new Date(t);
  const hhmm = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const ngay = Math.floor(gio / 24);
  if (ngay === 1) return `Hôm qua ${hhmm}`;
  if (ngay < 7) return `${ngay} ngày trước`;
  return `${d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} ${hhmm}`;
}

/** Mỗi loại một icon + một màu — liếc một cái là biết dòng nào cần làm gì. */
const KIEU_THONG_BAO: Record<NotificationKind, { Icon: LucideIcon; nen: string; chu: string }> = {
  approver_pending: { Icon: Inbox, nen: "bg-blue-50", chu: "text-[var(--color-action-blue)]" },
  adjustment_pending: { Icon: SlidersHorizontal, nen: "bg-amber-50", chu: "text-amber-600" },
  own_approved: { Icon: CheckCircle2, nen: "bg-green-50", chu: "text-[var(--color-confirm-green)]" },
  own_rejected: { Icon: XCircle, nen: "bg-red-50", chu: "text-[var(--color-danger-red)]" },
  own_returned: { Icon: Undo2, nen: "bg-orange-50", chu: "text-orange-600" },
  comment_on_mine: { Icon: MessageSquare, nen: "bg-blue-50", chu: "text-[var(--color-action-blue)]" },
  mentioned: { Icon: AtSign, nen: "bg-amber-50", chu: "text-amber-600" },
  following: { Icon: Eye, nen: "bg-gray-100", chu: "text-gray-500" },
  manager_bypassed: { Icon: UserX, nen: "bg-red-50", chu: "text-[var(--color-danger-red)]" },
  approver_followup: { Icon: History, nen: "bg-gray-100", chu: "text-gray-500" },
};

const EMPTY_FEED: NotificationFeed = { entries: [], badge: 0, mustCount: 0 };

/**
 * Chuông thông báo (Đợt 1, Sếp duyệt demo 06/10/2026):
 *  - 1 lượt tải `/api/notifications` (máy chủ tính sẵn, mỗi đề xuất 1 dòng) thay cho 7
 *    lượt tải riêng chỉ chạy 1 lần lúc mở trang như trước.
 *  - Tự cập nhật: tín hiệu tức thì khi có đề xuất thay đổi (lib/firebase/
 *    request-change-signal.ts), khi mở chuông, khi quay lại tab, sau khi xem 1 đề xuất,
 *    và 2 phút/lần để dự phòng.
 *  - "Cần bạn duyệt" luôn nằm trên; số trên chuông = việc cần duyệt + dòng chưa đọc.
 *  - Tải lỗi thì báo + nút thử lại (trước đây chuông trống không báo gì).
 */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<NotificationFeed>(EMPTY_FEED);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const containerRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const loadingRef = useRef(false);
  const againRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const lastBadgeRef = useRef<number | null>(null);
  // Mốc thời gian để tính "5 phút trước" — làm mới mỗi phút (gọi Date.now() thẳng lúc
  // render thì mỗi lần render một số khác, nhãn nhảy lung tung).
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (loadingRef.current) {
      againRef.current = true;
      return;
    }
    loadingRef.current = true;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as NotificationFeed;
      setFeed(data);
      setError(false);
      setNow(Date.now());
      // Rung chuông khi có thêm việc/thông báo mới (không rung lần tải đầu).
      if (lastBadgeRef.current !== null && data.badge > lastBadgeRef.current) {
        bellRef.current?.animate?.(
          [
            { transform: "rotate(0)" },
            { transform: "rotate(14deg)" },
            { transform: "rotate(-12deg)" },
            { transform: "rotate(8deg)" },
            { transform: "rotate(0)" },
          ],
          { duration: 700, easing: "ease-in-out" },
        );
      }
      lastBadgeRef.current = data.badge;
    } catch {
      setError(true);
    } finally {
      loadingRef.current = false;
      if (againRef.current) {
        againRef.current = false;
        void load();
      }
    }
  }, []);

  const scheduleLoad = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void load();
    }, DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    void load();
    const stopSignal = listenRequestChanges(scheduleLoad);
    const onVisible = () => {
      if (document.visibilityState === "visible") scheduleLoad();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener(REQUEST_VIEWED_EVENT, scheduleLoad);
    const fallback = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, FALLBACK_REFRESH_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      stopSignal();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener(REQUEST_VIEWED_EVENT, scheduleLoad);
      window.clearInterval(fallback);
      window.clearInterval(clock);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [load, scheduleLoad]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) void load();
    setOpen((v) => !v);
  };

  /** Bấm 1 dòng: coi như đã đọc ngay (trang chi tiết sẽ ghi "đã xem" thật). */
  const markEntryRead = (entry: NotificationEntry) => {
    setOpen(false);
    if (!entry.unread) return;
    setFeed((f) => {
      const entries = f.entries.map((e) =>
        e.requestId === entry.requestId ? { ...e, unread: false, counted: e.must, extra: 0 } : e,
      );
      return { ...f, entries, badge: entries.filter((e) => e.counted).length };
    });
  };

  const markAllRead = async () => {
    setFeed((f) => {
      const entries = f.entries.map((e) => ({ ...e, unread: false, counted: e.must, extra: 0 }));
      return { ...f, entries, badge: entries.filter((e) => e.counted).length };
    });
    await fetch("/api/notifications/read", { method: "POST" }).catch(() => {});
    void load();
  };

  const unreadCount = feed.entries.filter((e) => e.must || e.unread).length;
  const shown = tab === "unread" ? feed.entries.filter((e) => e.must || e.unread) : feed.entries;
  const mustEntries = shown.filter((e) => e.must);
  const otherEntries = shown.filter((e) => !e.must);
  const hasUnreadOther = feed.entries.some((e) => !e.must && e.unread);

  const renderRow = (entry: NotificationEntry) => {
    const kieu = KIEU_THONG_BAO[entry.main.kind];
    return (
      <Link
        key={entry.requestId}
        href={`/request/requests/${entry.requestId}`}
        onClick={() => markEntryRead(entry)}
        title={new Date(entry.main.at).toLocaleString("vi-VN")}
        className={`flex gap-3 border-b border-gray-50 px-4 py-3 last:border-0 ${
          entry.must ? "bg-amber-50/60 hover:bg-amber-50" : "hover:bg-gray-50"
        }`}
      >
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${kieu.nen} ${kieu.chu}`}
          aria-hidden
        >
          <kieu.Icon size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-[14px] leading-snug ${
              entry.unread || entry.must ? "font-medium text-gray-900" : "text-gray-600"
            }`}
          >
            {entry.main.text}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-gray-500">
            {entry.code ? `${entry.code} · ` : ""}
            {entry.title}
          </span>
          <span className="mt-0.5 block text-[12px] text-gray-400">
            {nhanThoiGian(entry.main.at, now)}
            {entry.extra > 0 && (
              <span className="text-[var(--color-action-blue)]"> · và {entry.extra} cập nhật khác</span>
            )}
          </span>
        </span>
        <span
          className={`mt-2 h-2 w-2 shrink-0 rounded-full ${entry.unread ? "bg-[var(--color-action-blue)]" : "bg-transparent"}`}
          aria-label={entry.unread ? "Chưa đọc" : undefined}
        />
      </Link>
    );
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={bellRef}
        type="button"
        onClick={toggle}
        title="Thông báo"
        aria-label={feed.badge > 0 ? `Thông báo, ${feed.badge} mục cần xem` : "Thông báo"}
        aria-expanded={open}
        className="relative flex h-12 w-12 items-center justify-center rounded-xl text-[var(--color-appbar-text)] hover:bg-white/10 hover:text-[var(--color-appbar-text-active)]"
      >
        <Bell size={22} strokeWidth={1.75} />
        {feed.badge > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--color-danger-red)] px-0.5 text-[9px] font-semibold text-white">
            {feed.badge > 99 ? "99+" : feed.badge}
          </span>
        )}
      </button>

      {open && (
        // z-50: FuncBar (sidebar nhóm đề xuất) dùng z-40 cho chính nó — z-20 cũ
        // thấp hơn nên bị sidebar vẽ đè lên trên (góp ý Nhung 14/08/2026).
        <div className="absolute left-full top-0 z-50 ml-2 flex max-h-[min(560px,calc(100vh-24px))] w-[400px] max-w-[calc(100vw-80px)] flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-[0_8px_28px_rgba(16,34,48,0.16)]">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
            <span className="text-[15px] font-semibold text-gray-800">Thông báo</span>
            {hasUnreadOther && (
              <button
                type="button"
                onClick={markAllRead}
                className="ml-auto text-[12px] font-medium text-[var(--color-action-blue)] hover:underline"
              >
                Đánh dấu đã đọc hết
              </button>
            )}
            <Link
              href="/request/settings/notifications"
              onClick={() => setOpen(false)}
              title="Cài đặt thông báo"
              aria-label="Cài đặt thông báo"
              className={`${hasUnreadOther ? "" : "ml-auto "}flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700`}
            >
              <Settings size={15} />
            </Link>
          </div>

          <div className="flex gap-1.5 border-b border-gray-100 px-4 py-2">
            {(
              [
                ["all", "Tất cả"],
                ["unread", `Chưa đọc${unreadCount ? ` (${unreadCount})` : ""}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-full px-3 py-0.5 text-[12px] ${
                  tab === key ? "bg-blue-50 font-semibold text-[var(--color-action-blue)]" : "text-gray-500 hover:bg-gray-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-[12px] text-[var(--color-danger-red)]">
              Không tải được thông báo mới nhất.
              <button
                type="button"
                onClick={() => void load()}
                className="ml-auto flex items-center gap-1 font-medium hover:underline"
              >
                <RefreshCw size={12} /> Thử lại
              </button>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {shown.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <span className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-300">
                  <Bell size={20} />
                </span>
                <p className="text-[14px] font-medium text-gray-500">
                  {tab === "unread" ? "Không có thông báo chưa đọc" : "Chưa có thông báo nào"}
                </p>
                <p className="mt-0.5 text-[12px] text-gray-400">Có việc cần bạn xử lý thì sẽ hiện ở đây.</p>
              </div>
            ) : (
              <>
                {mustEntries.length > 0 && (
                  <p className="flex justify-between px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-danger-red)]">
                    <span>Cần bạn duyệt</span>
                    <span>{mustEntries.length}</span>
                  </p>
                )}
                {mustEntries.map(renderRow)}
                {otherEntries.length > 0 && (
                  <p className="flex justify-between px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    <span>Cập nhật khác</span>
                    <span>{otherEntries.length}</span>
                  </p>
                )}
                {otherEntries.map(renderRow)}
              </>
            )}
          </div>

          {feed.mustCount > 0 && (
            <Link
              href="/request/list?scope=sent-to-me"
              onClick={() => setOpen(false)}
              className="block border-t border-gray-100 bg-gray-50 px-4 py-2.5 text-center text-[13px] font-medium text-[var(--color-action-blue)] hover:bg-gray-100"
            >
              Xem tất cả đề xuất chờ tôi duyệt
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
