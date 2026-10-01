"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Settings } from "lucide-react";
import { useRequestContext } from "@/context/RequestContext";
import GroupRow from "@/components/request/GroupRow";
import type { CategoryGroup } from "@/lib/types";

// Khớp đúng danh sách máy chủ nhận ở app/api/categories/[id]/letterhead (không SVG).
const LETTERHEAD_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export default function GroupCategoryCard({
  category,
  selectedIds,
  onToggleSelect,
}: {
  category: CategoryGroup;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const { collapsedCategoryIds, toggleCategoryCollapsed } = useRequestContext();
  const collapsed = collapsedCategoryIds.has(category.id);

  // Ảnh "tiêu đề công văn" (logo + tên công ty) RIÊNG cho từng công ty —
  // override cục bộ ngay sau khi tải lên thành công để thấy kết quả liền,
  // không cần refetch toàn bộ /api/groups (refetchGroups chưa lộ ra ngoài
  // RequestContext — thêm state riêng ở đây gọn hơn sửa context). Sếp chốt
  // 01/10/2026: mỗi company (02-HPCons/03-EQUI...) có 1 ảnh riêng, hiện ở
  // đầu bản in đề xuất (xem RequestDetailView.tsx).
  const [letterheadOverrideName, setLetterheadOverrideName] = useState<string | null>(null);
  const letterheadName = letterheadOverrideName ?? category.letterheadImageName;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleLetterheadFile = async (file: File) => {
    // Chặn sớm phía trình duyệt — máy chủ vẫn kiểm lại đúng loại file thật
    // trên R2 (app/api/categories/[id]/letterhead), đây chỉ để khỏi tải lên
    // 1 file rồi mới bị từ chối.
    if (!LETTERHEAD_IMAGE_TYPES.includes(file.type)) {
      setUploadError("Chỉ nhận ảnh PNG, JPG, WEBP hoặc GIF.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("files", file);
      const uploadRes = await fetch("/api/uploads", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const body = (await uploadRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Không thể tải ảnh lên.");
      }
      const uploadData = (await uploadRes.json()) as {
        attachments: { path: string; name: string; size: number }[];
      };
      const uploaded = uploadData.attachments[0];
      if (!uploaded) throw new Error("Không thể tải ảnh lên.");

      const patchRes = await fetch(`/api/categories/${category.id}/letterhead`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: uploaded.path, name: uploaded.name }),
      });
      if (!patchRes.ok) {
        const body = (await patchRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Không thể lưu ảnh cho công ty này.");
      }
      setLetterheadOverrideName(uploaded.name);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="mb-4 overflow-hidden rounded-[3px] border border-[var(--color-border)] bg-[var(--color-card-bg)] shadow-sm">
      <div className="flex w-full items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => toggleCategoryCollapsed(category.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight size={16} className="shrink-0 text-gray-400" />
          ) : (
            <ChevronDown size={16} className="shrink-0 text-gray-400" />
          )}
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-gray-800">
              {category.code} - {category.name}
            </p>
            <p className="text-[12px] text-gray-400">{category.groups.length} nhóm đề xuất</p>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {letterheadName && (
            <span
              className="hidden max-w-[140px] truncate text-[11px] text-gray-400 sm:inline"
              title={letterheadName}
            >
              {letterheadName}
            </span>
          )}
          <label className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded border border-[var(--color-border)] px-2 text-[12px] font-medium text-gray-600 hover:bg-gray-50">
            <Settings size={13} />
            {uploading ? "Đang tải lên..." : "Cài đặt thông tin"}
            <input
              ref={fileInputRef}
              type="file"
              accept={LETTERHEAD_IMAGE_TYPES.join(",")}
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleLetterheadFile(file);
              }}
            />
          </label>
        </div>
      </div>
      {uploadError && <p className="px-4 pb-2 text-[12px] text-[var(--color-danger-red)]">{uploadError}</p>}

      {!collapsed && (
        <div>
          <div className="flex items-center gap-3 bg-[var(--color-category-header-bg)] px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-category-header-text)]">
            <span className="w-4 shrink-0" />
            <span className="w-6 shrink-0 text-center">STT</span>
            <span className="w-[15px] shrink-0" />
            <span className="min-w-0 flex-[2]">Tên nhóm</span>
            <span className="flex-1">Quy trình</span>
            <span className="w-[90px] shrink-0">Thời hạn</span>
            <span className="w-[110px] shrink-0">Trạng thái</span>
            <span className="w-8 shrink-0" />
          </div>
          {category.groups.map((group, index) => (
            <GroupRow
              key={group.id}
              group={group}
              index={index}
              selected={selectedIds.has(group.id)}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
