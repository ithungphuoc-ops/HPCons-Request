"use client";

import { useEffect, useState } from "react";
import { BellRing, ExternalLink, X } from "lucide-react";
import { HPCORE_PUSH_SETTINGS_URL, PUSH_MOVED_MESSAGE } from "@/lib/constants";
import { dismissBanner, isBannerDismissed, migrateLegacyPushSubscription } from "@/lib/web-push-client";

/**
 * Dải nhắc nhỏ trong bảng chuông: thông báo ra màn hình giờ bật ở App Tổng (08/10/2026).
 * Hiện tới khi người dùng bấm ẩn. Kèm dọn đăng ký cũ trên request.hpcore.vn (im lặng, 1 lần).
 */
export default function WebPushBanner({ onNavigate }: { onNavigate?: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void migrateLegacyPushSubscription();
    if (!isBannerDismissed()) setVisible(true);
  }, []);

  if (!visible) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 dark:border-blue-500/20 dark:bg-blue-500/10">
      <BellRing size={16} className="flex-none text-[var(--color-action-blue)]" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)]">{PUSH_MOVED_MESSAGE}.</p>
      <a
        href={HPCORE_PUSH_SETTINGS_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        className="inline-flex min-h-8 items-center gap-1 rounded-md bg-[var(--color-action-blue)] px-3 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
      >
        Mở cài đặt <ExternalLink size={13} aria-hidden />
      </a>
      <button
        type="button"
        onClick={() => {
          dismissBanner();
          setVisible(false);
        }}
        aria-label="Ẩn lời nhắc"
        title="Ẩn lời nhắc"
        className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-card-bg)]"
      >
        <X size={15} />
      </button>
    </div>
  );
}
