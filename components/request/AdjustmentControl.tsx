"use client";

import { useState } from "react";
import { AlertTriangle, Pencil, Plus } from "lucide-react";
import TagUserInput from "@/components/shared/TagUserInput";
import DecisionAttachmentInput, { useDecisionAttachmentUploader } from "@/components/request/DecisionAttachmentInput";
import {
  ADJUSTMENT_APPROVER_COUNT,
  adjustmentFieldMode,
  checkAdjustmentContent,
  type AdjustmentFieldRules,
} from "@/lib/adjustment-settings";
import { ADJUSTMENT_MAX_LENGTH } from "@/lib/request-history-labels";
import type { TaggedUser } from "@/lib/types";

interface AdjustmentContext {
  guide: string;
  fieldRules: AdjustmentFieldRules;
  approverCount: number;
  suggestions: { key: string; label: string; user: { id: string; name: string } }[];
}

function toTagged(u: { id: string; name: string }): TaggedUser {
  return { id: u.id, name: u.name, username: u.id, avatarInitial: u.name.trim().charAt(0).toUpperCase() || "?" };
}

/**
 * Hộp "Điều chỉnh đề nghị sau duyệt" — Sếp duyệt demo
 * dieu-chinh-tu-chon-nguoi-duyet-2026-10-06 (06/10/2026):
 * - Cảnh báo vàng = "Hướng dẫn điều chỉnh sau duyệt" (chung toàn app).
 * - Ô Ghi chú / Đính kèm tệp (nhiều tệp) theo cài đặt của nhóm.
 * - BẮT BUỘC chọn ĐÚNG 2 người duyệt (gõ @ tìm toàn công ty) + 2 nút gợi ý
 *   nhanh: Người duyệt cuối, Trưởng phòng Thu mua.
 * Gửi xong → điều chỉnh CHỜ DUYỆT (chưa có hiệu lực). Máy chủ kiểm lại mọi
 * điều kiện (route app/api/requests/[id]/adjustment).
 *
 * 🔴 KHÔNG sửa `values` — nội dung đi vào `history` khi đủ người duyệt.
 * Thu gọn thành 1 nút cho tới khi bấm — chỉ lúc mở mới tải hướng dẫn/gợi ý
 * (đỡ lượt đọc Firestore cho mọi lần xem đề xuất đã duyệt).
 */
