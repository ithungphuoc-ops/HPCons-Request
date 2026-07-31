"use client";

import { useEffect, useState } from "react";
import {
  AppWindow,
  BarChart3,
  Briefcase,
  CalendarClock,
  Clock,
  ClipboardCheck,
  FileCheck,
  Heart,
  LayoutGrid,
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
  image?: string | null;
  href?: string | null;
  comingSoon?: boolean;
};

const isBiz = (name: string) => name.startsWith("HPC ");

/**
 * app.color trong dữ liệu trả về từ API là chuỗi Tailwind (vd "bg-blue-500") đọc lúc CHẠY,
 * Tailwind quét mã nguồn lúc BUILD nên không thấy được — nếu không liệt kê literal ở đâu đó
 * trong file thì class không được biên dịch ra CSS, ô icon mất màu nền (phát hiện 31/07/2026
 * ở app HPCons_ThongTinCuocHop, cùng lỗi ở pkd_crm-next/hpcons-quatang). Đủ bộ màu hiện có
 * trong hpcons-portal/lib/dashboardApps.ts, cập nhật nếu thêm màu mới:
 * bg-amber-500 bg-blue-500 bg-cyan-500 bg-emerald-500 bg-fuchsia-500 bg-gray-500 bg-green-500
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

  const q = query.trim().toLowerCase();
  const list = (apps ?? []).filter((a) => !q || a.name.toLowerCase().includes(q));
  const groups = [
    {
      title: "Nhân sự & Vận hành",
      subtitle: "Chấm công, đơn từ, đặt phòng, báo cáo...",
      apps: list.filter((a) => !isBiz(a.name)),
    },
    {
      title: "Ứng dụng nghiệp vụ",
      subtitle: "Kinh doanh, kho, tài sản, quy trình...",
      apps: list.filter((a) => isBiz(a.name)),
    },
  ].filter((g) => g.apps.length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-start overflow-y-auto bg-black/50 p-3 sm:py-4 sm:pl-[292px] sm:pr-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-3 bg-gray-50 px-6 py-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            {session?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.avatarUrl}
                alt={session.name}
                className="h-10 w-10 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-blue)] text-[14px] font-semibold text-white">
                {session?.name.trim().charAt(0).toUpperCase() ?? "?"}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-[14px] font-bold text-gray-900">
                {session?.name ?? "Đang tải..."}
              </p>
              <a href={HPCORE_PROFILE_URL} className="text-[12px] text-[var(--color-action-blue)] hover:underline">
                Xem tài khoản
              </a>
            </div>
          </div>
          <div className="relative sm:ml-auto sm:w-72">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              placeholder="Tìm kiếm ứng dụng"
              className="h-9 w-full rounded-full border border-[var(--color-border)] bg-white pl-9 pr-3 text-[13px] outline-none focus:border-[var(--color-action-blue)]"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-full text-gray-400 hover:bg-gray-200 hover:text-gray-700 sm:self-auto"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-7 overflow-y-auto p-6">
          <a
            href={HPCORE_DASHBOARD_URL}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--color-action-blue)] hover:bg-blue-50"
          >
            <LayoutGrid size={15} /> Tổng quan HPCons App Tổng
          </a>

          {apps === null ? (
            <p className="py-10 text-center text-[13px] text-gray-400">Đang tải danh sách ứng dụng…</p>
          ) : groups.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-gray-400">Không có ứng dụng phù hợp</p>
          ) : (
            groups.map((g) => (
              <div key={g.title}>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{g.title}</p>
                <p className="mb-4 mt-0.5 text-[12px] text-gray-400">{g.subtitle}</p>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                  {g.apps.map((app) => (
                    <Tile key={app.name} app={app} />
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

function Tile({ app }: { app: RemoteApp }) {
  const Icon = (app.iconKey && ICONS[app.iconKey]) || AppWindow;
  const current = !!app.href && app.href.includes(CURRENT_APP_HOST);

  const inner = (
    <>
      <div
        className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl shadow-sm transition-all duration-150 group-hover:-translate-y-0.5 group-hover:shadow-md ${
          app.image ? "bg-white" : app.color
        } ${app.comingSoon ? "opacity-50" : ""}`}
      >
        {app.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={app.image} alt={app.name} className="h-full w-full scale-[1.15] object-cover" />
        ) : (
          <Icon size={24} className="text-white" aria-hidden />
        )}
      </div>
      <span className={`text-center text-[12px] font-medium leading-tight ${app.comingSoon ? "text-gray-300" : "text-gray-800"}`}>
        {app.name}
      </span>
      {current && (
        <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-medium text-[var(--color-action-blue)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-action-blue)]" /> Đang dùng
        </span>
      )}
      {app.comingSoon && (
        <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[9px] font-medium text-orange-500">
          Sắp ra mắt
        </span>
      )}
    </>
  );

  const cls =
    "group flex flex-col items-center gap-2 rounded-2xl p-3 transition-colors hover:bg-gray-50";

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
