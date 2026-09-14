"use client";

import { useCurrentSession } from "@/lib/useCurrentSession";

/**
 * Chặn hiển thị UI cấu hình (nhóm đề xuất, webhook, lịch sử...) với người
 * không phải owner/admin — CHỈ là lớp ẩn giao diện cho gọn; máy chủ
 * (`requireWriteAccess`) mới là nơi thật sự chặn ghi dữ liệu.
 */
export default function RequireAdminRole({ children }: { children: React.ReactNode }) {
  const { loaded, isAdmin } = useCurrentSession();

  if (!loaded) return null;

  if (!isAdmin) {
    return (
      <div className="px-8 py-6">
        <p className="text-[14px] text-gray-500">
          Chỉ Owner hoặc Admin mới xem được trang này.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
