"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChart3, BellRing, Gift, Grid3x3, HelpCircle, Home, Menu, Moon, Search, Settings, Sun } from "lucide-react";
import AppLauncher from "@/components/request/AppLauncher";
import GiftPopup from "@/components/request/GiftPopup";
import NotificationBell from "@/components/request/NotificationBell";
import { useRequestContext } from "@/context/RequestContext";
import { useCurrentSession } from "@/lib/useCurrentSession";
import { applyTheme, getStoredTheme, type Theme } from "@/lib/theme";

const iconItems = [
  { key: "home", label: "Trang chủ", icon: Home, href: "/request" },
  { key: "search", label: "Tìm kiếm", icon: Search, href: "/request/search" },
];

export default function AppBar() {
  const { isAdmin } = useCurrentSession();
  const { mobileNavOpen, setMobileNavOpen } = useRequestContext();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [giftPopupOpen, setGiftPopupOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  return (
    <nav
      aria-label="Thanh ứng dụng"
      className="flex h-full w-20 shrink-0 flex-col items-center bg-[var(--color-appbar-bg)] py-3"
    >
      <button
        type="button"
        onClick={() => setLauncherOpen(true)}
        aria-label="Mở danh sách ứng dụng HPCons"
        title="Mở danh sách ứng dụng"
        className="mb-2 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white"
      >
        <Image src="/logo.png" alt="HPCons" width={40} height={40} className="h-full w-full object-contain" />
      </button>

      <button
        type="button"
        onClick={() => setMobileNavOpen(!mobileNavOpen)}
        aria-label={mobileNavOpen ? "Đóng menu điều hướng" : "Mở menu điều hướng"}
        aria-expanded={mobileNavOpen}
        className="mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--color-appbar-text)] hover:bg-white/10 hover:text-[var(--color-appbar-text-active)] lg:hidden"
      >
        <Menu size={20} strokeWidth={1.75} />
      </button>

      <div className="flex flex-1 flex-col items-center gap-1.5">
        <Link
          href={iconItems[0].href}
          title={iconItems[0].label}
          aria-label={iconItems[0].label}
          className="flex h-12 w-12 items-center justify-center rounded-xl text-[var(--color-appbar-text)] hover:bg-white/10 hover:text-[var(--color-appbar-text-active)]"
        >
          <Home size={22} strokeWidth={1.75} />
        </Link>

        <NotificationBell />

        <Link
          href="/request/settings/notifications"
          title="Cài đặt thông báo"
          aria-label="Cài đặt thông báo"
          className="flex h-12 w-12 items-center justify-center rounded-xl text-[var(--color-appbar-text)] hover:bg-white/10 hover:text-[var(--color-appbar-text-active)]"
        >
          <BellRing size={20} strokeWidth={1.75} />
        </Link>

        {/* Popup khung điện thoại nhúng iframe app khác (quacuatoi.hpcore.vn —
            hệ thống nhiệm vụ đổi điểm UrBox). Xem components/request/GiftPopup.tsx. */}
        <button
          type="button"
          onClick={() => setGiftPopupOpen(true)}
          title="Quà của tôi (nhiệm vụ đổi điểm)"
          aria-label="Quà của tôi (nhiệm vụ đổi điểm)"
          className="flex h-12 w-12 items-center justify-center rounded-xl text-[var(--color-appbar-text)] hover:bg-white/10 hover:text-[var(--color-appbar-text-active)]"
        >
          <Gift size={22} strokeWidth={1.75} />
        </button>

        {iconItems.slice(1).map((item) => (
          <Link
            key={item.key}
            href={item.href}
            title={item.label}
            aria-label={item.label}
            className="flex h-12 w-12 items-center justify-center rounded-xl text-[var(--color-appbar-text)] hover:bg-white/10 hover:text-[var(--color-appbar-text-active)]"
          >
            <item.icon size={22} strokeWidth={1.75} />
          </Link>
        ))}

        {isAdmin && (
          <>
            <Link
              href="/request/reports"
              title="Báo cáo"
              aria-label="Báo cáo"
              className="flex h-12 w-12 items-center justify-center rounded-xl text-[var(--color-appbar-text)] hover:bg-white/10 hover:text-[var(--color-appbar-text-active)]"
            >
              <BarChart3 size={22} strokeWidth={1.75} />
            </Link>
            <Link
              href="/request/groups"
              title="Tùy chỉnh"
              aria-label="Tùy chỉnh"
              className="relative flex h-12 w-12 items-center justify-center rounded-xl text-[var(--color-appbar-text)] hover:bg-white/10 hover:text-[var(--color-appbar-text-active)]"
            >
              <Settings size={22} strokeWidth={1.75} />
            </Link>
          </>
        )}

        <button
          type="button"
          onClick={() => setLauncherOpen(true)}
          title="Ứng dụng khác"
          aria-label="Mở danh sách ứng dụng khác"
          className="flex h-12 w-12 items-center justify-center rounded-xl text-[var(--color-appbar-text)] hover:bg-white/10 hover:text-[var(--color-appbar-text-active)]"
        >
          <Grid3x3 size={22} strokeWidth={1.75} />
        </button>
      </div>

      <button
        type="button"
        onClick={toggleTheme}
        title={theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
        aria-label="Chuyển đổi giao diện sáng/tối"
        className="flex h-12 w-12 items-center justify-center rounded-xl text-[var(--color-appbar-text)] hover:bg-white/10 hover:text-[var(--color-appbar-text-active)]"
      >
        {theme === "dark" ? <Sun size={20} strokeWidth={1.75} /> : <Moon size={20} strokeWidth={1.75} />}
      </button>

      <Link
        href="/"
        title="Trợ giúp"
        aria-label="Trợ giúp và hướng dẫn"
        className="flex h-12 w-12 items-center justify-center rounded-xl text-[var(--color-appbar-text)] hover:bg-white/10 hover:text-[var(--color-appbar-text-active)]"
      >
        <HelpCircle size={22} strokeWidth={1.75} />
      </Link>

      {launcherOpen && <AppLauncher onClose={() => setLauncherOpen(false)} />}
      {giftPopupOpen && <GiftPopup onClose={() => setGiftPopupOpen(false)} />}
    </nav>
  );
}
