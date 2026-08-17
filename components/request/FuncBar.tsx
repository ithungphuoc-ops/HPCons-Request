"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  ChevronLeft,
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
import { useCurrentSession } from "@/lib/useCurrentSession";
import type { RequestListScope } from "@/lib/types";

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

  return (
    <>
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <nav
        aria-label="Thanh chức năng Base Request"
        className={`z-40 h-full w-[200px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-funcbar-border)] bg-[var(--color-funcbar-bg)] py-3 lg:static lg:flex ${
          mobileNavOpen ? "fixed inset-y-0 left-20 flex" : "hidden"
        }`}
      >
      <Link
        href="/"
        className="mx-2 mb-2 flex items-center gap-2 rounded px-2 py-2 text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-funcbar-active-bg)]"
      >
        <ChevronLeft size={14} />
        Trang chủ
      </Link>

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
            <p className="truncate text-[13px] font-medium text-gray-800">{session.name}</p>
            <p className="truncate text-[11px] text-gray-400">
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
              className={`relative flex items-center gap-2 rounded px-2 py-2 text-[13px] ${
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
                  className={`relative flex items-center gap-2 rounded px-2 py-2 text-[13px] ${
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
              className="flex items-center gap-2 rounded px-2 py-2 text-[13px] text-gray-700 hover:bg-[var(--color-funcbar-active-bg)]"
            >
              <Layers size={15} className="shrink-0" />
              Tạo nhóm từ mẫu
            </Link>
            <button
              type="button"
              onClick={openCreateGroup}
              className="flex items-center gap-2 rounded bg-[var(--color-action-blue)] px-2 py-2 text-[13px] font-medium text-white hover:brightness-95"
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
          <p className="mb-1 flex items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
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
        <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          Nhóm đề xuất
        </p>
        <div className="flex flex-col gap-2">
          {categoryGroups.map((cat) => {
            const activeGroups = cat.groups.filter((g) => g.status === "active");
            if (activeGroups.length === 0) return null;
            return (
              <div key={cat.id}>
                <p className="truncate px-2 py-1 text-[11px] font-medium text-gray-400" title={cat.name}>
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
    </>
  );
}
