"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { signInWithCustomToken } from "firebase/auth";
import { Check, Paperclip, Pencil, Send, Trash2, X } from "lucide-react";
import { getFirebaseAuth, getFirebaseFirestore } from "@/lib/firebase/client";
import FilePreviewModal from "@/components/request/FilePreviewModal";
import type { RequestAttachment, RequestComment, TaggedUser } from "@/lib/types";

/** Hạn sửa/xóa của tác giả — PHẢI khớp `AUTHOR_EDIT_WINDOW_MS` phía server
 * (app/api/requests/[id]/comments/[commentId]/route.ts). Đây chỉ để ẩn/hiện
 * nút cho gọn UI — server luôn tự kiểm tra lại, không tin giá trị này. */
const AUTHOR_EDIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // khớp /api/uploads

/** Tìm "@" đang gõ dở ngay trước con trỏ (không tính @ dính liền chữ trước đó). */
function findActiveMention(textUpToCursor: string): { start: number; query: string } | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(textUpToCursor);
  if (!match) return null;
  const query = match[1];
  const start = textUpToCursor.length - query.length - 1;
  return { start, query };
}

/** Nguồn thật của mentionIds là các token "@username" còn trong nội dung —
 * xóa chữ thì tự động không còn tính là mention nữa. */
function extractMentionIds(text: string, directory: TaggedUser[]): string[] {
  const tokens = new Set(
    text
      .split(/\s+/)
      .filter((t) => t.startsWith("@") && t.length > 1)
      .map((t) => t.slice(1).toLowerCase()),
  );
  if (tokens.size === 0) return [];
  const ids = new Set<string>();
  for (const u of directory) {
    if (tokens.has(u.username.toLowerCase())) ids.add(u.id);
  }
  return Array.from(ids);
}

function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `Còn ${mm}:${String(ss).padStart(2, "0")} để sửa/xóa`;
}

/**
 * Khung "Thảo luận" — @mention (người + nhóm/phòng ban), cập nhật real-time
 * qua Firestore Client SDK, đính kèm file, sửa/xóa của tác giả CHỈ trong 10
 * phút kể từ lúc đăng, sau đó CHỈ Owner mới xóa được (không sửa hộ). KHÔNG
 * còn "Trả lời" (bỏ 24/08/2026) — danh sách hiển thị phẳng. Xem design.md
 * của change add-comment-mentions-realtime.
 */
