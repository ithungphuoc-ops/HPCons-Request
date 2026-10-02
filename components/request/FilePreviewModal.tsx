"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Download, ExternalLink } from "lucide-react";
import Modal from "@/components/shared/Modal";
import type { RequestAttachment } from "@/lib/types";

// Trình xem Excel/Word chỉ tải khi mở đúng loại tệp đó — không làm nặng trang đề xuất.
const ExcelPreview = dynamic(() => import("@/components/request/office/ExcelPreview"), { ssr: false });
const WordPreview = dynamic(() => import("@/components/request/office/WordPreview"), { ssr: false });

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);
const EXCEL_EXTENSIONS = new Set(["xls", "xlsx", "xlsm", "csv"]);

type PreviewKind = "image" | "pdf" | "excel" | "word" | "old-word" | "none";

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function previewKind(ext: string): PreviewKind {
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (EXCEL_EXTENSIONS.has(ext)) return "excel";
  if (ext === "docx") return "word";
  if (ext === "doc") return "old-word";
  return "none";
}

/** Tải nội dung tệp (qua máy chủ — xem app/api/requests/[id]/attachments/content) cho trình
 * xem Excel/Word đọc. Lỗi trả về câu báo cho người dùng, không ném. */
function useAttachmentContent(url: string | null) {
  const [state, setState] = useState<{ data: ArrayBuffer | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setState({ data: null, error: null });
    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? 'Không mở được tệp. Bấm "Tải về" để xem trên máy.');
        }
        return res.arrayBuffer();
      })
      .then((data) => {
        if (!cancelled) setState({ data, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // fetch() mất mạng ném TypeError với câu tiếng Anh ("Failed to fetch") — không đưa ra
        // cho người dùng; câu báo từ máy chủ (vd tệp > 4MB) thì giữ nguyên.
        const message =
          err instanceof TypeError
            ? 'Không tải được tệp (kiểm tra kết nối mạng). Thử lại hoặc bấm "Tải về".'
            : err instanceof Error && err.message
              ? err.message
              : 'Không mở được tệp. Bấm "Tải về" để xem trên máy.';
        setState({ data: null, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

/**
 * Xem trước tệp đính kèm trong 1 popup thay vì bấm vào là tải/mở tab mới ngay
 * (yêu cầu Sếp 2026-08-19). Popup to gần kín màn hình; xem được ảnh, PDF (trình duyệt
 * tự hiện), Excel .xls/.xlsx (kèm ảnh chèn trong tệp) và Word .docx (Sếp chốt 02/10/2026).
 * Bản xem nhanh chỉ để ĐỌC: Excel không giữ màu/viền, không vẽ biểu đồ; Word đời cũ .doc,
 * bản vẽ .dwg… không xem được → thông báo + nút "Tải về" (tải đúng tệp gốc đầy đủ).
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
  const query = `path=${encodeURIComponent(attachment.path)}`;
  const fileUrl = `/api/requests/${requestId}/attachments?${query}`;
  const ext = fileExtension(attachment.name);
  const kind = previewKind(ext);
  const isOffice = kind === "excel" || kind === "word";
  const content = useAttachmentContent(isOffice ? `/api/requests/${requestId}/attachments/content?${query}` : null);
  const fill = kind !== "none" && kind !== "old-word";

  let body;
  if (kind === "image") {
    body = (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-[3px] bg-gray-100 dark:bg-white/5">
        {/* eslint-disable-next-line @next/next/no-img-element -- ảnh tới từ URL ký (signed URL) đổi mỗi lần mở, không hợp Next/Image tối ưu tĩnh */}
        <img src={fileUrl} alt={attachment.name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  } else if (kind === "pdf") {
    body = (
      <iframe
        src={fileUrl}
        title={attachment.name}
        className="min-h-0 w-full flex-1 rounded border border-[var(--color-border)]"
      />
    );
  } else if (isOffice) {
    body = content.error ? (
      <p className="m-auto px-6 text-center text-[14px] text-gray-400">{content.error}</p>
    ) : !content.data ? (
      <p className="m-auto text-[14px] text-gray-400">Đang tải tệp…</p>
    ) : kind === "excel" ? (
      <ExcelPreview data={content.data} ext={ext} />
    ) : (
      <WordPreview data={content.data} />
    );
  } else {
    body = (
      <p className="py-10 text-center text-[14px] text-gray-400">
        {kind === "old-word"
          ? "Word đời cũ (.doc – Word 97-2003) chưa xem trước được."
          : `Không xem trước được loại tệp này (${ext || "?"}).`}{" "}
        Bấm &quot;Tải về&quot; để xem trên máy.
      </p>
    );
  }

  return (
    <Modal
      title={attachment.name}
      size={fill ? "fill" : "default"}
      width={480}
      onClose={onClose}
      footer={
        <>
          <a
            href={fileUrl}
            download={attachment.name}
            className="flex items-center gap-1.5 rounded border border-[var(--color-border)] px-3 py-1.5 text-[14px] font-medium text-[var(--color-text-primary)] hover:bg-gray-50 dark:hover:bg-white/5"
          >
            <Download size={14} /> Tải về
          </a>
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded border border-[var(--color-border)] px-3 py-1.5 text-[14px] font-medium text-[var(--color-text-primary)] hover:bg-gray-50 dark:hover:bg-white/5"
          >
            <ExternalLink size={14} /> Mở tab mới
          </a>
        </>
      }
    >
      {body}
    </Modal>
  );
}
