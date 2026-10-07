"use client";

import { useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { MAX_DIRECT_UPLOAD_FILE_SIZE, MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL } from "@/lib/constants";
import { DECISION_ATTACHMENT_MAX_FILES } from "@/lib/decision-attachment";
import type { DecisionNoteMode } from "@/lib/decision-note";

/** Chiều cao tối đa ô nội dung khi tự giãn — quá thì cuộn trong ô. */
const MAX_TEXTAREA_HEIGHT = 240;

const reqMark = <span className="text-[var(--color-danger-red)]">*</span>;
function optMark(text = "(không bắt buộc)") {
  return <span className="text-[12px] font-normal text-gray-400">{text}</span>;
}

/**
 * Tiêu đề gộp 1 dòng cho ô nội dung + tệp — Sếp duyệt demo
 * dieu-chinh-o-gon-kieu-thao-luan-2026-10-07. Chỉ đổi CÁCH HIỆN, không đổi
 * luật: `atLeastOne` = luồng có luật "ít nhất 1 trong 2" (Điều chỉnh sau
 * duyệt, lib/adjustment-settings.ts checkAdjustmentContent) — khi đó ô còn
 * lại duy nhất thực chất là bắt buộc nên hiện dấu *.
 */
export function noteAttachmentLabel({
  noteMode,
  fileMode,
  noteLabel,
  noteShortLabel = noteLabel,
  atLeastOne = false,
}: {
  noteMode: DecisionNoteMode;
  fileMode: DecisionNoteMode;
  noteLabel: string;
  noteShortLabel?: string;
  atLeastOne?: boolean;
}): ReactNode {
  const mark = (m: DecisionNoteMode) => (m === "required" ? reqMark : optMark());
  const showNote = noteMode !== "hidden";
  const showFile = fileMode !== "hidden";
  if (showNote && showFile) {
    if (atLeastOne && noteMode === "optional" && fileMode === "optional") {
      return (
        <>
          {noteShortLabel} hoặc tệp {optMark("(ít nhất 1 trong 2)")}
        </>
      );
    }
    // Cả 2 không bắt buộc (không có luật ít nhất 1) → gộp 1 chú thích cho gọn trên điện thoại.
    if (noteMode === "optional" && fileMode === "optional") {
      return (
        <>
          {noteShortLabel} · Tệp {optMark("(đều không bắt buộc)")}
        </>
      );
    }
    return (
      <>
        {noteShortLabel} {mark(noteMode)} · Tệp {mark(fileMode)}
      </>
    );
  }
  if (showNote) {
    return (
      <>
        {noteLabel} {atLeastOne ? reqMark : mark(noteMode)}
      </>
    );
  }
  if (showFile) {
    return <>Tệp đính kèm {atLeastOne ? reqMark : mark(fileMode)}</>;
  }
  return null;
}

/** Gợi ý ghim/kéo thả chỉ thêm vào placeholder khi ô tệp đang bật. */
export function noteAttachmentPlaceholder(base: string, fileAllowed: boolean): string {
  if (!fileAllowed) return base;
  const trimmed = base.replace(/(\.\.\.|…)\s*$/, "").trim();
  return trimmed
    ? `${trimmed} (bấm biểu tượng ghim hoặc kéo thả để đính kèm tệp)`
    : "Bấm biểu tượng ghim hoặc kéo thả để đính kèm tệp";
}

/**
 * Ô "nội dung + đính kèm tệp" gọn kiểu ô Thảo luận (CommentSection): nút ghim
 * vuông 36px bên TRÁI ô nội dung, tệp đã chọn là thẻ nhỏ phía TRÊN, kéo thả
 * tệp vào ô vẫn được. Dùng chung cho Điều chỉnh sau duyệt + hộp Chấp thuận /
 * Từ chối / Trả lại / Chuyển tiếp (Sếp chốt làm đồng bộ, 07/10/2026).
 *
 * Giới hạn tệp (số tệp, dung lượng) giữ y như ô kéo thả cũ; chặn để trống do
 * hộp thoại cha làm (server kiểm lại). "hidden" của ô nào → ô đó không hiện;
 * tắt ô nội dung mà còn tệp → chỉ còn nút "Đính kèm tệp" nhỏ + thẻ tệp.
 */
export default function NoteWithAttachments({
  noteMode,
  fileMode,
  noteLabel,
  noteShortLabel,
  atLeastOne,
  note,
  onNoteChange,
  noteInvalid,
  files,
  onFilesChange,
  filesInvalid,
  disabled,
  rows = 3,
  autoFocus,
  placeholder = "Nhập ý kiến...",
  maxLength,
  textareaId,
}: {
  noteMode: DecisionNoteMode;
  fileMode: DecisionNoteMode;
  /** Nhãn ô nội dung khi đứng 1 mình ("Ý kiến phê duyệt", "Lý do"…). */
  noteLabel: string;
  /** Nhãn ngắn trong tiêu đề gộp (mặc định = noteLabel). */
  noteShortLabel?: string;
  atLeastOne?: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  noteInvalid?: boolean;
  files: File[];
  onFilesChange: (files: File[]) => void;
  filesInvalid?: boolean;
  disabled?: boolean;
  rows?: number;
  autoFocus?: boolean;
  placeholder?: string;
  maxLength?: number;
  textareaId?: string;
}) {
  const autoId = useId();
  const taId = textareaId ?? `note-${autoId}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const showNote = noteMode !== "hidden";
  const showFile = fileMode !== "hidden";

  // Tự giãn ô nội dung khi gõ dài (như demo) — jsdom không có scrollHeight
  // thật (=0) nên bỏ qua để khỏi ép cao 2px.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (ta.scrollHeight > 0) ta.style.height = `${Math.min(ta.scrollHeight + 2, MAX_TEXTAREA_HEIGHT)}px`;
  }, [note]);

  if (!showNote && !showFile) return null;

  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const tooBig = incoming.find((f) => f.size > MAX_DIRECT_UPLOAD_FILE_SIZE);
    if (tooBig) {
      setPickError(`Tệp "${tooBig.name}" vượt quá ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}.`);
      return;
    }
    const next = [...files, ...incoming];
    if (next.length > DECISION_ATTACHMENT_MAX_FILES) {
      setPickError(`Chỉ được đính kèm tối đa ${DECISION_ATTACHMENT_MAX_FILES} tệp mỗi lần.`);
      return;
    }
    setPickError(null);
    onFilesChange(next);
  };

  // Kéo thả: chỉ nhận khi ô tệp bật — tắt tệp thì để trình duyệt xử lý như thường.
  // Chỉ chặn khi kéo TỆP (kéo chữ vào ô vẫn chạy như textarea thường). Đang
  // gửi (disabled) vẫn phải preventDefault — bỏ qua thì trình duyệt tự mở tệp
  // vừa thả và rời khỏi trang giữa lúc đang tải lên (review PR #91).
  const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const dropProps = showFile
    ? {
        onDragOver: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          if (!disabled) setDragging(true);
        },
        // Di chuột giữa nút ghim và ô nội dung (con bên trong) không tính là rời khung.
        onDragLeave: (e: DragEvent) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          if (!isFileDrag(e)) return;
          e.preventDefault();
          setDragging(false);
          if (!disabled) addFiles(Array.from(e.dataTransfer.files ?? []));
        },
      }
    : {};

  const fileMissing = !!filesInvalid && files.length === 0;
  const openPicker = () => inputRef.current?.click();

  return (
    <div data-testid="note-with-attachments">
      <label
        className="mb-1 block text-[14px] font-medium text-gray-700"
        htmlFor={showNote ? taId : undefined}
        data-testid="note-with-attachments-label"
      >
        {noteAttachmentLabel({ noteMode, fileMode, noteLabel, noteShortLabel, atLeastOne })}
      </label>

      {showFile && (
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          data-testid="decision-attachment-input"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      )}

      {showFile && files.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${f.size}-${i}`}
              data-testid="decision-attachment-chip"
              className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded border border-[var(--color-border)] bg-gray-50 px-2 py-1 text-[12.5px] text-gray-700"
            >
              <FileText size={13} className="shrink-0 text-gray-500" />
              <span className="min-w-0 truncate" title={f.name}>
                {f.name}
              </span>
              <span className="shrink-0 text-gray-400">({(f.size / 1024 / 1024).toFixed(1)}MB)</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setPickError(null);
                  onFilesChange(files.filter((_, idx) => idx !== i));
                }}
                aria-label={`Bỏ tệp ${f.name}`}
                className="shrink-0 text-gray-400 hover:text-[var(--color-danger-red)]"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {showNote ? (
        <div className="flex items-start gap-2" {...dropProps}>
          {showFile && (
            <button
              type="button"
              disabled={disabled}
              onClick={openPicker}
              title="Đính kèm tệp"
              aria-label={files.length ? `Đính kèm tệp (đã chọn ${files.length})` : "Đính kèm tệp"}
              data-testid="decision-attachment-pick"
              className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded border hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)] disabled:opacity-50 ${
                fileMissing
                  ? "border-[var(--color-danger-red)] text-[var(--color-danger-red)]"
                  : "border-[var(--color-border)] text-gray-500"
              }`}
            >
              <Paperclip size={15} />
              {files.length > 0 && (
                <span
                  data-testid="decision-attachment-count"
                  className="absolute -right-1.5 -top-1.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[var(--color-action-blue)] px-1 text-[10.5px] font-bold leading-none text-white"
                >
                  {files.length}
                </span>
              )}
            </button>
          )}
          <textarea
            id={taId}
            ref={textareaRef}
            rows={rows}
            autoFocus={autoFocus}
            value={note}
            maxLength={maxLength}
            disabled={disabled}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={noteAttachmentPlaceholder(placeholder, showFile)}
            aria-invalid={noteInvalid || undefined}
            className={`min-w-0 flex-1 resize-y rounded border px-3 py-2 text-[14px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-action-blue)] ${
              noteInvalid
                ? "border-[var(--color-danger-red)]"
                : dragging
                  ? "border-[var(--color-action-blue)] bg-blue-50"
                  : "border-[var(--color-border)]"
            }`}
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={openPicker}
          aria-label={files.length ? `Đính kèm tệp (đã chọn ${files.length})` : "Đính kèm tệp"}
          data-testid="decision-attachment-pick"
          {...dropProps}
          className={`inline-flex h-8 items-center gap-1.5 rounded border px-2.5 text-[13px] hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)] disabled:opacity-50 ${
            fileMissing
              ? "border-[var(--color-danger-red)] text-[var(--color-danger-red)]"
              : dragging
                ? "border-[var(--color-action-blue)] bg-blue-50 text-[var(--color-action-blue)]"
                : "border-[var(--color-border)] text-gray-600"
          }`}
        >
          <Paperclip size={14} className="shrink-0" />
          Đính kèm tệp{files.length > 0 ? ` (${files.length})` : ""}
        </button>
      )}

      {pickError && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{pickError}</p>}
    </div>
  );
}
