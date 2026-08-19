"use client";

import { Download, ExternalLink } from "lucide-react";
import Modal from "@/components/shared/Modal";
import type { RequestAttachment } from "@/lib/types";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Xem trước tệp đính kèm trong 1 popup thay vì bấm vào là tải/mở tab mới ngay
 * (yêu cầu Sếp 2026-08-19). Chỉ xem trước được ảnh và PDF (trình duyệt tự
 * render được, không cần thư viện ngoài) — các loại khác (Excel/Word/zip...)
 * không có cách xem trước an toàn trong trình duyệt nên hiện thông báo +
 * nút tải về, không cố giả vờ xem trước được.
 */
export default function FilePreviewModal({
  requestId,
  attachment,
  onClose,
}: {
  requestId: string;
  attachment: RequestAttachment;
  onClose: () => void;
}) {
  const fileUrl = `/api/requests/${requestId}/attachments?path=${encodeURIComponent(attachment.path)}`;
  const ext = fileExtension(attachment.name);
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const isPdf = ext === "pdf";

  return (
    <Modal
      title={attachment.name}
      width={isImage || isPdf ? 900 : 480}
      onClose={onClose}
      footer={
        <>
          <a
            href={fileUrl}
            download={attachment.name}
            className="flex items-center gap-1.5 rounded border border-[var(--color-border)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-text-primary)] hover:bg-gray-50 dark:hover:bg-white/5"
          >
            <Download size={14} /> Tải về
          </a>
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded border border-[var(--color-border)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-text-primary)] hover:bg-gray-50 dark:hover:bg-white/5"
          >
            <ExternalLink size={14} /> Mở tab mới
          </a>
        </>
      }
    >
      {isImage ? (
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- ảnh tới từ URL ký (signed URL) đổi mỗi lần mở, không hợp Next/Image tối ưu tĩnh */}
          <img src={fileUrl} alt={attachment.name} className="max-h-[70vh] max-w-full rounded object-contain" />
        </div>
      ) : isPdf ? (
        <iframe src={fileUrl} title={attachment.name} className="h-[70vh] w-full rounded border border-[var(--color-border)]" />
      ) : (
        <p className="py-10 text-center text-[13px] text-gray-400">
          Không xem trước được loại tệp này ({ext || "?"}). Bấm &quot;Tải về&quot; để xem trên máy.
        </p>
      )}
    </Modal>
  );
}
