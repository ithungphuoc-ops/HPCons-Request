"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AtSign,
  Bell,
  CheckCheck,
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
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { listenMyNotificationFeed } from "@/lib/firebase/notification-feed-listener";
import {
  hideExpiredEntries,
  NOTIFICATION_FEED_STALE_MS,
  NOTIFICATION_FEED_VERSION,
  REQUEST_VIEWED_EVENT,
  type NotificationEntry,
  type NotificationFeed,
  type NotificationKind,
} from "@/lib/notification-feed";
import { groupByVnDay, vnGroupDate, vnRelativeDayLabel, vnTime } from "@/lib/notification-day-group";
import WebPushBanner from "@/components/request/WebPushBanner";

/** Gom nhiều yêu cầu tải sát nhau thành 1 lần (chỉ dùng ở chế độ dự phòng). */
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
  approver_pending: { Icon: Inbox, nen: "bg-blue-50 dark:bg-blue-500/15", chu: "text-[var(--color-action-blue)]" },
  adjustment_pending: { Icon: SlidersHorizontal, nen: "bg-amber-50 dark:bg-amber-500/15", chu: "text-amber-600" },
  own_approved: { Icon: CheckCircle2, nen: "bg-green-50 dark:bg-green-500/15", chu: "text-[var(--color-confirm-green)]" },
  own_rejected: { Icon: XCircle, nen: "bg-red-50 dark:bg-red-500/15", chu: "text-[var(--color-danger-red)]" },
  own_returned: { Icon: Undo2, nen: "bg-orange-50 dark:bg-orange-500/15", chu: "text-orange-600" },
  comment_on_mine: { Icon: MessageSquare, nen: "bg-blue-50 dark:bg-blue-500/15", chu: "text-[var(--color-action-blue)]" },
  mentioned: { Icon: AtSign, nen: "bg-amber-50 dark:bg-amber-500/15", chu: "text-amber-600" },
  following: { Icon: Eye, nen: "bg-gray-100 dark:bg-white/10", chu: "text-gray-500" },
  manager_bypassed: { Icon: UserX, nen: "bg-red-50 dark:bg-red-500/15", chu: "text-[var(--color-danger-red)]" },
  approver_followup: { Icon: History, nen: "bg-gray-100 dark:bg-white/10", chu: "text-gray-500" },
};

const EMPTY_FEED: NotificationFeed = { entries: [], badge: 0, mustCount: 0 };

/**
 * Chuông thông báo (Đợt 1 Sếp duyệt 06/10/2026; "cấp 2" Sếp duyệt 08/10/2026):
 *  - Máy chủ tính sẵn danh sách (mỗi đề xuất 1 dòng) cho đúng những người bị ảnh hưởng
 *    lúc có sự kiện và ghi `notification-feed/{uid}`; chuông chỉ NGHE tài liệu của mình
 *    (lib/firebase/notification-feed-listener.ts) — không hỏi vòng, không tải lại khi
 *    mở chuông/quay lại tab, tab ẩn không gọi máy chủ.
 *  - GET `/api/notifications` chỉ gọi khi: chưa có tài liệu (lần đầu), tài liệu khác
 *    phiên bản / quá NOTIFICATION_FEED_STALE_MS, bấm "Thử lại", hoặc trình duyệt không
 *    nghe được Firestore (chế độ dự phòng: tải khi mở trang, quay lại tab, sau khi xem).
 *  - Giờ tương đối ("5 phút trước") và việc ẩn dòng đã đọc quá 14 ngày tính ở trình duyệt
 *    theo giờ hiện tại, nên tài liệu lưu từ hôm trước vẫn hiện đúng.
 *  - "Cần bạn duyệt" luôn nằm trên; số trên chuông = việc cần duyệt + dòng chưa đọc.
 */
