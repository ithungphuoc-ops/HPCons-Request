"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Copy } from "lucide-react";
import { useRequestContext } from "@/context/RequestContext";
import GroupDetailNav from "@/components/request/GroupDetailNav";

export default function GroupDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ groupId: string }>();
  const router = useRouter();
  const { getGroupById, duplicateGroup } = useRequestContext();
  const group = getGroupById(params.groupId);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const handleDuplicate = async () => {
    setDuplicateError(null);
    setDuplicating(true);
    try {
      const newGroup = await duplicateGroup(params.groupId, group?.name);
      // Reset NGAY ở đây (không đợi router.push xong) — layout này dùng
      // chung cho MỌI [groupId], Next.js không unmount/remount nó khi chỉ
      // đổi dynamic segment (điều hướng sang nhóm mới vẫn LÀ layout này),
      // nên nếu không tự reset, nút "Nhân bản" của nhóm mới sẽ kẹt ở trạng
      // thái "Đang nhân bản…" (disabled) cho tới khi tải lại trang.
      setDuplicating(false);
      router.push(`/request/groups/${newGroup.id}/general`);
    } catch (err) {
      setDuplicateError(err instanceof Error ? err.message : "Không thể nhân bản nhóm đề xuất.");
      setDuplicating(false);
    }
  };

  if (!group) {
    return (
      <div className="px-8 py-6">
        <p className="text-[13px] text-gray-400">
          Không tìm thấy nhóm đề xuất này. Nhóm có thể đã bị xóa hoặc bạn không có quyền xem.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start gap-3 border-b border-gray-100 px-8 py-5">
        <button
          type="button"
          onClick={() => router.push("/request/groups")}
          aria-label="Quay lại danh sách nhóm đề xuất"
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[20px] font-semibold text-gray-900">{group.name}</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">{group.description || "Chưa có mô tả."}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={duplicating}
            className="mt-1 flex items-center gap-1.5 rounded-[3px] border border-[var(--color-border)] px-3 py-1.5 text-[13px] font-medium text-gray-700 hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)] disabled:opacity-50"
          >
            <Copy size={14} />
            {duplicating ? "Đang nhân bản…" : "Nhân bản"}
          </button>
          {duplicateError && (
            <p className="max-w-[240px] text-right text-[12px] text-[var(--color-danger-red)]">{duplicateError}</p>
          )}
        </div>
      </div>

      <div className="flex px-8 py-4">
        <GroupDetailNav groupId={group.id} />
        <div className="min-w-0 flex-1 pl-6">{children}</div>
      </div>
    </div>
  );
}
