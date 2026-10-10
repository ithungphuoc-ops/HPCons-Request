"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Role } from "@/lib/permissions";

export interface CurrentSession {
  uid: string;
  email: string;
  name: string;
  role: Role;
  avatarUrl: string | null;
}

interface CurrentSessionContextValue {
  session: CurrentSession | null;
  loaded: boolean;
  isAdmin: boolean;
}

const CurrentSessionContext = createContext<CurrentSessionContextValue | null>(null);

/**
 * Gộp MỌI nơi cần "phiên hiện tại phía trình duyệt" vào ĐÚNG 1 lượt gọi
 * `/api/session` cho cả trang. Trước đây (tới 09/10/2026) mỗi nơi dùng
 * `useCurrentSession()` tự fetch riêng (AppBar, FuncBar, AppLauncher,
 * RequestDetailView, RequireAdminRole, và 3 trang) — đo thật 10/10/2026 cho
 * thấy 1 lần tải trang `/request` bắn ra 3 lượt `/api/session` CÙNG LÚC.
 *
 * Cache 60s phía máy chủ (xem lib/hpcore.ts) KHÔNG gộp được các lượt gọi
 * CÙNG LÚC này — đo thật cho thấy 5 request gửi đồng thời rơi vào 5 instance
 * Vercel khác nhau (mỗi instance có bộ nhớ cache riêng). Gộp ở đây (1 lượt
 * fetch dùng chung cho cả cây component) mới giải quyết được tận gốc.
 */
export function CurrentSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<CurrentSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: CurrentSession | null) => {
        if (!cancelled) setSession(data);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isAdmin = session?.role === "owner" || session?.role === "admin";

  return (
    <CurrentSessionContext.Provider value={{ session, loaded, isAdmin }}>
      {children}
    </CurrentSessionContext.Provider>
  );
}

/** Phiên hiện tại phía client — dùng để ẩn/hiện UI theo vai trò (server vẫn là nơi chặn thật). */
export function useCurrentSession(): CurrentSessionContextValue {
  const ctx = useContext(CurrentSessionContext);
  if (!ctx) {
    throw new Error("useCurrentSession phải được gọi bên trong CurrentSessionProvider");
  }
  return ctx;
}