export default function NotificationBell({ uid }: { uid?: string | null }) {
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<NotificationFeed>(EMPTY_FEED);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const loadingRef = useRef(false);
  const againRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const lastBadgeRef = useRef<number | null>(null);
  /** Không nghe được Firestore → dựa vào GET như trước (nhưng không còn 2 phút/lần). */
  const fallbackRef = useRef(false);
  // Mốc thời gian để tính "5 phút trước" — làm mới mỗi phút (gọi Date.now() thẳng lúc
  // render thì mỗi lần render một số khác, nhãn nhảy lung tung).
  const [now, setNow] = useState(() => Date.now());

  /** Đóng bằng Esc / nút Đóng / bấm ra ngoài → trả focus về nút chuông (chuẩn a11y modal,
   * y App Tổng). Bấm 1 dòng/⚙ thì chuyển trang luôn nên không trả focus. */
  const close = useCallback(() => {
    setOpen(false);
    bellRef.current?.focus();
  }, []);

  const applyFeed = useCallback((data: NotificationFeed) => {
    const t = Date.now();
    const shownFeed = hideExpiredEntries(data, t);
    setFeed(shownFeed);
    setNow(t);
    // Rung chuông khi có thêm việc/thông báo mới (không rung lần tải đầu).
    if (lastBadgeRef.current !== null && shownFeed.badge > lastBadgeRef.current) {
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
    lastBadgeRef.current = shownFeed.badge;
  }, []);

  const load = useCallback(async () => {
    if (loadingRef.current) {
      againRef.current = true;
      return;
    }
    loadingRef.current = true;
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      applyFeed((await res.json()) as NotificationFeed);
      setError(false);
    } catch {
      setError(true);
    } finally {
      loadingRef.current = false;
      if (againRef.current) {
        againRef.current = false;
        void load();
      }
    }
  }, [applyFeed]);

  const scheduleLoad = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void load();
    }, DEBOUNCE_MS);
  }, [load]);

  useEffect(() => {
    if (!uid) return;
    fallbackRef.current = false;
    // GET "làm tươi" tối đa 1 lần mỗi lần mở trang — GET ghi lại tài liệu, snapshot mới
    // về sẽ tươi nên không thành vòng lặp.
    let refreshed = false;
    const refreshOnce = () => {
      if (refreshed) return;
      refreshed = true;
      void load();
    };
    const stopListen = listenMyNotificationFeed(
      uid,
      (data) => {
        const usable = !!data && data.v === NOTIFICATION_FEED_VERSION;
        // Tuổi tính theo `profileAt` (lần cuối tính bằng phiên của chính mình), không theo
        // `updatedAt` — sự kiện của người khác làm updatedAt luôn mới. `stale`: lần tính do
        // sự kiện bị lỗi → tự chữa bằng 1 lượt GET.
        const ageMs = data?.profileAt ? Date.now() - Date.parse(data.profileAt) : NaN;
        if (!usable || data.stale || !(ageMs < NOTIFICATION_FEED_STALE_MS)) refreshOnce();
        if (usable && data) {
          applyFeed(data);
          setError(false);
        }
      },
      () => {
        fallbackRef.current = true;
        void load();
      },
    );
    // Chỉ ở chế độ dự phòng mới tải lại khi quay lại tab / sau khi xem 1 đề xuất; bình
    // thường tài liệu tự đổi (máy chủ tính lại lúc ghi "đã xem"), tab ẩn không gọi gì.
    const onVisible = () => {
      if (fallbackRef.current && document.visibilityState === "visible") scheduleLoad();
    };
    const onViewed = () => {
      if (fallbackRef.current) scheduleLoad();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(REQUEST_VIEWED_EVENT, onViewed);
    return () => {
      stopListen();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(REQUEST_VIEWED_EVENT, onViewed);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [uid, load, scheduleLoad, applyFeed]);

  // Đồng hồ cho nhãn "5 phút trước" — chỉ đổi khi tab đang hiện (không gọi máy chủ).
  useEffect(() => {
    const clock = window.setInterval(() => {
      if (document.visibilityState === "visible") setNow(Date.now());
    }, 60_000);
    return () => window.clearInterval(clock);
  }, []);

  // Khung mở: Esc đóng, bẫy Tab trong khung, focus vào nút Đóng — y NotificationOverlayPanel
  // của App Tổng. Bấm ra ngoài: xử lý ở onMouseDown của lớp phủ (chỉ khi bấm trúng nền).
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

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
    // Bình thường máy chủ ghi lại tài liệu → snapshot tự về; dự phòng thì tải lại.
    if (fallbackRef.current) void load();
  };

  const unreadCount = feed.entries.filter((e) => e.must || e.unread).length;
  const shown = tab === "unread" ? feed.entries.filter((e) => e.must || e.unread) : feed.entries;
  const mustEntries = shown.filter((e) => e.must);
  // "Cập nhật khác" chia theo NGÀY như App Tổng. Danh sách gốc xếp: chưa đọc rồi mới tới đã
  // đọc — chia ngày cần xếp lại theo giờ, nếu không cùng 1 ngày sẽ bị tách làm 2 nhóm.
  const dayGroups = groupByVnDay(
    shown.filter((e) => !e.must).sort((a, b) => b.at.localeCompare(a.at)),
    (e) => e.at,
    now,
  );
  const hasUnreadOther = feed.entries.some((e) => !e.must && e.unread);

  /** Dòng 3: trong nhóm ngày đã có ngày rồi nên chỉ ghi giờ (kèm "5 phút trước" nếu còn
   * trong 24 giờ — như demo Sếp duyệt); mục "Cần bạn duyệt" không chia ngày nên ghi đủ. */
  const timeLabel = (entry: NotificationEntry) => {
    if (entry.must) return nhanThoiGian(entry.main.at, now);
    const t = Date.parse(entry.main.at);
    const recent = Number.isFinite(t) && now - t < 24 * 3_600_000;
    return recent ? `${vnTime(entry.main.at)} · ${nhanThoiGian(entry.main.at, now).toLowerCase()}` : vnTime(entry.main.at);
  };

  const renderRow = (entry: NotificationEntry) => {
    const kieu = KIEU_THONG_BAO[entry.main.kind];
    return (
      <Link
        key={entry.requestId}
        href={`/request/requests/${entry.requestId}`}
        onClick={() => markEntryRead(entry)}
        title={new Date(entry.main.at).toLocaleString("vi-VN")}
        className={`flex items-start gap-3 border-b border-[var(--color-border)] px-4 py-3 text-left transition-colors last:border-0 ${
          entry.must
            ? "bg-amber-50/60 hover:bg-amber-50 dark:bg-amber-500/10 dark:hover:bg-amber-500/15"
            : entry.unread
              ? "bg-blue-50 hover:bg-blue-100/70 dark:bg-blue-500/10 dark:hover:bg-blue-500/15"
              : "hover:bg-[var(--color-page-bg)]"
        }`}
      >
        <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-full ${kieu.nen} ${kieu.chu}`} aria-hidden>
          <kieu.Icon size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-sm leading-snug ${
              entry.unread || entry.must
                ? "font-semibold text-[var(--color-text-primary)]"
                : "text-[var(--color-text-primary)] opacity-80"
            }`}
          >
            {entry.unread && <span className="sr-only">Chưa đọc: </span>}
            {entry.main.text}
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--color-text-secondary)]">
            {entry.code ? `${entry.code} · ` : ""}
            {entry.title}
          </span>
          <span className="mt-1 block text-[11px] text-[var(--color-text-secondary)] opacity-80">
            {timeLabel(entry)}
            {entry.extra > 0 && (
              <span className="text-[var(--color-action-blue)] opacity-100"> · và {entry.extra} cập nhật khác</span>
            )}
          </span>
        </span>
        {entry.unread && <span aria-hidden className="mt-1.5 h-2 w-2 flex-none rounded-full bg-[var(--color-action-blue)]" />}
      </Link>
    );
  };

  const panel = (
    <div
      className="animate-overlay fixed inset-0 z-50 flex items-stretch justify-start bg-black/60 md:py-4 md:pl-24 md:pr-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {/* Máy tính: khung nổi sát bên thanh ứng dụng (pl-24 né đúng rail w-20 = 80px, y App
          Tổng), rộng tối đa 640px, cao hết trang. Điện thoại (<768px): phủ toàn màn hình. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-notif-title"
        className="animate-modal-pop flex h-full w-full flex-col overflow-hidden bg-[var(--color-card-bg)] md:max-w-[640px] md:rounded-2xl md:border md:border-[var(--color-border)] md:shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-4 py-3 md:px-5 md:py-3.5">
          <h2 id="request-notif-title" className="mr-auto text-base font-bold text-[var(--color-text-primary)]">
            Thông báo
          </h2>
          <Link
            href="/request/settings/notifications"
            onClick={() => setOpen(false)}
            title="Cài đặt thông báo"
            aria-label="Cài đặt thông báo"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
          >
            <Settings size={17} />
          </Link>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Đóng"
            title="Đóng"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-page-bg)] hover:text-[var(--color-text-primary)]"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-5">
          {/* Web Push (cấp 3, 08/10/2026): nhắc bật thông báo ra màn hình — tự ẩn khi không cần. */}
          <WebPushBanner onNavigate={() => setOpen(false)} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-page-bg)] p-1">
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
                  aria-pressed={tab === key}
                  className={`min-h-9 rounded-md px-3 text-sm font-medium transition-colors ${
                    tab === key
                      ? "bg-[var(--color-card-bg)] text-[var(--color-action-blue)] shadow-sm"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {hasUnreadOther && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="ml-auto flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-page-bg)]"
              >
                <CheckCheck size={15} /> Đánh dấu tất cả đã đọc
              </button>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-[var(--color-danger-red)] dark:border-red-500/20 dark:bg-red-500/10">
              Không tải được thông báo mới nhất.
              <button type="button" onClick={() => void load()} className="ml-auto flex items-center gap-1 font-medium hover:underline">
                <RefreshCw size={12} /> Thử lại
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card-bg)] shadow-sm">
            {shown.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <span className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-page-bg)] text-[var(--color-text-secondary)]">
                  <Bell size={20} />
                </span>
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">
                  {tab === "unread" ? "Không có thông báo chưa đọc" : "Chưa có thông báo nào"}
                </p>
                <p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)] opacity-80">Có việc cần bạn xử lý thì sẽ hiện ở đây.</p>
              </div>
            ) : (
              <>
                {/* "Cần bạn duyệt" luôn nằm trên cùng, KHÔNG chia ngày: đây là việc còn treo,
                    không phải tin cũ/mới — chia ngày thì việc chờ từ tuần trước bị đẩy xuống
                    đáy, dễ sót (giữ đúng quy tắc chuông Đợt 1). */}
                {mustEntries.length > 0 && (
                  <div>
                    <div className="flex items-center gap-3 bg-[var(--color-page-bg)] px-4 pb-2 pt-3">
                      <span className="whitespace-nowrap text-xs font-semibold text-[var(--color-danger-red)]">Cần bạn duyệt</span>
                      <div className="flex-1 border-t border-[var(--color-border)]" />
                      <span className="whitespace-nowrap text-xs text-[var(--color-danger-red)]">{mustEntries.length}</span>
                    </div>
                    {mustEntries.map(renderRow)}
                  </div>
                )}
                {dayGroups.map((g) => (
                  <div key={g.key}>
                    <div className="flex items-center gap-3 bg-[var(--color-page-bg)] px-4 pb-2 pt-3">
                      <span className="whitespace-nowrap text-xs font-semibold text-[var(--color-text-primary)] opacity-80">
                        {vnGroupDate(g.iso)}
                      </span>
                      <div className="flex-1 border-t border-[var(--color-border)]" />
                      <span className="whitespace-nowrap text-xs text-[var(--color-text-secondary)]">{vnRelativeDayLabel(g.iso, now)}</span>
                    </div>
                    {g.items.map(renderRow)}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {feed.mustCount > 0 && (
          <Link
            href="/request/list?scope=sent-to-me"
            onClick={() => setOpen(false)}
            className="block shrink-0 border-t border-[var(--color-border)] bg-[var(--color-page-bg)] px-4 py-3 text-center text-[13px] font-medium text-[var(--color-action-blue)] hover:underline"
          >
            Xem tất cả đề xuất chờ tôi duyệt
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Nút y App Tổng (components/layout/NotificationBell.tsx): 40×40, bo 12px, không viền,
          số đỏ "9+" viền 2px cùng màu nền thanh — trên rail tối của app này nên chữ/nền hover
          theo màu rail (appbar-*) thay cho hp-text-disabled/hp-surface của rail sáng App Tổng. */}
      <button
        ref={bellRef}
        type="button"
        onClick={() => setOpen(true)}
        title="Thông báo"
        aria-label={feed.badge > 0 ? `Thông báo, ${feed.badge} mục cần xem` : "Thông báo"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl text-[var(--color-appbar-text)] transition-colors hover:bg-white/10 hover:text-[var(--color-appbar-text-active)]"
      >
        <Bell size={19} />
        {feed.badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-[var(--color-appbar-bg)] bg-[var(--color-danger-red)] px-1 text-[10px] font-bold text-white">
            {feed.badge > 9 ? "9+" : feed.badge}
          </span>
        )}
      </button>
      {/* Portal ra <body>: lớp phủ `fixed` không bị khung cha (rail, có thể có transform /
          overflow sau này) cắt mất hay đè sai thứ tự lớp. */}
      {open && typeof document !== "undefined" && createPortal(panel, document.body)}
    </>
  );
}
