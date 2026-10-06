"use client";

import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { MAX_DIRECT_UPLOAD_FILE_SIZE, MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL } from "@/lib/constants";
import { DECISION_ATTACHMENT_MAX_FILES } from "@/lib/decision-attachment";
import type { DecisionNoteMode } from "@/lib/decision-note";
import { uploadAttachments } from "@/lib/upload-client";
import type { RequestAttachment } from "@/lib/types";

/** Nhãn đuôi tệp ngắn trên chip ("PDF", "XLSX"…). */
export function fileExtLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1, dot + 5).toUpperCase() : "TỆP";
}

/**
 * Tải các tệp đã chọn lên R2 lúc bấm xác nhận — CÙNG cách luồng "Điều chỉnh
 * sau duyệt" (AdjustmentControl ở RequestDetailView): giữ `File` trong máy,
 * chỉ tải THẲNG lên R2 (link ký sẵn, lib/upload-client.ts) khi gửi quyết
 * định, rồi mới gọi route. Bấm Huỷ trước khi xác nhận → không tải gì.
 *
 * Nhớ tệp đã tải theo đúng đối tượng `File`: gửi quyết định lỗi (vd máy chủ
 * trả 409) rồi bấm lại thì KHÔNG tải lại tệp lần 2 (đỡ thêm tệp mồ côi).
 */
export function useDecisionAttachmentUploader() {
  const cache = useRef(new WeakMap<File, RequestAttachment>());
  return async (files: File[]): Promise<RequestAttachment[]> => {
    const pending = files.filter((f) => !cache.current.has(f));
    if (pending.length > 0) {
      const uploaded = await uploadAttachments(pending);
      pending.forEach((f, i) => {
        if (uploaded[i]) cache.current.set(f, uploaded[i]);
      });
    }
    return files.map((f) => {
      const att = cache.current.get(f);
      if (!att) throw new Error(`Không tải được tệp "${f.name}" lên.`);
      return att;
    });
  };
}

/**
 * Ô chọn tệp dùng chung cho các hộp xác nhận duyệt — hiện theo "Đính kèm tệp
 * khi duyệt" của nhóm (lib/decision-attachment.ts): "hidden" → không render,
 * "optional" → "(không bắt buộc)", "required" → dấu * đỏ. Chọn được nhiều
 * tệp; chặn để trống do hộp thoại cha làm (server kiểm lại).
 */
export default function DecisionAttachmentInput({
  mode,
  files,
  onChange,
  invalid,
  disabled,
}: {
  mode: DecisionNoteMode;
  files: File[];
  onChange: (files: File[]) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  if (mode === "hidden") return null;

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
    onChange(next);
  };

  return (
    <div data-testid="decision-attachment-input">
      <label className="mb-1 block text-[14px] font-medium text-gray-700">
        Tệp đính kèm{" "}
        {mode === "required" ? (
          <span className="text-[var(--color-danger-red)]">*</span>
        ) : (
          <span className="text-[12px] font-normal text-gray-400">(không bắt buộc)</span>
        )}
      </label>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) addFiles(Array.from(e.dataTransfer.files ?? []));
        }}
        className={`flex w-full items-center justify-center gap-1.5 rounded border-2 border-dashed px-3 py-2.5 text-[13.5px] text-gray-500 transition-colors hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)] disabled:opacity-50 ${
          invalid
            ? "border-[var(--color-danger-red)]"
            : dragging
              ? "border-[var(--color-action-blue)] bg-blue-50"
              : "border-[var(--color-border)]"
        }`}
      >
        <Paperclip size={14} className="shrink-0" />
        Bấm hoặc kéo thả để chọn tệp (chọn được nhiều tệp)
      </button>
      {files.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${f.size}-${i}`}
              data-testid="decision-attachment-chip"
              className="inline-flex max-w-full items-center gap-1.5 rounded border border-[var(--color-border)] bg-white px-2 py-1 text-[12.5px] text-gray-700"
            >
              <span className="shrink-0 rounded bg-[var(--color-action-blue)] px-1 text-[10px] font-bold text-white">
                {fileExtLabel(f.name)}
              </span>
              <span className="min-w-0 truncate">{f.name}</span>
              <span className="shrink-0 text-gray-400">({(f.size / 1024 / 1024).toFixed(1)}MB)</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setPickError(null);
                  onChange(files.filter((_, idx) => idx !== i));
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
      {pickError && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{pickError}</p>}
    </div>
  );
}
