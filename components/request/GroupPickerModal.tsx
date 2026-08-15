"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Search } from "lucide-react";
import Modal from "@/components/shared/Modal";
import { useRequestContext } from "@/context/RequestContext";

/** Tô sáng phần chữ khớp với từ khoá tìm kiếm — plain-match, khớp đúng luật lọc ở trên. */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const index = text.toLowerCase().indexOf(q.toLowerCase());
  if (index === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-green-100 px-0.5 font-semibold text-green-800">{text.slice(index, index + q.length)}</mark>
      {text.slice(index + q.length)}
    </>
  );
}

/**
 * Cửa sổ chọn nhóm khi bấm "Tạo đề xuất" — xem
 * openspec/changes/add-core-request-flow-and-hpcore-sso/design.md Decision 10.
 * Đợt này lọc theo nhóm đang "active"; phạm vi usedFor chính xác vẫn được
 * máy chủ enforce khi gửi thật (POST /api/requests) — đây chỉ là danh sách
 * gợi ý, không phải chốt quyền cuối cùng.
 */
export default function GroupPickerModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { categoryGroups } = useRequestContext();
  const [query, setQuery] = useState("");

  const filteredCategories = useMemo(() => {
    const term = query.trim().toLowerCase();
    return categoryGroups
      .map((cat) => ({
        ...cat,
        groups: cat.groups.filter(
          (g) =>
            g.status === "active" &&
            (term === "" ||
              g.name.toLowerCase().includes(term) ||
              g.description.toLowerCase().includes(term)),
        ),
      }))
      .filter((cat) => cat.groups.length > 0);
  }, [categoryGroups, query]);

  const goToGroup = (groupId: string) => {
    onClose();
    router.push(`/request/groups/${groupId}/submit`);
  };

  const goDirect = () => {
    onClose();
    router.push("/request/direct/new");
  };

  return (
    <Modal title="Lựa chọn nhóm đề xuất - hoặc tìm kiếm" width={520} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm nhanh"
            className="h-[36px] w-full rounded border border-[var(--color-border)] bg-white pl-8 pr-3 text-[13px] outline-none focus:border-[var(--color-action-blue)]"
          />
        </div>

        <button
          type="button"
          onClick={goDirect}
          className="flex items-center gap-2 rounded border border-dashed border-[var(--color-border)] px-3 py-2.5 text-left text-[13px] font-medium text-[var(--color-action-blue)] hover:bg-blue-50"
        >
          <Layers size={15} /> Đề xuất trực tiếp — không theo mẫu cố định
        </button>

        <div className="max-h-[360px] overflow-y-auto">
          {filteredCategories.length === 0 && (
            <p className="px-1 py-6 text-center text-[13px] text-gray-400">
              Không có nhóm đề xuất nào khả dụng cho bạn.
            </p>
          )}
          {filteredCategories.map((cat) => (
            <div key={cat.id} className="mb-2">
              <p className="px-1 py-1 text-[12px] font-semibold text-gray-500">{cat.name}</p>
              {cat.groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => goToGroup(g.id)}
                  className="flex w-full flex-col rounded px-3 py-2.5 text-left hover:bg-gray-50"
                >
                  <span className="text-[13px] font-medium text-gray-800"><HighlightMatch text={g.name} query={query} /></span>
                  {g.description && (
                    <span className="truncate text-[12px] text-gray-400"><HighlightMatch text={g.description} query={query} /></span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
