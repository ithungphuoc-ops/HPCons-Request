"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, X } from "lucide-react";
import {
  dismissBanner,
  enablePushOnThisDevice,
  fetchPushServerState,
  getDeviceStatus,
  isBannerDismissed,
} from "@/lib/web-push-client";

/**
 * Dải nhắc nhỏ trong bảng chuông (Web Push — cấp 3, 08/10/2026): "Bật thông báo ra màn
 * hình…". Chỉ hiện khi máy chủ đã bật tính năng + máy này chưa bật + chưa bị chặn + người
 * dùng chưa bấm ẩn. Chỉ chạy khi bảng chuông MỞ (1 lượt GET/phiên trang, xem fetchPushServerState).
 */
export default function WebPushBanner({ onNavigate }: { onNavigate?: () => void }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (isBannerDismissed()) return;
    let cancelled = false;
    (async () => {
      const state = await fetchPushServerState();
      if (cancelled || !state.enabled || !state.publicKey) return;
      const device = await getDeviceStatus();
      if (cancelled || device.status !== "not_subscribed") return;
      setPublicKey(state.publicKey);
      setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible && !note) return null;

  if (note) {
    return (
      <div role="status" className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">
        {note}
      </div>
    );
  }

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const status = await enablePushOnThisDevice(publicKey);
      setVisible(false);
      setNote(
        status === "subscribed"
          ? "Đã bật thông báo ra màn hình trên máy này."
          : status === "denied"
            ? "Trình duyệt đã chặn thông báo — có thể mở lại trong Cài đặt thông báo."
            : "Chưa bật được — thử lại trong Cài đặt thông báo.",
      );
    } catch {
      setNote("Chưa bật được — thử lại trong Cài đặt thông báo.");
      setVisible(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 dark:border-blue-500/20 dark:bg-blue-500/10">
      <BellRing size={16} className="flex-none text-[var(--color-action-blue)]" aria-hidden />
      <p className="min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)]">
        Bật thông báo ra màn hình để không lỡ đề xuất cần duyệt.{" "}
        <Link href="/request/settings/notifications" onClick={onNavigate} className="text-[var(--color-action-blue)] hover:underline">
          Tuỳ chọn
        </Link>
      </p>
      <button
        type="button"
        onClick={() => void enable()}
        disabled={busy}
        className="min-h-8 rounded-md bg-[var(--color-action-blue)] px-3 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        Bật
      </button>
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
