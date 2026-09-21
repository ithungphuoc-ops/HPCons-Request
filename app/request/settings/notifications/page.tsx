"use client";

import { useEffect, useState } from "react";
import { Bell, Check, Mail } from "lucide-react";
import type { EmailNotifyCategory, NotificationCategory, NotificationSettings } from "@/lib/types";

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

/** Chỉ 3/6 loại ở trên hiện có email thật đi kèm — xem
 * lib/server/notification-emails.ts. Dùng lại đúng nhãn của CATEGORY_LABELS
 * để nhất quán chữ nghĩa với phần "trên chuông" ở trên. */
const EMAIL_CATEGORY_ORDER: EmailNotifyCategory[] = ["approver_pending", "own_decided", "following"];

interface EmailGroupPref {
  id: string;
  name: string;
  category: string;
  groupEmailEnabled: boolean;
  prefs: Record<EmailNotifyCategory, boolean>;
}

function ToggleSwitch({ enabled, label, onClick }: { enabled: boolean; label: string; onClick: () => void }) {
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
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [emailGroups, setEmailGroups] = useState<EmailGroupPref[] | null>(null);

  useEffect(() => {
    fetch("/api/notification-settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.settings) setSettings(json.settings);
      })
      .catch(() => {});
    fetch("/api/notification-settings/email")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.groups) setEmailGroups(json.groups);
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

  async function toggleEmail(groupId: string, category: EmailNotifyCategory) {
    if (!emailGroups) return;
    const nextEnabled = !emailGroups.find((g) => g.id === groupId)?.prefs[category];
    setEmailGroups((prev) =>
      prev
        ? prev.map((g) => (g.id === groupId ? { ...g, prefs: { ...g.prefs, [category]: nextEnabled } } : g))
        : prev,
    );
    setSaved(false);
    const res = await fetch("/api/notification-settings/email", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, category, enabled: nextEnabled }),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  // Gom theo category để danh sách ~24 nhóm không dồn thành 1 khối dài
  // không phân biệt được — mỗi khối tự thu/mở bằng <details> gốc trình
  // duyệt, không cần thêm state riêng.
  const emailGroupsByCategory = (emailGroups ?? []).reduce<Record<string, EmailGroupPref[]>>((acc, g) => {
    (acc[g.category] ??= []).push(g);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-[720px] p-6">
      <div className="mb-5 flex items-center gap-2">
        <Bell size={20} className="text-[var(--color-action-blue)]" />
        <h1 className="text-[16px] font-semibold text-[var(--color-text-primary)]">Cài đặt thông báo</h1>
      </div>
      <p className="mb-5 text-[14px] text-[var(--color-text-secondary)]">
        Chọn loại thông báo bạn muốn nhận trên chuông. Loại bị tắt sẽ không hiện trong chuông và không tính vào số
        thông báo chưa đọc.
      </p>

      {!settings ? (
        <p className="text-[14px] text-[var(--color-text-secondary)]">Đang tải...</p>
      ) : (
        <div className="flex flex-col divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
          {ORDER.map((category) => {
            const { title, description } = CATEGORY_LABELS[category];
            const enabled = settings[category];
            return (
              <div key={category} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="text-[14px] font-medium text-[var(--color-text-primary)]">{title}</p>
                  <p className="text-[12px] text-[var(--color-text-secondary)]">{description}</p>
                </div>
                <ToggleSwitch enabled={enabled} label={title} onClick={() => toggle(category)} />
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-5 mt-9 flex items-center gap-2">
        <Mail size={20} className="text-[var(--color-action-blue)]" />
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">Nhận email theo từng nhóm</h2>
      </div>
      <p className="mb-5 text-[14px] text-[var(--color-text-secondary)]">
        Ngoài chuông trong app, một số nhóm đề xuất còn gửi email — tự bạn chọn loại nào muốn nhận email cho từng
        nhóm. Nhóm chưa bật email (do Admin nhóm quyết định) thì công tắc ở đây tạm chưa có tác dụng.
      </p>

      {emailGroups === null ? (
        <p className="text-[14px] text-[var(--color-text-secondary)]">Đang tải...</p>
      ) : emailGroups.length === 0 ? (
        <p className="text-[14px] text-[var(--color-text-secondary)]">Bạn chưa thuộc phạm vi sử dụng của nhóm đề xuất nào.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {Object.entries(emailGroupsByCategory).map(([category, groups]) => (
            <details key={category} className="rounded border border-[var(--color-border)]" open>
              <summary className="cursor-pointer select-none px-4 py-2.5 text-[13px] font-semibold text-[var(--color-text-primary)]">
                {category || "Chưa phân loại"}{" "}
                <span className="font-normal text-[var(--color-text-secondary)]">({groups.length} nhóm)</span>
              </summary>
              <div className="flex flex-col divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                {groups.map((g) => (
                  <div key={g.id} className="px-4 py-3">
                    <div className="mb-1.5 flex items-center gap-2">
                      <p className="text-[14px] font-medium text-[var(--color-text-primary)]">{g.name}</p>
                      {!g.groupEmailEnabled && (
                        <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                          Nhóm chưa bật email
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
                      {EMAIL_CATEGORY_ORDER.map((cat) => (
                        <div key={cat} className="flex items-center justify-between gap-4 px-3 py-2">
                          <span className="text-[13px] text-[var(--color-text-primary)]">{CATEGORY_LABELS[cat].title}</span>
                          <ToggleSwitch
                            enabled={g.prefs[cat]}
                            label={`${CATEGORY_LABELS[cat].title} — ${g.name}`}
                            onClick={() => toggleEmail(g.id, cat)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          ))}
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