export default function AdjustmentControl({
  requestId,
  currentUid,
  onDone,
}: {
  requestId: string;
  currentUid: string | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<AdjustmentContext | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);
  const [noiDung, setNoiDung] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [approvers, setApprovers] = useState<TaggedUser[]>([]);
  const [dangGui, setDangGui] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const uploadFiles = useDecisionAttachmentUploader();

  const count = ctx?.approverCount ?? ADJUSTMENT_APPROVER_COUNT;

  const openBox = async () => {
    setOpen(true);
    setLoi(null);
    if (ctx) return;
    setLoadingCtx(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/adjustment`);
      const body = (await res.json().catch(() => ({}))) as Partial<AdjustmentContext> & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Không tải được hộp điều chỉnh.");
      setCtx(body as AdjustmentContext);
    } catch (err) {
      setLoi(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setLoadingCtx(false);
    }
  };

  const reset = () => {
    setOpen(false);
    setNoiDung("");
    setFiles([]);
    setApprovers([]);
    setLoi(null);
  };

  const pickApprovers = (next: TaggedUser[]) => {
    setLoi(null);
    if (next.some((u) => u.id === currentUid)) {
      setLoi("Không tự chọn chính mình làm người duyệt điều chỉnh.");
      return;
    }
    if (next.length > count) {
      setLoi(`Chỉ chọn đúng ${count} người duyệt điều chỉnh.`);
      return;
    }
    setApprovers(next);
  };

  const gui = async () => {
    if (!ctx) return;
    const content = checkAdjustmentContent(ctx.fieldRules, { noiDung, fileCount: files.length });
    if (!content.ok) {
      setLoi(content.error);
      return;
    }
    if (approvers.length !== count) {
      setLoi(`Chọn đúng ${count} người duyệt điều chỉnh (đang chọn ${approvers.length}).`);
      return;
    }
    setDangGui(true);
    setLoi(null);
    try {
      // Tệp lên R2 TRƯỚC (link ký sẵn), rồi mới gọi route — gửi lỗi bấm lại
      // thì không tải lại tệp (useDecisionAttachmentUploader nhớ theo File).
      const attachments = content.keepFiles && files.length > 0 ? await uploadFiles(files) : [];
      const res = await fetch(`/api/requests/${requestId}/adjustment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noiDung: content.noiDung,
          approverIds: approvers.map((a) => a.id),
          attachments,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setLoi(body.error ?? "Không gửi được điều chỉnh.");
        return;
      }
      reset();
      onDone();
    } catch (err) {
      setLoi(err instanceof Error ? err.message : "Có lỗi xảy ra, vui lòng thử lại.");
    } finally {
      setDangGui(false);
    }
  };

  if (!open) {
    return (
      <div className="print-hide">
        <button
          type="button"
          onClick={openBox}
          data-testid="adjustment-open"
          className="flex items-center gap-1.5 rounded border border-[var(--color-action-blue)] px-3 py-1.5 text-[14px] font-medium text-[var(--color-action-blue)] hover:bg-blue-50"
        >
          <Pencil size={14} /> Điều chỉnh đề nghị
        </button>
      </div>
    );
  }

  const noteMode = ctx ? adjustmentFieldMode(ctx.fieldRules.note) : "hidden";
  const fileMode = ctx ? adjustmentFieldMode(ctx.fieldRules.attachment) : "hidden";
  const selectedIds = new Set(approvers.map((a) => a.id));

  return (
    <div className="print-hide rounded border border-[var(--color-border)] bg-white p-3" data-testid="adjustment-box">
      {loadingCtx && <p className="text-[13px] text-gray-400">Đang tải...</p>}

      {ctx && (
        <div className="flex flex-col gap-3">
          {ctx.guide.trim() && (
            <div
              className="flex gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[13.5px] text-amber-800"
              data-testid="adjustment-guide"
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">Hướng dẫn điều chỉnh sau duyệt</p>
                <p className="whitespace-pre-line break-words">{ctx.guide.trim()}</p>
              </div>
            </div>
          )}

          {noteMode !== "hidden" && (
            <div>
              <label className="mb-1 block text-[14px] font-medium text-gray-700" htmlFor={`adj-note-${requestId}`}>
                Nội dung điều chỉnh{" "}
                {noteMode === "required" ? (
                  <span className="text-[var(--color-danger-red)]">*</span>
                ) : (
                  <span className="text-[12px] font-normal text-gray-400">(không bắt buộc nếu có tệp)</span>
                )}
              </label>
              <textarea
                id={`adj-note-${requestId}`}
                value={noiDung}
                maxLength={ADJUSTMENT_MAX_LENGTH}
                onChange={(e) => setNoiDung(e.target.value)}
                rows={3}
                disabled={dangGui}
                placeholder="Mô tả điều chỉnh — ví dụ: Thép hộp 40x80 đổi từ 120 cây xuống 90 cây"
                className="w-full rounded border border-[var(--color-border)] px-3 py-2 text-[14px] text-gray-800 outline-none focus:border-[var(--color-action-blue)]"
              />
            </div>
          )}

          <DecisionAttachmentInput mode={fileMode} files={files} onChange={setFiles} disabled={dangGui} />

          <div>
            <p className="mb-1 text-[14px] font-medium text-gray-700">
              Người duyệt điều chỉnh <span className="text-[var(--color-danger-red)]">*</span>{" "}
              <span className="text-[12px] font-normal text-gray-400">
                (chọn đúng {count} người — cả {count} cùng duyệt mới có hiệu lực)
              </span>
            </p>
            <TagUserInput
              value={approvers}
              onChange={pickApprovers}
              placeholder="Gõ @ để tìm người duyệt"
              excludeIds={currentUid ? [currentUid] : []}
            />
            {ctx.suggestions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="adjustment-suggestions">
                <span className="text-[12px] text-gray-500">Gợi ý nhanh:</span>
                {ctx.suggestions.map((s) => {
                  const picked = selectedIds.has(s.user.id);
                  const full = approvers.length >= count;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      disabled={picked || full || dangGui}
                      onClick={() => pickApprovers([...approvers, toTagged(s.user)])}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--color-border)] px-2.5 py-0.5 text-[12.5px] text-gray-700 hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus size={11} />
                      {s.label}: {s.user.name}
                      {picked ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {loi && (
        <p className="mt-2 text-[12.5px] text-[var(--color-danger-red)]" role="alert" data-testid="adjustment-error">
          {loi}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          disabled={dangGui}
          className="rounded border border-[var(--color-border)] px-4 py-1.5 text-[14px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Huỷ
        </button>
        <button
          type="button"
          onClick={gui}
          disabled={dangGui || !ctx}
          data-testid="adjustment-submit"
          className="rounded bg-[var(--color-action-blue)] px-4 py-1.5 text-[14px] font-medium text-white hover:brightness-95 disabled:opacity-50"
        >
          {dangGui ? "Đang gửi..." : "Gửi duyệt điều chỉnh"}
        </button>
      </div>
    </div>
  );
}
