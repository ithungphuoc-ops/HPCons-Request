"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const settingsNavItems = [
  { key: "general", label: "Thiết lập chung" },
  { key: "form", label: "Mẫu form đề xuất" },
  { key: "print", label: "In đề xuất" },
  { key: "webhook", label: "Chuyển tiếp và Webhook" },
  { key: "permissions", label: "Tùy chỉnh về phân quyền" },
  { key: "counter", label: "Bộ đếm" },
  { key: "notifications", label: "Thông báo" },
];

export default function GroupDetailNav({ groupId }: { groupId: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex w-[230px] shrink-0 flex-col gap-0.5 border-r border-[var(--color-border)] py-4 pr-3">
      {settingsNavItems.map((item) => {
        const href = `/request/groups/${groupId}/${item.key}`;
        const isActive = pathname === href;
        return (
          <Link
            key={item.key}
            href={href}
            className={`relative rounded px-3 py-2 text-[13px] ${
              isActive
                ? "bg-blue-50 font-medium text-[var(--color-action-blue)]"
                : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            {isActive && (
              <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[var(--color-action-blue)]" />
            )}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
