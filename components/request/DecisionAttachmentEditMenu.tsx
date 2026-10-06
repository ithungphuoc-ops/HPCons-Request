"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MoreHorizontal, RefreshCw, Trash2 } from "lucide-react";
import { useRequestContext } from "@/context/RequestContext";
import { MAX_DIRECT_UPLOAD_FILE_SIZE, MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL } from "@/lib/constants";
import { canEditDecisionAttachment } from "@/lib/decision-attachment-edit";
import { uploadAttachments } from "@/lib/upload-client";
import type { RequestAttachment, RequestHistoryEntry, RequestStatus } from "@/lib/types";

/**
 * "Sửa tệp đính kèm khi duyệt" (Sếp duyệt demo 06/10/2026) — trạng thái dùng
 * chung cho 3 chỗ hiện tệp quyết định (Thảo luận, popup ý kiến, khối Tài liệu
 * đính kèm). Thay/gỡ xong → `onUpdated` nhận `attachments` + `history` mới
 * từ máy chủ, RequestDetailView cập nhật state → cả 3 chỗ đổi cùng lúc.
 */
export interface DecisionAttachmentEditor {
  canEdit: (file: RequestAttachment) => boolean;
  /** Owner/Admin: còn mở được tệp đã gỡ/đã thay để đối chiếu. */
  canOpenRemoved: boolean;
  busyPath: string | null;
  error: { path: string; message: string } | null;
  replace: (file: RequestAttachment, next: File) => Promise<void>;
  remove: (file: RequestAttachment) => Promise<void>;
}

export function useDecisionAttachmentEditor(params: {
  requestId: string;
  status: RequestStatus;
  currentUid: string | null;
  isAdmin: boolean;
  onUpdated: (data: { attachments: RequestAttachment[]; history: RequestHistoryEntry[] }) => void;
}): DecisionAttachmentEditor {
  const { requestId, status, currentUid, isAdmin, onUpdated } = params;
  const { askConfirm } = useRequestContext();
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<{ path: string; message: string } | null>(null);

  const canEdit = useCallback(
    (file: RequestAttachment) =>
      currentUid !== null && !!file.path && canEditDecisionAttachment({ status, att: file, uid: currentUid, isAdmin }),
    [currentUid, isAdmin, status],
  );

  const send = useCallback(
    async (file: RequestAttachment, body: unknown) => {
      const res = await fetch(`/api/requests/${requestId}/attachments/decision`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        attachments?: RequestAttachment[];
        history?: RequestHistoryEntry[];
      };
      if (!res.ok || !data.attachments || !data.history) {
        throw new Error(data.error ?? `Không sửa được tệp "${file.name}".`);
      }
      onUpdated({ attachments: data.attachments, history: data.history });
    },
    [onUpdated, requestId],
  );

  const replace = useCallback(
    async (file: RequestAttachment, next: File) => {
      if (next.size > MAX_DIRECT_UPLOAD_FILE_SIZE) {
        setError({ path: file.path, message: `Tệp "${next.name}" vượt quá ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}.` });
        return;
      }
      setBusyPath(file.path);
      setError(null);
      try {
        // Tải thẳng lên R2 bằng link ký sẵn (như DecisionAttachmentInput), rồi
        // mới gọi máy chủ thay — máy chủ đo lại kích thước thật.
        const [uploaded] = await uploadAttachments([next]);
        if (!uploaded) throw new Error(`Không tải được tệp "${next.name}" lên.`);
        await send(file, { action: "replace", path: file.path, file: uploaded });
      } catch (err) {
        setError({ path: file.path, message: err instanceof Error ? err.message : "Có lỗi xảy ra." });
      } finally {
        setBusyPath(null);
      }
    },
    [send],
  );

  const remove = useCallback(
    async (file: RequestAttachment) => {
      const ok = await askConfirm(
        `Gỡ tệp "${file.name}"? Tệp sẽ ẩn khỏi đề xuất, lịch sử vẫn ghi lại ai gỡ và lúc nào.`,
        { danger: true },
      );
      if (!ok) return;
      setBusyPath(file.path);
      setError(null);
      try {
        await send(file, { action: "remove", path: file.path });
      } catch (err) {
        setError({ path: file.path, message: err instanceof Error ? err.message : "Có lỗi xảy ra." });
      } finally {
        setBusyPath(null);
      }
    },
    [askConfirm, send],
  );

  return { canEdit, canOpenRemoved: isAdmin, busyPath, error, replace, remove };
}

