"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
  ChevronsLeft,
  ChevronsLeftRight,
  ChevronsRight,
  Eye,
  FileClock,
  History,
  Inbox,
  Layers,
  Plus,
  Send,
  Settings,
  Star,
  Webhook,
} from "lucide-react";
import { useRequestContext } from "@/context/RequestContext";
import { sortGroupsByNumber } from "@/lib/group-sort";
import { useCurrentSession } from "@/lib/useCurrentSession";
import {
  clampFuncbarWidth,
  FUNCBAR_COLLAPSED_KEY,
  FUNCBAR_DEFAULT_WIDTH,
  FUNCBAR_MAX_WIDTH,
  FUNCBAR_MIN_WIDTH,
  FUNCBAR_WIDTH_KEY,
  parseStoredFuncbarWidth,
} from "@/lib/funcbar-prefs";
import type { RequestListScope } from "@/lib/types";

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Trình duyệt chặn lưu (chế độ riêng tư...) — vẫn dùng được, chỉ không nhớ lần sau.
  }
}

const filterLinks: { key: RequestListScope; label: string; icon: typeof Inbox }[] = [
  { key: "all", label: "Tất cả", icon: Layers },
  { key: "sent-to-me", label: "Gửi đến tôi", icon: Inbox },
  { key: "mine", label: "Tôi gửi đi", icon: Send },
  { key: "following", label: "Đang theo dõi", icon: Eye },
];

const adminLinks = [
  { key: "reports", label: "Báo cáo", href: "/request/reports", icon: BarChart3 },
  { key: "all-groups", label: "Tất cả nhóm đề xuất (Tùy chỉnh)", href: "/request/groups", icon: Settings },
  { key: "system-proposals", label: "Tất cả đề xuất hệ thống", href: "/request/system-proposals", icon: FileClock },
  { key: "webhook-history", label: "Lịch sử Webhook", href: "/request/webhook-history", icon: Webhook },
  { key: "webhook-trace", label: "Dấu vết Webhook", href: "/request/webhook-trace", icon: Webhook },
  { key: "group-history", label: "Lịch sử chỉnh sửa nhóm", href: "/request/group-history", icon: History },
];

const roleLabels: Record<string, string> = {
  owner: "Chủ sở hữu",
  admin: "Quản trị viên",
  manager: "Quản lý",
  employee: "Nhân viên",
};

