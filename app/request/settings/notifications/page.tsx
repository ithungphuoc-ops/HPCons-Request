"use client";

import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import type { NotificationCategory, NotificationSettings } from "@/lib/types";

const CATEGORY_LABELS: Record<NotificationCategory, { title: string; description: string }> = {
  approver_pending: {
    title: "Cần tôi duyệt",
    description: "Có đề xuất đang chờ bạn xét duyệt.",
  },
  own_decided: {
    title: "Đề xuất của tôi có kết quả",
    description: "Đề xuất bạn gửi vừa được chấp thuận hoặc từ chối.",
  },
  mentioned: {
    title: "Được nhắc tên (@mention)",
    description: "Ai đó nhắc tên bạn trong bình luận của một đề xuất.",
  },
  following: {
    title: "Đang theo dõi",
    description: "Có đề xuất mới thuộc nhóm bạn đang theo dõi.",
  },
  manager_bypassed: {
    title: "Quản lý trực tiếp bị chọn người khác duyệt",
    description: "Bạn là quản lý trực tiếp của người gửi, nhưng họ chọn người khác duyệt thay.",
  },
  approver_followup: {
    title: "Cập nhật sau khi tôi đã xử lý",
    description: "Đề xuất bạn đã duyệt/từ chối có bình luận mới, hoặc bị từ chối ở bước sau bạn.",
  },
};

const ORDER: NotificationCategory[] = [
  "approver_pending",
  "approver_followup",
  "own_decided",
  "mentioned",
  "following",
  "manager_bypassed",
];

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/notification-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.settings) setSettings(json.settings);
      })
      .catch(() => {});
  }, []);

  async function toggle(category: NotificationCategory) {
    if (!settings) return;
    const next = { ...settings, [category]: !settings[category] };
    setSettings(next);
    setSaved(false);
    const res = await fetch("/api/notification-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [category]: next[category] }),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  return (
    <div className="mx-auto max-w-[560px] p-6">
      <div className="mb-5 flex items-center gap-2">
        <Bell size={20} className="text-[var(--color-action-blue)]" />
        <h1 className="text-[16px] font-semibold text-[var(--color-text-primary)]">Cài đặt thông báo</h1>
      </div>
      <p className="mb-5 text-[13px] text-[var(--color-text-secondary)]">
        Chọn loại thông báo bạn muốn nhận trên chuông. Loại bị tắt sẽ không hiện trong chuông và không tính vào số
        thông báo chưa đọc.
      </p>

      {!settings ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">Đang tải...</p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
          {ORDER.map((category) => {
            const { title, description } = CATEGORY_LABELS[category];
            const enabled = settings[category];
            return (
              <div key={category} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-[var(--color-text-primary)]">{title}</p>
                  <p className="text-[12px] text-[var(--color-text-secondary)]">{description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={title}
                  onClick={() => toggle(category)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    enabled ? "bg-[var(--color-action-blue)]" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      enabled ? "translate-x-[22px]" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {saved && (
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--color-confirm-green)]">
          <Check size={14} /> Đã lưu
        </p>
      )}
    </div>
  );
}
