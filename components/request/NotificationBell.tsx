"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import type { NotificationSettings, RequestInstance } from "@/lib/types";

interface NotificationItem {
  id: string;
  requestId: string;
  text: string;
  at: string;
}

function buildNotifications(
  inbox: RequestInstance[],
  mine: RequestInstance[],
  mentioned: RequestInstance[],
  followingUnseen: RequestInstance[],
  managerBypassed: RequestInstance[],
  approverFollowup: RequestInstance[],
  settings: NotificationSettings | null,
): NotificationItem[] {
  const items: NotificationItem[] = [];
  const enabled = (key: keyof NotificationSettings) => settings?.[key] !== false;

  if (enabled("approver_pending")) {
    for (const r of inbox) {
      const lastEntry = r.history[r.history.length - 1];
      const forwardedToMe =
        lastEntry?.action === "Đã chấp thuận và chuyển tiếp" ||
        lastEntry?.action === "Đã chuyển tiếp cho duyệt trước";
      items.push({
        id: `inbox-${r.id}`,
        requestId: r.id,
        text: forwardedToMe
          ? `Bạn được chuyển tiếp đề xuất "${r.groupNameSnapshot}"`
          : `"${r.groupNameSnapshot}" đang chờ bạn duyệt`,
        at: lastEntry?.at ?? r.submittedAt,
      });
    }
  }

  // Người theo dõi — trước đây báo ĐÚNG 1 lần lúc gửi rồi im lặng mãi, dù có
  // bình luận/quyết định mới. `followingUnseen` (server đã lọc theo
  // `viewedAt`) giải quyết cả 2: đề xuất mới CHƯA từng xem, và đề xuất cũ có
  // biến động mới kể từ lần xem gần nhất — xem design.md của change
  // fix-notification-bell-stale-gaps.
  if (enabled("following")) {
    for (const r of followingUnseen) {
      const isBrandNew = r.submittedAt === r.updatedAt;
      items.push({
        id: `following-${r.id}`,
        requestId: r.id,
        text: isBrandNew
          ? `Đề xuất bạn đang theo dõi "${r.groupNameSnapshot}" vừa được gửi`
          : `Đề xuất bạn đang theo dõi "${r.groupNameSnapshot}" có cập nhật mới`,
        at: r.updatedAt,
      });
    }
  }

  if (enabled("own_decided")) {
    for (const r of mine) {
      if (r.status !== "approved" && r.status !== "rejected") continue;
      const lastEntry = r.history[r.history.length - 1];
      items.push({
        id: `mine-${r.id}`,
        requestId: r.id,
        text: `Đề xuất "${r.groupNameSnapshot}" của bạn đã ${
          r.status === "approved" ? "được chấp thuận" : "bị từ chối"
        }`,
        at: lastEntry?.at ?? r.submittedAt,
      });
    }
  }

  // Server đã lọc theo `viewedAt` — mở lại đúng đề xuất 1 lần là tự hết hiện
  // (trước đây không có khái niệm "đã đọc", luôn hiện tới khi bị đẩy khỏi
  // top-8), xem design.md của change fix-notification-bell-stale-gaps.
  if (enabled("mentioned")) {
    for (const r of mentioned) {
      items.push({
        id: `mentioned-${r.id}`,
        requestId: r.id,
        text: `Bạn được nhắc tới trong đề xuất "${r.groupNameSnapshot}"`,
        at: r.updatedAt,
      });
    }
  }

  if (enabled("manager_bypassed")) {
    for (const r of managerBypassed) {
      items.push({
        id: `manager-bypassed-${r.id}`,
        requestId: r.id,
        text: `Đề xuất "${r.groupNameSnapshot}" đã chọn người khác duyệt thay bạn`,
        at: r.updatedAt,
      });
    }
  }

  // Đã xử lý xong phần mình nhưng đề xuất có biến động mới (bình luận, hoặc
  // bước sau từ chối) — trước đây hoàn toàn im lặng sau khi tự xử lý xong,
  // xem design.md của change fix-notification-bell-stale-gaps.
  if (enabled("approver_followup")) {
    for (const r of approverFollowup) {
      items.push({
        id: `approver-followup-${r.id}`,
        requestId: r.id,
        text:
          r.status === "rejected"
            ? `Đề xuất "${r.groupNameSnapshot}" bạn đã duyệt bị từ chối ở bước sau`
            : `Đề xuất "${r.groupNameSnapshot}" bạn đã xử lý có cập nhật mới`,
        at: r.updatedAt,
      });
    }
  }

  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 8);
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/requests?scope=inbox").then((res) => (res.ok ? res.json() : { requests: [] })),
      fetch("/api/requests?scope=mine").then((res) => (res.ok ? res.json() : { requests: [] })),
      fetch("/api/requests?scope=mentioned").then((res) => (res.ok ? res.json() : { requests: [] })),
      fetch("/api/requests?scope=following-unseen").then((res) => (res.ok ? res.json() : { requests: [] })),
      fetch("/api/requests?scope=manager-bypassed").then((res) => (res.ok ? res.json() : { requests: [] })),
      fetch("/api/requests?scope=approver-followup").then((res) => (res.ok ? res.json() : { requests: [] })),
      fetch("/api/notification-settings").then((res) => (res.ok ? res.json() : { settings: null })),
    ])
      .then(
        ([
          inboxData,
          mineData,
          mentionedData,
          followingData,
          managerBypassedData,
          approverFollowupData,
          settingsData,
        ]: [
          { requests: RequestInstance[] },
          { requests: RequestInstance[] },
          { requests: RequestInstance[] },
          { requests: RequestInstance[] },
          { requests: RequestInstance[] },
          { requests: RequestInstance[] },
          { settings: NotificationSettings | null },
        ]) => {
          const settings = settingsData.settings ?? null;
          const inboxRequests = settings?.approver_pending === false ? [] : (inboxData.requests ?? []);
          setPendingCount(inboxRequests.length);
          setItems(
            buildNotifications(
              inboxData.requests ?? [],
              mineData.requests ?? [],
              mentionedData.requests ?? [],
              followingData.requests ?? [],
              managerBypassedData.requests ?? [],
              approverFollowupData.requests ?? [],
              settings,
            ),
          );
        },
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Thông báo"
        aria-label="Thông báo"
        className="relative flex h-12 w-12 items-center justify-center rounded-xl text-[var(--color-appbar-text)] hover:bg-white/10 hover:text-[var(--color-appbar-text-active)]"
      >
        <Bell size={22} strokeWidth={1.75} />
        {pendingCount > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--color-danger-red)] px-0.5 text-[9px] font-semibold text-white">
            {pendingCount}
          </span>
        )}
      </button>

      {open && (
        // z-50: FuncBar (sidebar nhóm đề xuất) dùng z-40 cho chính nó — z-20 cũ
        // thấp hơn nên bị sidebar vẽ đè lên trên (góp ý Nhung 14/08/2026).
        <div className="absolute left-full top-0 z-50 ml-2 w-[300px] rounded border border-[var(--color-border)] bg-white shadow-lg">
          <div className="border-b border-gray-100 px-3 py-2 text-[13px] font-semibold text-gray-700">
            Thông báo
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-gray-400">Chưa có thông báo nào.</p>
            ) : (
              items.map((item) => (
                <Link
                  key={item.id}
                  href={`/request/requests/${item.requestId}`}
                  onClick={() => setOpen(false)}
                  className="block border-b border-gray-50 px-3 py-2.5 text-[12px] text-gray-700 last:border-0 hover:bg-gray-50"
                >
                  <p>{item.text}</p>
                  <p className="mt-0.5 text-gray-400">{new Date(item.at).toLocaleString("vi-VN")}</p>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
