"use client";

import { useEffect, useState } from "react";
import { BellRing, Check, MonitorSmartphone, Share } from "lucide-react";
import {
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  fetchPushServerState,
  getDeviceStatus,
  savePushPreferences,
  sendTestPushToThisDevice,
  type PushDeviceStatus,
} from "@/lib/web-push-client";
import type { PushCategory, PushPreferences } from "@/lib/web-push-payload";

const PUSH_LABELS: Record<PushCategory, { title: string; description: string }> = {
  approval: {
    title: "Chờ tôi duyệt",
    description: "Đề xuất tới lượt bạn duyệt (kể cả được chuyển tiếp) và điều chỉnh sau duyệt chờ bạn.",
  },
  mention: {
    title: "Được nhắc tên",
    description: "Ai đó nhắc bạn (hoặc phòng ban/nhóm của bạn) trong bình luận.",
  },
  result: {
    title: "Kết quả đề xuất của tôi",
    description: "Đề xuất bạn gửi được chấp thuận, bị từ chối, bị trả lại; điều chỉnh bạn đề nghị có kết quả.",
  },
};

const ORDER: PushCategory[] = ["approval", "mention", "result"];

function Switch({ enabled, label, onClick }: { enabled: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        enabled ? "bg-[var(--color-action-blue)]" : "bg-gray-300"
      }`}
    >
      <span
        className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/**
 * Mục "Thông báo ra màn hình" trong Cài đặt thông báo (Web Push — cấp 3, Sếp duyệt
 * 08/10/2026). Máy chủ chưa cấu hình khoá VAPID → ẩn hẳn, không hiện gì.
 */
export default function WebPushSettings() {
  const [serverEnabled, setServerEnabled] = useState<boolean | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PushPreferences | null>(null);
  const [status, setStatus] = useState<PushDeviceStatus | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await fetchPushServerState();
      if (cancelled) return;
      setServerEnabled(state.enabled);
      if (!state.enabled) return;
      setPublicKey(state.publicKey ?? null);
      setPrefs(state.prefs ?? null);
      const device = await getDeviceStatus();
      if (cancelled) return;
      setStatus(device.status);
      setSubscription(device.subscription);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!serverEnabled) return null;

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const next = await enablePushOnThisDevice(publicKey);
      setStatus(next);
      if (next === "subscribed") {
        const device = await getDeviceStatus();
        setSubscription(device.subscription);
        setMessage({ ok: true, text: "Đã bật. Bấm \"Gửi thử\" để kiểm tra." });
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Không bật được, thử lại sau." });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!subscription) return;
    setBusy(true);
    setMessage(null);
    await disablePushOnThisDevice(subscription);
    setSubscription(null);
    setStatus("not_subscribed");
    setBusy(false);
  }

  async function test() {
    if (!subscription) return;
    setBusy(true);
    setMessage(null);
    try {
      const error = await sendTestPushToThisDevice(subscription);
      setMessage(error ? { ok: false, text: error } : { ok: true, text: "Đã gửi — thông báo sẽ hiện trong vài giây." });
    } catch {
      setMessage({ ok: false, text: "Gửi thử không thành công." });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(category: PushCategory) {
    if (!prefs) return;
    const next = { ...prefs, [category]: !prefs[category] };
    setPrefs(next);
    const saved = await savePushPreferences({ [category]: next[category] });
    if (saved) setPrefs(saved);
    else setPrefs(prefs);
  }

  const primaryBtn =
    "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-action-blue)] px-3.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60";
  const secondaryBtn =
    "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] px-3.5 text-[13px] font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-page-bg)] disabled:opacity-60";

  return (
    <section className="mt-9">
      <div className="mb-5 flex items-center gap-2">
        <MonitorSmartphone size={20} className="text-[var(--color-action-blue)]" />
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">Thông báo ra màn hình</h2>
      </div>
      <p className="mb-5 text-[14px] text-[var(--color-text-secondary)]">
        Hiện thông báo ở góc màn hình máy tính hoặc màn hình khoá điện thoại, kể cả khi đã đóng tab app. Bật riêng
        cho từng máy/trình duyệt. Nội dung chỉ ghi mã đề xuất, tên nhóm và người làm — không ghi số tiền hay nội
        dung bình luận.
      </p>

      <div className="rounded border border-[var(--color-border)] px-4 py-3">
        {status === null ? (
          <p className="text-[14px] text-[var(--color-text-secondary)]">Đang kiểm tra máy này...</p>
        ) : status === "subscribed" ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto flex items-center gap-1.5 text-[14px] font-medium text-[var(--color-confirm-green)]">
              <Check size={16} /> Đã bật trên máy này
            </p>
            <button type="button" onClick={() => void test()} disabled={busy} className={primaryBtn}>
              <BellRing size={15} /> Gửi thử
            </button>
            <button type="button" onClick={() => void disable()} disabled={busy} className={secondaryBtn}>
              Tắt trên máy này
            </button>
          </div>
        ) : status === "not_subscribed" ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-[14px] text-[var(--color-text-primary)]">Chưa bật trên máy này</p>
            <button type="button" onClick={() => void enable()} disabled={busy} className={primaryBtn}>
              <BellRing size={15} /> Bật trên máy này
            </button>
          </div>
        ) : status === "denied" ? (
          <div className="text-[14px] text-[var(--color-text-primary)]">
            <p className="font-medium text-[var(--color-danger-red)]">Trình duyệt đang chặn thông báo của trang này.</p>
            <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
              Bấm biểu tượng ổ khoá (hoặc biểu tượng cài đặt trang) cạnh thanh địa chỉ → Thông báo → Cho phép, rồi tải
              lại trang và bấm &quot;Bật trên máy này&quot;. Trên điện thoại: Cài đặt trình duyệt → Cài đặt trang web →
              Thông báo.
            </p>
          </div>
        ) : status === "ios_needs_home_screen" ? (
          <div className="text-[14px] text-[var(--color-text-primary)]">
            <p className="font-medium">iPhone/iPad: cần thêm app vào Màn hình chính trước</p>
            <p className="mt-1 flex flex-wrap items-center gap-1 text-[13px] text-[var(--color-text-secondary)]">
              Trong Safari bấm <Share size={14} className="inline" aria-label="Chia sẻ" /> Chia sẻ → &quot;Thêm vào MH
              chính&quot;, mở app từ biểu tượng vừa thêm rồi vào lại trang này bấm Bật. Cần iOS 16.4 trở lên.
            </p>
          </div>
        ) : (
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Trình duyệt này chưa hỗ trợ thông báo ra màn hình. Hãy dùng Chrome, Edge, Firefox hoặc Safari bản mới.
          </p>
        )}
        {message && (
          <p
            role="status"
            className={`mt-2 text-[12px] ${message.ok ? "text-[var(--color-confirm-green)]" : "text-[var(--color-danger-red)]"}`}
          >
            {message.text}
          </p>
        )}
      </div>

      {prefs && (
        <>
          <p className="mb-2 mt-4 text-[13px] font-medium text-[var(--color-text-secondary)]">
            Loại được đẩy ra màn hình (áp dụng cho mọi máy bạn đã bật)
          </p>
          <div className="flex flex-col divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
            {ORDER.map((category) => (
              <div key={category} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-[14px] font-medium text-[var(--color-text-primary)]">{PUSH_LABELS[category].title}</p>
                  <p className="text-[12px] text-[var(--color-text-secondary)]">{PUSH_LABELS[category].description}</p>
                </div>
                <Switch
                  enabled={prefs[category]}
                  label={`Đẩy ra màn hình: ${PUSH_LABELS[category].title}`}
                  onClick={() => void toggle(category)}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
