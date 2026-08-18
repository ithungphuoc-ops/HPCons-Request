"use client";

import { useEffect, useState } from "react";
import HighlightMatch, { normalizeSearch } from "@/components/shared/HighlightMatch";
import {
  AppWindow,
  BarChart3,
  Briefcase,
  CalendarClock,
  Clock,
  ClipboardCheck,
  FileCheck,
  Heart,
  Laptop,
  MapPin,
  PenTool,
  Receipt,
  Search,
  Send,
  Settings,
  Warehouse,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { CURRENT_APP_HOST, HPCORE_APPS_API, HPCORE_DASHBOARD_URL, HPCORE_PROFILE_URL } from "@/lib/constants";
import { useCurrentSession } from "@/lib/useCurrentSession";

// Cùng bộ khoá icon với hpcons-portal/lib/dashboardApps.ts — app nào chưa có
// trong danh sách này thì rơi về icon mặc định (AppWindow).
const ICONS: Record<string, LucideIcon> = {
  Clock,
  MapPin,
  FileCheck,
  Send,
  CalendarClock,
  BarChart3,
  Settings,
  Warehouse,
  PenTool,
  Briefcase,
  Receipt,
  Workflow,
  Heart,
  Laptop,
  ClipboardCheck,
};

type RemoteApp = {
  name: string;
  description?: string;
  iconKey?: string;
  color: string;
  category?: "ops" | "business";
  image?: string | null;
  href?: string | null;
  comingSoon?: boolean;
};

/**
 * app.color trong dữ liệu trả về từ API là chuỗi Tailwind (vd "bg-blue-500") đọc lúc CHẠY,
 * Tailwind quét mã nguồn lúc BUILD nên không thấy được — nếu không liệt kê literal ở đâu đó
 * trong file thì class không được biên dịch ra CSS, ô icon mất màu nền (phát hiện 31/07/2026
 * ở app HPCons_ThongTinCuocHop, cùng lỗi ở pkd_crm-next/hpcons-quatang). Đủ bộ màu hiện có
 * trong hpcons-portal/lib/dashboardApps.ts, cập nhật nếu thêm màu mới:
 * bg-amber-500 bg-blue-500 bg-cyan-500 bg-emerald-500 bg-fuchsia-500 bg-gray-500 bg-green-500 bg-slate-500 bg-orange-600
 * bg-indigo-500 bg-lime-500 bg-orange-500 bg-pink-500 bg-purple-500 bg-red-500 bg-rose-500
 * bg-sky-500 bg-teal-500 bg-violet-500 bg-yellow-500
 */

export default function AppLauncher({ onClose }: { onClose: () => void }) {
  const { session } = useCurrentSession();
  const [query, setQuery] = useState("");
  const [apps, setApps] = useState<RemoteApp[] | null>(null);

  useEffect(() => {
    let ok = true;
    fetch(HPCORE_APPS_API)
      .then((res) => res.json())
      .then((data) => {
        if (ok) setApps(Array.isArray(data.apps) ? data.apps : []);
      })
      .catch(() => {
        if (ok) setApps([]);
      });
    return () => {
      ok = false;
    };
  }, []);

  // Đăng xuất SSO: gọi route sẵn có xoá cookie .hpcore.vn rồi tải lại —
  // middleware sẽ tự chuyển hướng về trang đăng nhập app tổng kèm ?next.
  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Bỏ qua lỗi mạng — reload bên dưới vẫn đưa về login nếu cookie đã mất.
    }
    window.location.reload();
  }

  // Lọc BỎ DẤU (gõ "phong ban" vẫn ra "Phòng ban") — dùng cùng normalizeSearch
  // với HighlightMatch để bộ lọc và phần tô màu khớp nhau tuyệt đối.
  const q = normalizeSearch(query.trim());
  const list = (apps ?? []).filter(
    (a) => !q || normalizeSearch(a.name).includes(q) || normalizeSearch(a.description ?? "").includes(q),
  );
  const groups = [
    {
      title: "Nhân sự & Vận hành",
      subtitle: "Chấm công, đơn từ, đặt phòng, báo cáo...",
      apps: list.filter((a) => a.category !== "business"),
    },
    {
      title: "Ứng dụng nghiệp vụ",
      subtitle: "Kinh doanh, kho, tài sản, quy trình...",
      apps: list.filter((a) => a.category === "business"),
    },
  ].filter((g) => g.apps.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-start p-3 sm:py-4 sm:pl-[292px] sm:pr-4 overflow-y-auto"
      onMouseDown={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-4xl shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header — chuẩn AppLauncher app tổng (hpcons-portal) */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-5 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            {session?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.avatarUrl}
                alt={session.name}
                className="w-11 h-11 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span
                className="flex w-11 h-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: "var(--hp-primary,#096AA7)" }}
              >
                {session?.name.trim().charAt(0).toUpperCase() ?? "?"}
              </span>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 truncate">{session?.name ?? "Đang tải..."}</p>
              <p className="text-xs text-gray-400">
                {(apps ?? []).length} ứng dụng ·{" "}
                <a href={HPCORE_DASHBOARD_URL} className="text-blue-600 hover:underline">Về App Tổng</a> ·{" "}
                <a href={HPCORE_PROFILE_URL} className="text-blue-600 hover:underline">Tài khoản</a> ·{" "}
                <button onClick={handleLogout} className="text-blue-600 hover:underline">Đăng xuất</button>
              </p>
            </div>
          </div>
          <div className="relative sm:ml-auto sm:w-72">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder="Tìm kiếm ứng dụng"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="hidden sm:flex w-8 h-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"
          >
            <X size={20} />
          </button>
        </div>

        {/* Nhóm ứng dụng */}
        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-7">
          {apps === null ? (
            <p className="text-center text-gray-400 py-10">Đang tải danh sách ứng dụng…</p>
          ) : groups.length === 0 ? (
            <p className="text-center text-gray-400 py-10">Không tìm thấy ứng dụng phù hợp</p>
          ) : (
            groups.map((g) => (
              <div key={g.title}>
                <p className="font-semibold text-gray-800">{g.title}</p>
                <p className="text-xs text-gray-400 mb-3">{g.subtitle}</p>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {g.apps.map((app) => (
                    <Tile key={app.name} app={app} query={q} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}


function Tile({ app, query }: { app: RemoteApp; query: string }) {
  const Icon = (app.iconKey && ICONS[app.iconKey]) || AppWindow;
  const current = !!app.href && app.href.includes(CURRENT_APP_HOST);

  const inner = (
    <>
      <div
        className={`w-14 h-14 rounded-2xl flex items-center justify-center overflow-hidden transition-transform group-hover:scale-105 ${
          app.image ? "bg-white border border-gray-100" : app.color
        } ${app.comingSoon ? "opacity-50" : ""}`}
      >
        {app.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={app.image} alt={app.name} className="w-full h-full object-cover scale-[1.15]" />
        ) : (
          <Icon size={26} className="text-white" aria-hidden />
        )}
      </div>
      <p className={`text-xs font-medium text-center leading-tight ${app.comingSoon ? "text-gray-400" : "text-gray-700"}`}>
        <HighlightMatch text={app.name} query={query} />
      </p>
      {current && (
        <span className="text-[9px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">Đang dùng</span>
      )}
      {app.comingSoon && (
        <span className="text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">Sắp ra mắt</span>
      )}
    </>
  );

  const cls = "group flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-gray-50 transition-colors";

  if (app.comingSoon || !app.href) {
    return (
      <div className={`${cls} cursor-default`} title="Sắp ra mắt">
        {inner}
      </div>
    );
  }
  if (current) {
    return <div className={cls}>{inner}</div>;
  }
  return (
    <a href={app.href} target="_blank" rel="noopener noreferrer" className={cls}>
      {inner}
    </a>
  );
}