const MENU_WIDTH = 200;

/**
 * Nút ⋯ cạnh tệp — chỉ render khi người xem có quyền và đề xuất chưa kết
 * thúc (`editor.canEdit`). Menu đặt `position: fixed` theo vị trí nút, ép nằm
 * trong khung nhìn (không tràn màn hình điện thoại), bám theo nút khi cuộn,
 * đóng khi bấm ra ngoài hoặc Esc.
 */
export function DecisionAttachmentEditMenu({
  file,
  editor,
}: {
  file: RequestAttachment;
  editor: DecisionAttachmentEditor | undefined;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const open = pos !== null;

  const place = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, vw - MENU_WIDTH - 8));
    const menuH = menuRef.current?.offsetHeight ?? 84;
    const below = rect.bottom + 4;
    const top = below + menuH > vh - 8 ? Math.max(8, rect.top - menuH - 4) : below;
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
    // Đặt lại 1 lần sau khi đo được chiều cao thật của menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // Bắt ở pha capture: Modal chặn nổi bọt mousedown, nghe ở pha bubble sẽ
    // không đóng được menu khi đang trong popup ý kiến.
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, true);
    // Cuộn (kể cả quán tính trên điện thoại) → bám theo nút, không đóng.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  if (!editor || !editor.canEdit(file)) return null;
  const busy = editor.busyPath === file.path;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={busy}
        aria-label={`Sửa tệp ${file.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={busy ? "Đang xử lý…" : "Thay / gỡ tệp"}
        data-testid="decision-attachment-menu-button"
        onClick={(e) => {
          e.stopPropagation();
          if (open) setPos(null);
          else setPos({ top: -9999, left: -9999 });
        }}
        className="inline-flex shrink-0 items-center justify-center rounded px-1 py-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-50"
      >
        {busy ? <RefreshCw size={13} className="animate-spin" /> : <MoreHorizontal size={15} />}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        data-testid="decision-attachment-replace-input"
        onChange={(e) => {
          const next = e.target.files?.[0];
          e.target.value = "";
          if (next) void editor.replace(file, next);
        }}
      />
      {open && (
        <div
          ref={menuRef}
          role="menu"
          data-testid="decision-attachment-menu"
          style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="z-[90] rounded-md border border-[var(--color-border)] bg-white p-1 shadow-lg"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setPos(null);
              inputRef.current?.click();
            }}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[13.5px] text-gray-800 hover:bg-gray-100"
          >
            <RefreshCw size={14} className="shrink-0 text-gray-500" /> Thay bằng tệp khác
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setPos(null);
              void editor.remove(file);
            }}
            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[13.5px] text-[var(--color-danger-red)] hover:bg-red-50"
          >
            <Trash2 size={14} className="shrink-0" /> Gỡ tệp
          </button>
        </div>
      )}
    </>
  );
}

/** Lỗi thay/gỡ của đúng tệp này (hiện ngay dưới tệp). */
export function DecisionAttachmentEditError({
  file,
  editor,
}: {
  file: RequestAttachment;
  editor: DecisionAttachmentEditor | undefined;
}) {
  if (!editor?.error || editor.error.path !== file.path) return null;
  return (
    <p className="mt-0.5 text-[12px] text-[var(--color-danger-red)]" role="alert">
      {editor.error.message}
    </p>
  );
}
