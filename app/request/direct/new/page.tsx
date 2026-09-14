"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import Modal from "@/components/shared/Modal";
import TagUserInput from "@/components/shared/TagUserInput";
import {
  cancelButtonClass,
  confirmButtonClass,
  inputClass,
  textareaClass,
} from "@/components/shared/form-styles";
import type { RequestInstance, TaggedUser } from "@/lib/types";

export default function DirectRequestPage() {
  return (
    <Suspense fallback={null}>
      <DirectRequestForm />
    </Suspense>
  );
}

function DirectRequestForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [draftId, setDraftId] = useState<string | null>(searchParams.get("draftId"));
  const [loadedStatus, setLoadedStatus] = useState<RequestInstance["status"] | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [approvers, setApprovers] = useState<TaggedUser[]>([]);
  const [followers, setFollowers] = useState<TaggedUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [deletingDraft, setDeletingDraft] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  useEffect(() => {
    if (!draftId) return;
    fetch(`/api/requests/${draftId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { request: RequestInstance }) => {
        setTitle(data.request.groupNameSnapshot);
        setDescription((data.request.values.description as string) ?? "");
        setApprovers(data.request.approversSnapshot);
        setFollowers(data.request.followers);
        setLoadedStatus(data.request.status);
      })
      .catch(() => setError("Không tải được bản nháp."));
  }, [draftId]);

  const buildBody = (isDraft: boolean) => ({
    groupId: null,
    title,
    description,
    approvers,
    followers,
    isDraft,
  });

  /**
   * Xoá bản nháp "đề xuất trực tiếp" (groupId = null).
   *
   * Bản sao có chủ ý của `deleteDraft` ở trang soạn theo nhóm: 2 trang này là
   * 2 form hoàn toàn khác nhau (trang kia dựng field động theo nhóm, trang này
   * chỉ có tiêu đề + mô tả), chỉ trùng đúng đoạn xoá này. Nếu sau có thêm chỗ
   * thứ ba thì hãy tách thành hook dùng chung.
   */
  const deleteDraft = async () => {
    if (!draftId || deletingDraft) return;
    setConfirmDeleteOpen(false);
    setDeletingDraft(true);
    setError(null);
    try {
      // Đọc lại trạng thái thật trước khi xoá — chống trường hợp mở 2 tab, tab
      // kia đã bấm gửi (xem chú thích đầy đủ ở trang soạn theo nhóm).
      const check = await fetch(`/api/requests/${draftId}`);
      if (check.ok) {
        const fresh = (await check.json()) as { request: RequestInstance };
        if (fresh.request.status !== "draft") {
          setError(
            "Đề xuất này không còn là bản nháp (có thể đã được gửi ở cửa sổ khác) — tải lại trang để xem trạng thái mới.",
          );
          setDeletingDraft(false);
          return;
        }
      }
      const res = await fetch(`/api/requests/${draftId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể xoá bản nháp.");
      }
      router.replace("/request/list?scope=mine");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
      setDeletingDraft(false);
    }
  };

  const saveDraft = async () => {
    setSavingDraft(true);
    setError(null);
    try {
      if (draftId) {
        const res = await fetch(`/api/requests/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildBody(true)),
        });
        if (!res.ok) throw new Error("Không thể lưu nháp.");
      } else {
        const res = await fetch("/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildBody(true)),
        });
        if (!res.ok) throw new Error("Không thể lưu nháp.");
        const data = (await res.json()) as { request: RequestInstance };
        setDraftId(data.request.id);
      }
      setDraftSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    if (!title.trim()) {
      setError("Thiếu tên đề xuất.");
      return;
    }
    if (approvers.length === 0) {
      setError("Cần ít nhất một người xét duyệt.");
      return;
    }
    setSubmitting(true);
    try {
      const res = draftId
        ? await fetch(`/api/requests/${draftId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildBody(false)),
          })
        : await fetch("/api/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildBody(false)),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể gửi đề xuất.");
      }
      router.push("/request/list?scope=mine");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[640px] px-8 py-6">
      <h1 className="text-[20px] font-semibold text-gray-900">Đề xuất trực tiếp</h1>
      <p className="mt-1 text-[14px] text-gray-500">
        Không theo mẫu cố định — tự đặt tên, mô tả và chọn người xét duyệt.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-[14px] font-medium text-gray-700">
            Tên đề xuất <span className="text-[var(--color-danger-red)]">*</span>
          </label>
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div>
          <label className="mb-1 block text-[14px] font-medium text-gray-700">
            Mô tả đề xuất <span className="text-[var(--color-danger-red)]">*</span>
          </label>
          <textarea
            className={textareaClass}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-[14px] font-medium text-gray-700">
            Người xét duyệt <span className="text-[var(--color-danger-red)]">*</span>
          </label>
          <TagUserInput value={approvers} onChange={setApprovers} placeholder="Gõ @ để tìm người xét duyệt" />
        </div>

        <div>
          <label className="mb-1 block text-[14px] font-medium text-gray-700">Người theo dõi</label>
          <TagUserInput value={followers} onChange={setFollowers} />
        </div>
      </div>

      {error && <p className="mt-4 text-[14px] text-[var(--color-danger-red)]">{error}</p>}

      {loadedStatus === "pending" && (
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
          Đề xuất này đang chờ duyệt — sửa và gửi lại sẽ xoá mọi quyết định duyệt đã có, duyệt lại từ đầu.
        </p>
      )}
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || savingDraft}
          className={`${confirmButtonClass} flex-none px-6`}
        >
          {submitting ? "Đang gửi..." : loadedStatus === "pending" ? "Gửi lại đề xuất" : "Gửi đề xuất"}
        </button>
        {loadedStatus !== "pending" && (
          <button
            type="button"
            onClick={saveDraft}
            disabled={submitting || savingDraft}
            className={`${cancelButtonClass} flex-none px-6`}
          >
            {savingDraft ? "Đang lưu..." : "Lưu nháp"}
          </button>
        )}
        {draftSavedAt && (
          <span className="text-[12px] text-gray-400">
            Đã lưu nháp lúc {new Date(draftSavedAt).toLocaleTimeString("vi-VN")}
          </span>
        )}
        {/* Nút này CHỈ quay lại trang trước, KHÔNG đụng gì tới dữ liệu — xem
            chú thích cùng nội dung ở trang soạn theo nhóm. */}
        <button
          type="button"
          onClick={() => router.back()}
          className="text-[14px] text-gray-500 hover:underline"
        >
          {loadedStatus !== null ? "Quay lại" : "Hủy bỏ"}
        </button>
        {draftId && loadedStatus === "draft" && (
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={submitting || savingDraft || deletingDraft}
            className="ml-auto flex items-center gap-1.5 text-[14px] font-medium text-[var(--color-danger-red)] hover:underline disabled:opacity-60"
          >
            <Trash2 size={15} />
            {deletingDraft ? "Đang xoá..." : "Xoá bản nháp"}
          </button>
        )}
      </div>

      {confirmDeleteOpen && (
        <Modal
          title="Xoá bản nháp"
          width={440}
          onClose={() => setConfirmDeleteOpen(false)}
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                className={cancelButtonClass}
              >
                Giữ lại bản nháp
              </button>
              <button
                type="button"
                onClick={deleteDraft}
                disabled={deletingDraft}
                className="flex h-[38px] flex-1 items-center justify-center rounded bg-[var(--color-danger-red)] text-[14px] font-semibold text-white hover:brightness-95 disabled:opacity-60"
              >
                Xoá bản nháp
              </button>
            </>
          }
        >
          <p className="text-[14px] leading-relaxed text-gray-700">
            Bản nháp này sẽ được gỡ khỏi danh sách của bạn. Đề xuất{" "}
            <strong>chưa từng được gửi đi</strong> nên không ai nhận được thông báo gì.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
            Dữ liệu vẫn được giữ lại, Owner/Admin khôi phục được nếu bấm nhầm.
          </p>
        </Modal>
      )}
    </div>
  );
}
