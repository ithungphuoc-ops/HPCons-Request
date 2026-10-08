"use client";

import { useEffect } from "react";
import { ExternalLink, MonitorSmartphone } from "lucide-react";
import { HPCORE_PUSH_SETTINGS_URL, PUSH_MOVED_MESSAGE } from "@/lib/constants";
import { migrateLegacyPushSubscription } from "@/lib/web-push-client";

/**
 * Mục "Thông báo ra màn hình" trong Cài đặt thông báo — từ 08/10/2026 chỉ còn lời chỉ sang
 * App Tổng (1 chỗ cài đặt cho mọi app). Mở trang này cũng dọn đăng ký cũ của máy (im lặng).
 */
export default function WebPushSettings() {
  useEffect(() => {
    void migrateLegacyPushSubscription();
  }, []);

  return (
    <section className="mt-9">
      <div className="mb-5 flex items-center gap-2">
        <MonitorSmartphone size={20} className="text-[var(--color-action-blue)]" />
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">Thông báo ra màn hình</h2>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded border border-[var(--color-border)] px-4 py-3">
        <p className="mr-auto min-w-0 text-[14px] text-[var(--color-text-primary)]">{PUSH_MOVED_MESSAGE}.</p>
        <a
          href={HPCORE_PUSH_SETTINGS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-action-blue)] px-3.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
        >
          Mở cài đặt ở App Tổng <ExternalLink size={14} aria-hidden />
        </a>
      </div>
    </section>
  );
}