export default function FuncBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentScope = searchParams.get("scope") ?? "all";
  const { categoryGroups, openCreateGroup, mobileNavOpen, setMobileNavOpen } = useRequestContext();
  const { session, isAdmin } = useCurrentSession();
  const [avatarFailed, setAvatarFailed] = useState(false);

  const pinnedGroups = categoryGroups.flatMap((cat) => cat.groups).filter((g) => g.pinned);
  // Bấm tên nhóm ở sidebar → xem danh sách đề xuất đã gửi trong nhóm đó
  // (kiểu Base thật), áp dụng cho mọi vai trò. Admin/owner vẫn vào thiết lập
  // nhóm (mẫu biểu, người duyệt...) qua "Tất cả nhóm đề xuất" → GroupRow.
  const groupHref = (groupId: string) => `/request/list?scope=group&groupId=${groupId}`;

  // Màn hình nhỏ: menu ẩn mặc định, mở dạng trượt qua nút hamburger ở AppBar —
  // tự đóng lại mỗi khi điều hướng sang trang khác.
  useEffect(() => {
    setMobileNavOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Màn ≥ lg: kéo mép phải để đổi độ rộng, nút «/» để ẩn/hiện (Sếp duyệt demo 19/10/2026).
  // `null` = chưa đọc lựa chọn đã lưu → chưa gắn style/thuộc tính, để CSS + thẻ <style> do
  // FUNCBAR_PREPAINT_SCRIPT chèn quyết định (không bị nháy lúc mở trang).
  const [width, setWidth] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<boolean | null>(null);
  const [dragging, setDragging] = useState(false);
  const [animate, setAnimate] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number; lastWidth: number } | null>(null);
  // Độ rộng NGƯỜI DÙNG CHỌN (đã lưu). Cửa sổ thu nhỏ thì hiển thị bị chặn lại, nhưng mở to ra lại
  // vẫn về đúng độ rộng đã chọn — không ghi đè lựa chọn chỉ vì đổi kích thước cửa sổ.
  const preferred = useRef(FUNCBAR_DEFAULT_WIDTH);

  useEffect(() => {
    preferred.current = parseStoredFuncbarWidth(readPref(FUNCBAR_WIDTH_KEY)) ?? FUNCBAR_DEFAULT_WIDTH;
    setWidth(clampFuncbarWidth(preferred.current, window.innerWidth));
    setCollapsed(readPref(FUNCBAR_COLLAPSED_KEY) === "1");
    // Bật hiệu ứng trượt SAU khung hình đầu — áp lựa chọn đã lưu không được chạy hiệu ứng.
    const id = window.requestAnimationFrame(() => setAnimate(true));
    const onResize = () => setWidth(clampFuncbarWidth(preferred.current, window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Độ rộng đang chiếm thật (0 khi ẩn) cho các bảng nổi mở cạnh thanh bên, vd bảng "Ứng dụng"
  // (AppLauncher.tsx dùng var(--funcbar-live)) — trước đây chúng giả định cứng 200px.
  useEffect(() => {
    if (width === null || collapsed === null) return;
    document.documentElement.style.setProperty("--funcbar-live", collapsed ? "0px" : `${width}px`);
  }, [width, collapsed]);

  const commitWidth = useCallback((next: number) => {
    const clamped = clampFuncbarWidth(next, window.innerWidth);
    preferred.current = clamped;
    setWidth(clamped);
    writePref(FUNCBAR_WIDTH_KEY, String(clamped));
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writePref(FUNCBAR_COLLAPSED_KEY, next ? "1" : "0");
  };

  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    // Chỉ chuột trái (chạm/bút cũng là 0) — giữ chuột phải/giữa kéo không được đổi độ rộng.
    if (width === null || e.button !== 0) return;
    drag.current = { startX: e.clientX, startWidth: width, lastWidth: width };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = clampFuncbarWidth(drag.current.startWidth + e.clientX - drag.current.startX, window.innerWidth);
    drag.current.lastWidth = next;
    setWidth(next);
  };
  const finishResize = (el: HTMLDivElement, pointerId: number, finalWidth: number) => {
    drag.current = null;
    if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    commitWidth(finalWidth);
  };
  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // Tính lại từ toạ độ lúc thả, KHÔNG dùng `width` của lần vẽ trước — rê nhanh rồi thả ngay thì
    // React có thể chưa kịp vẽ lại, lưu nhầm số cũ (QA bắt được: hiện 277 nhưng lưu 240).
    finishResize(e.currentTarget, e.pointerId, drag.current.startWidth + e.clientX - drag.current.startX);
  };
  // Bị huỷ giữa chừng (pointercancel) hoặc trình duyệt tự nhả tay nắm (lostpointercapture): toạ độ
  // của các sự kiện này không đáng tin → giữ độ rộng đang hiện, và luôn dọn con trỏ/khoá bôi đen
  // (không thì cả trang kẹt con trỏ kéo ngang, rê chuột qua tay nắm vẫn đổi độ rộng).
  const onResizeAbort = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    finishResize(e.currentTarget, e.pointerId, drag.current.lastWidth);
  };
  const onResizeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (width === null || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    commitWidth(width + (e.key === "ArrowRight" ? 10 : -10));
  };

  const ready = width !== null && collapsed !== null;

  return (
    <div
      className={`funcbar-wrap print-hide relative h-full shrink-0${animate && !dragging ? " funcbar-anim" : ""}`}
      data-collapsed={collapsed === null ? undefined : String(collapsed)}
      style={width === null ? undefined : ({ "--funcbar-w": `${width}px` } as React.CSSProperties)}
    >
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <nav
        id="request-funcbar"
        aria-label="Thanh chức năng Base Request"
        className={`print-hide z-40 h-full w-[200px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-funcbar-border)] bg-[var(--color-funcbar-bg)] py-3 lg:static lg:flex lg:w-full ${
          mobileNavOpen ? "fixed inset-y-0 left-20 flex" : "hidden"
        }`}
      >
      {/* ĐÃ BỎ mục "Trang chủ" ở đây (14/09/2026, Sếp chốt). Nó trỏ về "/" →
          redirect "/request", tức TRÙNG ĐÍCH với nút hình ngôi nhà trên AppBar.
          Tệ hơn, nó mang icon ChevronLeft (mũi tên quay lui) nên đọc như nút
          "thoát app", khiến người dùng tưởng là đường về App Tổng — mà đường
          về App Tổng thật sự nằm trong AppLauncher ("Về App Tổng").
          Nếu sau này cần lối tắt về App Tổng thì dùng HPCORE_DASHBOARD_URL
          (lib/constants.ts), ĐỪNG trỏ lại href="/". */}

      {session && (
        <div className="mx-2 mb-2 flex items-center gap-2 rounded px-2 py-2">
          {/* Ảnh THẬT từ app tổng (chuẩn đồng bộ 17/08/2026); chưa có ảnh
              hoặc ảnh lỗi → chữ cái, không bao giờ hiện ô ảnh vỡ. */}
          {session.avatarUrl && !avatarFailed ? (
            // eslint-disable-next-line @next/next/no-img-element -- ảnh R2 ngoài domain
            <img
              src={session.avatarUrl}
              alt=""
              className="h-8 w-8 shrink-0 rounded-full object-cover"
              loading="lazy"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-blue)] text-[12px] font-semibold text-white">
              {session.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium text-gray-800">{session.name}</p>
            <p className="truncate text-[12px] text-gray-400">
              {roleLabels[session.role] ?? session.role}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-0.5 px-2">
        {filterLinks.map((item) => {
          const isActive = pathname === "/request/list" && currentScope === item.key;
          return (
            <Link
              key={item.key}
              href={`/request/list?scope=${item.key}`}
              className={`relative flex items-center gap-2 rounded px-2 py-2 text-[14px] ${
                isActive
                  ? "bg-[var(--color-funcbar-active-bg)] font-medium text-[var(--color-action-blue)]"
                  : "text-gray-700 hover:bg-[var(--color-funcbar-active-bg)]"
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[var(--color-action-blue)]" />
              )}
              <item.icon size={15} className="shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>

      {isAdmin && (
        <>
          <div className="mx-2 my-3 border-t border-[var(--color-funcbar-border)]" />

          <div className="flex flex-col gap-0.5 px-2">
            {adminLinks.map((item) => {
              const isActive = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`relative flex items-center gap-2 rounded px-2 py-2 text-[14px] ${
                    isActive
                      ? "bg-[var(--color-funcbar-active-bg)] font-medium text-[var(--color-action-blue)]"
                      : "text-gray-700 hover:bg-[var(--color-funcbar-active-bg)]"
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[var(--color-action-blue)]" />
                  )}
                  <item.icon size={15} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="mx-2 my-3 border-t border-[var(--color-funcbar-border)]" />

          <div className="flex flex-col gap-1.5 px-2">
            <Link
              href="/request/groups/from-template"
              className="flex items-center gap-2 rounded px-2 py-2 text-[14px] text-gray-700 hover:bg-[var(--color-funcbar-active-bg)]"
            >
              <Layers size={15} className="shrink-0" />
              Tạo nhóm từ mẫu
            </Link>
            <button
              type="button"
              onClick={openCreateGroup}
              className="flex items-center gap-2 rounded bg-[var(--color-action-blue)] px-2 py-2 text-[14px] font-medium text-white hover:brightness-95"
            >
              <Plus size={15} className="shrink-0" />
              Tạo nhóm đề xuất
            </button>
          </div>
        </>
      )}

      <div className="mx-2 my-3 border-t border-[var(--color-funcbar-border)]" />

      {pinnedGroups.length > 0 && (
        <div className="px-2">
          <p className="mb-1 flex items-center gap-1 px-2 text-[12px] font-semibold uppercase tracking-wide text-gray-400">
            <Star size={11} /> Quan trọng
          </p>
          <div className="flex flex-col gap-0.5">
            {pinnedGroups.map((g) => (
              <Link
                key={g.id}
                href={groupHref(g.id)}
                className="truncate rounded px-2 py-1.5 text-[12px] text-gray-600 hover:bg-[var(--color-funcbar-active-bg)]"
                title={g.name}
              >
                {g.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 px-2">
        <p className="mb-1 px-2 text-[12px] font-semibold uppercase tracking-wide text-gray-400">
          Nhóm đề xuất
        </p>
        <div className="flex flex-col gap-2">
          {categoryGroups.map((cat) => {
            // Xếp theo số đầu tên nhóm (0. → 1.0. → 1.1. …), Sếp chốt 05/10/2026 — xem lib/group-sort.ts.
            const activeGroups = sortGroupsByNumber(cat.groups.filter((g) => g.status === "active"));
            if (activeGroups.length === 0) return null;
            return (
              <div key={cat.id}>
                <p className="truncate px-2 py-1 text-[12px] font-medium text-gray-400" title={cat.name}>
                  {cat.code} - {cat.name}
                </p>
                <div className="flex flex-col gap-0.5">
                  {activeGroups.map((g) => (
                    <Link
                      key={g.id}
                      href={groupHref(g.id)}
                      className="truncate rounded px-2 py-1.5 text-[12px] text-gray-700 hover:bg-[var(--color-funcbar-active-bg)]"
                      title={g.description || g.name}
                    >
                      {g.name}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </nav>

      {ready && (
        <>
          {/* Nút ẩn/hiện nằm đè lên đường ranh giữa thanh đen và thanh bên; lúc ẩn vẫn ở đúng chỗ.
              Nút và tay nắm dùng z-[25]: nổi trên nội dung trang nhưng NẰM DƯỚI mọi bảng/lớp phủ
              (z-30 trở lên, vd bảng "Ứng dụng" z-50) — không đè lên hay bắt nhầm cú bấm của chúng. */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-controls="request-funcbar"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Hiện thanh chức năng" : "Ẩn thanh chức năng"}
            title={collapsed ? "Hiện thanh chức năng" : "Ẩn thanh chức năng"}
            className="absolute -left-3 top-[18px] z-[25] hidden h-6 w-6 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-card-bg)] text-gray-500 shadow-sm hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)] lg:flex"
          >
            {collapsed ? <ChevronsRight size={14} strokeWidth={2.2} /> : <ChevronsLeft size={14} strokeWidth={2.2} />}
          </button>

          {!collapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-controls="request-funcbar"
              aria-label="Kéo để đổi độ rộng thanh chức năng (nhấp đúp để trả về mặc định)"
              aria-valuenow={width ?? FUNCBAR_DEFAULT_WIDTH}
              aria-valuemin={FUNCBAR_MIN_WIDTH}
              aria-valuemax={FUNCBAR_MAX_WIDTH}
              tabIndex={0}
              onPointerDown={onResizeStart}
              onPointerMove={onResizeMove}
              onPointerUp={onResizeEnd}
              onPointerCancel={onResizeAbort}
              onLostPointerCapture={onResizeAbort}
              onDoubleClick={() => commitWidth(FUNCBAR_DEFAULT_WIDTH)}
              onKeyDown={onResizeKey}
              className="group absolute -right-[6px] top-0 z-[25] hidden h-full w-[10px] cursor-col-resize touch-none outline-none lg:block"
            >
              <span
                className={`absolute inset-y-0 left-1 w-[2px] transition-colors group-hover:bg-[var(--color-action-blue)] group-focus-visible:bg-[var(--color-action-blue)] ${
                  dragging ? "bg-[var(--color-action-blue)]" : ""
                }`}
              />
              <span
                className={`pointer-events-none absolute -left-1 top-1/2 flex h-11 w-[18px] -translate-y-1/2 items-center justify-center rounded-full border bg-[var(--color-card-bg)] shadow-sm group-hover:border-[var(--color-action-blue)] group-hover:text-[var(--color-action-blue)] ${
                  dragging
                    ? "border-[var(--color-action-blue)] text-[var(--color-action-blue)]"
                    : "border-[var(--color-border)] text-gray-400"
                }`}
              >
                <ChevronsLeftRight size={12} strokeWidth={2.4} />
              </span>
              {dragging && (
                <span className="pointer-events-none absolute left-[14px] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--color-action-blue)] px-2 py-0.5 text-[11.5px] font-semibold text-white">
                  {width} px
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
