"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  Bell,
  CheckCircle2,
  Eye,
  History,
  Inbox,
  Settings,
  UserX,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { NotificationSettings, RequestInstance } from "@/lib/types";
import {
  ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX,
  TABLE_SUPPLEMENT_HISTORY_PREFIX,
} from "@/lib/request-history-labels";

/** Loại thông báo — quyết định icon + màu ở dải bên trái mỗi dòng. Cùng bộ
 * với `NotificationCategory` (cài đặt cá nhân) để người dùng tắt loại nào là
 * mất đúng loại icon đó, không lệch. */
type NotificationKind =
  | "approver_pending"
  | "own_decided"
  | "own_rejected"
  | "mentioned"
  | "following"
  | "manager_bypassed"
  | "approver_followup";

interface NotificationItem {
  id: string;
  requestId: string;
  kind: NotificationKind;
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
        kind: "approver_pending",
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
        kind: "following",
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
      // Bỏ qua các dòng "Bổ sung sau duyệt" khi tìm entry quyết định gần
      // nhất — nếu không, submitter tự bổ sung dữ liệu/đính file muộn sẽ
      // đẩy dòng đó lên cuối history[], khiến thông báo "đã được chấp
      // thuận" tưởng vừa xảy ra với thời điểm SAI (lúc bổ sung, không phải
      // lúc duyệt thật) — xem design.md của change add-post-approval-supplement.
      const lastEntry = [...r.history]
        .reverse()
        .find(
          (h) =>
            !h.action.startsWith(TABLE_SUPPLEMENT_HISTORY_PREFIX) &&
            !h.action.startsWith(ATTACHMENT_SUPPLEMENT_HISTORY_PREFIX),
        );
      items.push({
        id: `mine-${r.id}`,
        requestId: r.id,
        kind: r.status === "approved" ? "own_decided" : "own_rejected",
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
        kind: "mentioned",
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
        kind: "manager_bypassed",
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
        kind: "approver_followup",
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

/** "5 phút trước" / "Hôm qua 14:20" — dễ đọc hơn dãy "09:37:16 15/9/2026".
 * Giờ đầy đủ vẫn còn, nằm ở `title` của dòng (rê chuột là thấy). */
function nhanThoiGian(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const phut = Math.floor((now - t) / 60000);
  if (phut < 1) return "Vừa xong";
  if (phut < 60) return `${phut} phút trước`;
  const gio = Math.floor(phut / 60);
  if (gio < 24) return `${gio} giờ trước`;
  const d = new Date(t);
  const hhmm = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const ngay = Math.floor(gio / 24);
  if (ngay === 1) return `Hôm qua ${hhmm}`;
  if (ngay < 7) return `${ngay} ngày trước`;
  return `${d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })} ${hhmm}`;
}

/** Mỗi loại một icon + một màu. Người duyệt đang chờ mình thì nổi nhất (xanh
 * dương), từ chối/vượt cấp màu đỏ, còn lại xám nhạt — để liếc một cái là biết
 * dòng nào cần làm gì, thay vì 8 dòng chữ giống hệt nhau. */
const KIEU_THONG_BAO: Record<
  NotificationKind,
  { Icon: LucideIcon; nen: string; chu: string }
> = {
  approver_pending: { Icon: Inbox, nen: "bg-blue-50", chu: "text-[var(--color-action-blue)]" },
  own_decided: { Icon: CheckCircle2, nen: "bg-green-50", chu: "text-[var(--color-confirm-green)]" },
  own_rejected: { Icon: XCircle, nen: "bg-red-50", chu: "text-[var(--color-danger-red)]" },
  mentioned: { Icon: AtSign, nen: "bg-amber-50", chu: "text-amber-600" },
  following: { Icon: Eye, nen: "bg-gray-100", chu: "text-gray-500" },
  manager_bypassed: { Icon: UserX, nen: "bg-red-50", chu: "text-[var(--color-danger-red)]" },
  approver_followup: { Icon: History, nen: "bg-gray-100", chu: "text-gray-500" },
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  // Mốc thời gian để tính "5 phút trước". Giữ trong state và làm mới mỗi phút
  // thay vì gọi Date.now() thẳng lúc render — gọi thẳng thì mỗi lần render ra
  // một con số khác, nhãn thời gian nhảy lung tung không rõ lý do.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

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
        <div className="absolute left-full top-0 z-50 ml-2 w-[380px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-white shadow-[0_8px_28px_rgba(16,34,48,0.16)]">
          <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
            <span className="text-[15px] font-semibold text-gray-800">Thông báo</span>
            {items.length > 0 && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[12px] font-semibold text-gray-500">
                {items.length}
              </span>
            )}
            <Link
              href="/request/settings/notifications"
              onClick={() => setOpen(false)}
              title="Cài đặt thông báo"
              aria-label="Cài đặt thông báo"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <Settings size={15} />
            </Link>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <span className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-300">
                  <Bell size={20} />
                </span>
                <p className="text-[14px] font-medium text-gray-500">Chưa có thông báo nào</p>
                <p className="mt-0.5 text-[12px] text-gray-400">
                  Có việc cần bạn xử lý thì sẽ hiện ở đây.
                </p>
              </div>
            ) : (
              items.map((item) => {
                const kieu = KIEU_THONG_BAO[item.kind];
                return (
                  <Link
                    key={item.id}
                    href={`/request/requests/${item.requestId}`}
                    onClick={() => setOpen(false)}
                    title={new Date(item.at).toLocaleString("vi-VN")}
                    className="flex gap-3 border-b border-gray-50 px-4 py-3 last:border-0 hover:bg-gray-50"
                  >
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${kieu.nen} ${kieu.chu}`}
                      aria-hidden
                    >
                      <kieu.Icon size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] leading-snug text-gray-800">{item.text}</span>
                      <span className="mt-1 block text-[12px] text-gray-400">
                        {nhanThoiGian(item.at, now)}
                      </span>
                    </span>
                  </Link>
                );
              })
            )}
          </div>

          {items.length > 0 && (
            <Link
              href="/request/list?scope=sent-to-me"
              onClick={() => setOpen(false)}
              className="block border-t border-gray-100 bg-gray-50 px-4 py-2.5 text-center text-[13px] font-medium text-[var(--color-action-blue)] hover:bg-gray-100"
            >
              Xem tất cả đề xuất chờ tôi duyệt
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