export default function CommentSection({
  requestId,
  initialComments,
  currentUid,
  isOwner,
}: {
  requestId: string;
  initialComments: RequestComment[];
  currentUid: string | null;
  /** `session.role === "owner"` — KHÔNG dùng "admin" gộp chung nữa (đổi
   * hướng 24/08/2026, xem design.md Decision #7). */
  isOwner: boolean;
}) {
  const [comments, setComments] = useState<RequestComment[]>(initialComments);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [composerAttachment, setComposerAttachment] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState<RequestAttachment | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const bootstrapped = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Đếm ngược hạn sửa/xóa — chỉ cần tick khi có bình luận nào còn trong hạn,
  // nhưng tick mỗi giây vô điều kiện đơn giản hơn, chi phí không đáng kể cho
  // vài chục bình luận/lần render.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Danh bạ @mention (người + nhóm/phòng ban) — tải 1 lần, dùng để gợi ý khi
  // gõ "@" ngay trong ô bình luận và để suy ra mentionIds từ nội dung lúc gửi.
  const [directory, setDirectory] = useState<TaggedUser[]>([]);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);

  useEffect(() => {
    fetch("/api/directory/mentionable")
      .then((res) => (res.ok ? res.json() : { directory: [] }))
      .then((data: { directory: TaggedUser[] }) => setDirectory(data.directory ?? []))
      .catch(() => setDirectory([]));
  }, []);

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const term = mentionQuery.trim().toLowerCase();
    const pool = term
      ? directory.filter(
          (u) => u.name.toLowerCase().includes(term) || u.username.toLowerCase().includes(term),
        )
      : directory;
    return pool.slice(0, 8);
  }, [mentionQuery, directory]);

  // Đồng bộ lại nếu component cha tải lại đề xuất (vd sau khi duyệt/chuyển tiếp).
  useEffect(() => {
    setComments(initialComments);
  }, [initialComments]);

  // Cầu nối real-time: mint custom token (server xác minh session SSO), đăng
  // nhập Firebase Auth ẩn, rồi mở onSnapshot trên document requests/{id}.
  // Lỗi ở bất kỳ bước nào chỉ tắt real-time — bình luận qua API vẫn hoạt
  // động bình thường (không real-time), không chặn nghiệp vụ chính.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const auth = getFirebaseAuth();
        if (!auth.currentUser) {
          const res = await fetch("/api/auth/firebase-token", { method: "POST" });
          if (!res.ok) return;
          const { token } = (await res.json()) as { token: string };
          await signInWithCustomToken(auth, token);
        }
        if (cancelled) return;

        const db = getFirebaseFirestore();
        unsubscribe = onSnapshot(doc(db, "requests", requestId), (snap) => {
          const data = snap.data() as { comments?: RequestComment[] } | undefined;
          if (data?.comments) setComments(data.comments);
        });
      } catch {
        // Real-time không khả dụng (thiếu config Firebase Client SDK, token
        // hết hạn...) — bỏ qua êm, khung bình luận vẫn dùng được qua API.
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [requestId]);

  const resetComposer = () => {
    setText("");
    setMentionStart(null);
    setMentionQuery(null);
    setComposerAttachment(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    const cursor = e.target.selectionStart ?? value.length;
    const active = findActiveMention(value.slice(0, cursor));
    setMentionStart(active?.start ?? null);
    setMentionQuery(active?.query ?? null);
    setHighlighted(0);
  };

  const insertMention = (user: TaggedUser) => {
    if (mentionStart === null) return;
    const cursor = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, mentionStart);
    const after = text.slice(cursor);
    const insertion = `@${user.username} `;
    const nextText = `${before}${insertion}${after}`;
    setText(nextText);
    setMentionStart(null);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = before.length + insertion.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pos, pos);
    });
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        insertMention(suggestions[highlighted]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionStart(null);
        setMentionQuery(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handlePickAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_SIZE) {
      setPostError(`Tệp "${file.name}" vượt quá 10MB.`);
      e.target.value = "";
      return;
    }
    setPostError(null);
    setComposerAttachment(file);
  };

  const submit = async () => {
    const value = text.trim();
    if (!value && !composerAttachment) return;
    setPosting(true);
    setPostError(null);
    try {
      let attachment: RequestAttachment | null = null;
      if (composerAttachment) {
        const formData = new FormData();
        formData.append("files", composerAttachment);
        const uploadRes = await fetch("/api/uploads", { method: "POST", body: formData });
        if (!uploadRes.ok) {
          const body = await uploadRes.json().catch(() => ({}) as { error?: string });
          throw new Error(body.error ?? "Không thể tải tệp đính kèm lên.");
        }
        const uploadData = (await uploadRes.json()) as { attachments: RequestAttachment[] };
        attachment = uploadData.attachments[0] ?? null;
      }

      const res = await fetch(`/api/requests/${requestId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: value,
          mentionIds: extractMentionIds(value, directory),
          attachment,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể gửi thảo luận.");
      }
      const data = (await res.json()) as { comments: RequestComment[] };
      setComments(data.comments);
      resetComposer();
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setPosting(false);
    }
  };

  const startEdit = (comment: RequestComment) => {
    setEditingId(comment.id);
    setEditText(comment.text);
  };

  const saveEdit = async (id: string) => {
    const value = editText.trim();
    if (!value) return;
    try {
      const res = await fetch(`/api/requests/${requestId}/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể sửa bình luận.");
      }
      const data = (await res.json()) as { comments: RequestComment[] };
      setComments(data.comments);
      setEditingId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    }
  };

  const removeComment = async (id: string) => {
    if (!window.confirm("Xóa bình luận này?")) return;
    try {
      const res = await fetch(`/api/requests/${requestId}/comments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể xóa bình luận.");
      }
      const data = (await res.json()) as { comments: RequestComment[] };
      setComments(data.comments);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    }
  };

  // "Trả lời" đã bỏ — danh sách phẳng, mới nhất lên đầu. Bình luận cũ (nếu
  // còn `parentId` từ trước khi bỏ tính năng) vẫn hiển thị bình thường, chỉ
  // không còn được nhóm/thụt lề theo cha nữa.
  const flatComments = comments.slice().reverse();

  const renderComment = (comment: RequestComment) => {
    const isAuthor = currentUid !== null && currentUid === comment.authorUid;
    const elapsed = now - new Date(comment.at).getTime();
    const withinWindow = elapsed <= AUTHOR_EDIT_WINDOW_MS;
    const showEditDelete = isAuthor && withinWindow;
    const showDeleteOnly = !showEditDelete && isOwner && !withinWindow;
    const editing = editingId === comment.id;

    return (
      <div key={comment.id} className="flex items-start gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-400 text-[11px] font-semibold text-white">
          {comment.avatarInitial}
        </span>
        <div className="min-w-0 flex-1 rounded bg-gray-50 px-3 py-2">
          {editing ? (
            <div className="flex items-start gap-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={2}
                className="min-w-0 flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-[13px] outline-none focus:border-[var(--color-action-blue)]"
              />
              <button
                type="button"
                onClick={() => saveEdit(comment.id)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--color-action-blue)] text-white hover:brightness-95"
              >
                <Check size={13} />
              </button>
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <>
              <p className="text-[13px] font-medium text-gray-800">{comment.authorName}</p>
              <p className="whitespace-pre-wrap text-[13px] text-gray-700">{comment.text}</p>
              {comment.attachment && (
                <button
                  type="button"
                  onClick={() => setPreviewing(comment.attachment ?? null)}
                  className="mt-1.5 flex items-center gap-1.5 rounded bg-white px-2 py-1 text-[12px] text-[var(--color-action-blue)] ring-1 ring-inset ring-[var(--color-border)] hover:bg-blue-50"
                >
                  <Paperclip size={12} className="shrink-0" />
                  <span className="truncate">{comment.attachment.name}</span>
                  <span className="shrink-0 text-gray-400">
                    ({(comment.attachment.size / 1024 / 1024).toFixed(1)}MB)
                  </span>
                </button>
              )}
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-400">
                <span>{new Date(comment.at).toLocaleString("vi-VN")}</span>
                {comment.editedAt && <span>(đã sửa)</span>}
                {showEditDelete && (
                  <span className="text-orange-500">
                    {formatCountdown(AUTHOR_EDIT_WINDOW_MS - elapsed)}
                  </span>
                )}
                {showEditDelete && (
                  <button
                    type="button"
                    onClick={() => startEdit(comment)}
                    className="flex items-center gap-0.5 text-gray-400 hover:text-[var(--color-action-blue)]"
                  >
                    <Pencil size={11} /> Sửa
                  </button>
                )}
                {(showEditDelete || showDeleteOnly) && (
                  <button
                    type="button"
                    onClick={() => removeComment(comment.id)}
                    className="flex items-center gap-0.5 text-gray-400 hover:text-[var(--color-danger-red)]"
                  >
                    <Trash2 size={11} /> Xóa
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      {composerAttachment && (
        <div className="mb-2 flex items-center gap-2 rounded bg-gray-50 px-3 py-1.5 text-[12px] text-gray-600 ring-1 ring-inset ring-[var(--color-border)]">
          <Paperclip size={12} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{composerAttachment.name}</span>
          <span className="shrink-0 text-gray-400">
            ({(composerAttachment.size / 1024 / 1024).toFixed(1)}MB)
          </span>
          <button
            type="button"
            onClick={() => {
              setComposerAttachment(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="shrink-0 text-gray-400 hover:text-[var(--color-danger-red)]"
            aria-label="Bỏ đính kèm"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div className="relative flex items-start gap-2">
        <input ref={fileInputRef} type="file" className="hidden" onChange={handlePickAttachment} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Đính kèm file"
          aria-label="Đính kèm file"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-[var(--color-border)] text-gray-500 hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)]"
        >
          <Paperclip size={15} />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleTextareaKeyDown}
          onBlur={() => {
            // Trễ 1 nhịp để kịp xử lý click chọn gợi ý trước khi đóng dropdown.
            setTimeout(() => setMentionQuery(null), 150);
          }}
          rows={2}
          placeholder="Viết thảo luận của bạn — gõ @ để tag người hoặc nhóm/phòng ban"
          className="min-w-0 flex-1 rounded border border-[var(--color-border)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-action-blue)]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={posting || (!text.trim() && !composerAttachment)}
          aria-label="Gửi thảo luận"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[var(--color-action-blue)] text-white hover:brightness-95 disabled:opacity-50"
        >
          <Send size={15} />
        </button>

        {mentionQuery !== null && suggestions.length > 0 && (
          <div className="absolute left-0 top-full z-10 mt-1 max-h-[180px] w-[calc(100%-44px)] overflow-y-auto rounded border border-[var(--color-border)] bg-white shadow-lg">
            {suggestions.map((u, i) => (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertMention(u)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-gray-50 ${
                  i === highlighted ? "bg-gray-50" : ""
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${
                    u.kind === "group" ? "bg-teal-500" : "bg-[var(--color-action-blue)]"
                  }`}
                >
                  {u.avatarInitial}
                </span>
                <span>
                  {u.name} <span className="text-gray-400">@{u.username}</span>
                  {u.kind === "group" && (
                    <span className="ml-1 text-[10px] text-teal-600">(nhóm/phòng ban)</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {postError && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{postError}</p>}

      <div className="mt-4 flex flex-col gap-3">
        {flatComments.length === 0 && <p className="text-[13px] text-gray-400">Chưa có thảo luận nào.</p>}
        {flatComments.map((comment) => renderComment(comment))}
      </div>

      {previewing && (
        <FilePreviewModal requestId={requestId} attachment={previewing} onClose={() => setPreviewing(null)} />
      )}
    </div>
  );
}
