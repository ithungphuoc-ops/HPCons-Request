"use client";

import { useEffect, useRef, useState } from "react";
import HighlightMatch, { normalizeSearch } from "@/components/shared/HighlightMatch";
import { X } from "lucide-react";
import type { TaggedUser } from "@/lib/types";


interface TagUserInputProps {
  value: TaggedUser[];
  onChange: (users: TaggedUser[]) => void;
  placeholder?: string;
  /** Nguồn danh bạ — mặc định `/api/directory` (chỉ người, dùng cho usedFor/
   * approverSteps/followers). Truyền `/api/directory/mentionable` để gồm cả
   * nhóm thành viên/phòng ban (mention bình luận). */
  directoryUrl?: string;
  /** Nếu truyền, hiện 1 link text dưới ô nhập (vd "Chọn quản lý trực tiếp");
   * bấm vào mở dropdown với TOÀN BỘ danh bạ RIÊNG (xem browseAllDirectoryUrl,
   * mặc định dùng chung directoryUrl nếu không truyền), không cần gõ ký tự
   * nào trước — dùng cho picker duyệt nhanh 1 danh sách ngắn (vd nhóm quản
   * lý trực tiếp), khác với hành vi mặc định (chỉ gợi ý khi có query). */
  browseAllLabel?: string;
  /** Nguồn RIÊNG cho nút "browse all" — khác `directoryUrl` khi cần: gõ @ tìm
   * trong TOÀN BỘ công ty (vd để tag người khác duyệt thay khi quản lý trực
   * tiếp không xử lý), nhưng nút "Chọn..." chỉ gợi ý 1 danh sách hẹp hơn (vd
   * quản lý nhóm). Không truyền thì browse-all dùng lại directoryUrl như cũ. */
  browseAllDirectoryUrl?: string;
  /** Nếu truyền, BỎ QUA `directoryUrl`/`browseAllDirectoryUrl` hoàn toàn —
   * tìm/browse-all chỉ trong đúng mảng này (không gọi API). Dùng cho bước
   * duyệt "Linh động" có giới hạn danh sách được chọn (Admin đã liệt kê sẵn ở
   * `ApproverStepDef.flexible_approver.users`) — người gửi đề xuất KHÔNG được
   * tag ai ngoài danh sách này, xem submit/page.tsx. */
  candidates?: TaggedUser[];
}

export default function TagUserInput({
  value,
  onChange,
  placeholder = "Gõ @ để tìm người dùng",
  directoryUrl = "/api/directory",
  browseAllLabel,
  browseAllDirectoryUrl,
  candidates,
}: TagUserInputProps) {
  const [query, setQuery] = useState("");
  const [directory, setDirectory] = useState<TaggedUser[]>([]);
  const [browseDirectory, setBrowseDirectory] = useState<TaggedUser[]>([]);
  const [results, setResults] = useState<TaggedUser[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (candidates) return; // danh sách tĩnh — không gọi API danh bạ.
    let cancelled = false;
    fetch(directoryUrl)
      .then((res) => (res.ok ? res.json() : { directory: [] }))
      .then((data: { directory: TaggedUser[] }) => {
        if (!cancelled) setDirectory(data.directory ?? []);
      })
      .catch(() => {
        if (!cancelled) setDirectory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [directoryUrl, candidates]);

  useEffect(() => {
    if (candidates || !browseAllDirectoryUrl) return;
    let cancelled = false;
    fetch(browseAllDirectoryUrl)
      .then((res) => (res.ok ? res.json() : { directory: [] }))
      .then((data: { directory: TaggedUser[] }) => {
        if (!cancelled) setBrowseDirectory(data.directory ?? []);
      })
      .catch(() => {
        if (!cancelled) setBrowseDirectory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [browseAllDirectoryUrl, candidates]);

  // Nguồn tìm/browse-all thật sự dùng — danh sách tĩnh (`candidates`) nếu
  // được truyền, ngược lại danh bạ tải qua API như trước.
  const effectiveDirectory = candidates ?? directory;

  useEffect(() => {
    const term = normalizeSearch(query.replace("@", "").trim());
    if (!term) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      const selectedIds = new Set(value.map((u) => u.id));
      const matches = effectiveDirectory.filter(
        (u) =>
          !selectedIds.has(u.id) &&
          (normalizeSearch(u.name).includes(term) ||
            normalizeSearch(u.username).includes(term)),
      );
      setResults(matches);
    }, 250);

    return () => clearTimeout(timer);
  }, [query, value, effectiveDirectory]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const selectUser = (user: TaggedUser) => {
    onChange([...value, user]);
    setQuery("");
    setResults([]);
  };

  const browseAll = () => {
    const selectedIds = new Set(value.map((u) => u.id));
    const source = candidates ? effectiveDirectory : browseAllDirectoryUrl ? browseDirectory : directory;
    setResults(source.filter((u) => !selectedIds.has(u.id)));
    setOpen(true);
  };

  const removeUser = (id: string) => {
    onChange(value.filter((u) => u.id !== id));
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex min-h-[36px] flex-wrap items-center gap-1.5 rounded border border-[var(--color-border)] px-2 py-1.5 focus-within:border-[var(--color-action-blue)]">
        {value.map((u) => (
          <span
            key={u.id}
            className="flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-1 pr-1.5 text-[12px] text-gray-700"
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold text-white ${
                u.kind === "group" ? "bg-teal-500" : "bg-[var(--color-action-blue)]"
              }`}
            >
              {u.avatarInitial}
            </span>
            <span>
              {u.name}
              {u.title && <span className="ml-1 text-gray-400">· {u.title}</span>}
            </span>
            <button
              type="button"
              onClick={() => removeUser(u.id)}
              aria-label={`Bỏ chọn ${u.name}`}
              className="text-gray-400 hover:text-[var(--color-danger-red)]"
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={value.length === 0 ? placeholder : ""}
          className="min-w-[100px] flex-1 text-[13px] outline-none"
        />
      </div>

      {browseAllLabel && (
        <button
          type="button"
          onClick={browseAll}
          className="mt-1 text-[12px] font-medium text-[var(--color-action-blue)] hover:underline"
        >
          {browseAllLabel}
        </button>
      )}

      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-[180px] overflow-y-auto rounded border border-[var(--color-border)] bg-white shadow-lg">
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => selectUser(u)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-gray-50"
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white ${
                  u.kind === "group" ? "bg-teal-500" : "bg-[var(--color-action-blue)]"
                }`}
              >
                {u.avatarInitial}
              </span>
              <span>
                <HighlightMatch text={u.name} query={query.replace("@", "").trim()} />{" "}
                <span className="text-gray-400">@<HighlightMatch text={u.username} query={query.replace("@", "").trim()} /></span>
                {u.kind === "group" && (
                  <span className="ml-1 text-[10px] text-teal-600">(nhóm/phòng ban)</span>
                )}
                {u.title && <span className="block text-[11px] text-gray-400">{u.title}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
