"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, User, Users, X } from "lucide-react";
import TagUserInput from "@/components/shared/TagUserInput";
import { normalizeSearch } from "@/components/shared/HighlightMatch";
import {
  collectDescendantIds,
  flattenDepartmentTree,
  isGroupScopeEntry,
} from "@/lib/used-for-scope";
import type { TaggedUser } from "@/lib/types";

interface DepartmentLite {
  id: string;
  name: string;
  parentId: string | null;
}

interface MemberLite {
  uid: string;
  departmentId: string | null;
  secondaryDepartmentIds: string[];
}

/** Phần tử usedFor kiểu NHÓM — id = departments/{id} App Tổng. */
export function toGroupScopeEntry(dept: { id: string; name: string }): TaggedUser {
  return {
    id: dept.id,
    name: dept.name,
    username: dept.name.toLowerCase().replace(/\s+/g, "-"),
    avatarInitial: dept.name.charAt(0).toUpperCase(),
    kind: "group",
  };
}

/**
 * Ô cài "Phạm vi sử dụng" — Toàn công ty, hoặc chọn NHÓM (cây phòng ban App
 * Tổng, chọn nhóm cha = gồm nhóm con) + người lẻ. Thiết kế theo demo Sếp duyệt
 * 03/10/2026 (bo-nhom-thanh-vien-pham-vi-nhom-2026-10-03). Luật áp thật ở máy
 * chủ: lib/used-for-scope.ts.
 */
export default function UsedForScopeEditor({
  value,
  onChange,
  includeSecondary,
  onIncludeSecondaryChange,
}: {
  value: TaggedUser[];
  onChange: (next: TaggedUser[]) => void;
  includeSecondary: boolean;
  onIncludeSecondaryChange: (next: boolean) => void;
}) {
  const [mode, setMode] = useState<"all" | "some">(value.length > 0 ? "some" : "all");
  const [tab, setTab] = useState<"groups" | "users">("groups");
  const [query, setQuery] = useState("");
  // Giữ lựa chọn cũ khi tạm bấm "Toàn công ty" rồi đổi ý quay lại.
  const [lastSome, setLastSome] = useState<TaggedUser[]>(value);
  const [departments, setDepartments] = useState<DepartmentLite[] | null>(null);
  const [members, setMembers] = useState<MemberLite[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/directory/departments?members=1")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { departments?: DepartmentLite[]; members?: MemberLite[] }) => {
        if (cancelled) return;
        setDepartments(data.departments ?? []);
        setMembers(data.members ?? null);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groupEntries = useMemo(() => value.filter(isGroupScopeEntry), [value]);
  const userEntries = useMemo(() => value.filter((u) => !isGroupScopeEntry(u)), [value]);
  const selectedGroupIds = useMemo(() => new Set(groupEntries.map((g) => g.id)), [groupEntries]);

  const rows = useMemo(() => (departments ? flattenDepartmentTree(departments) : []), [departments]);
  const includedIds = useMemo(
    () => (departments ? collectDescendantIds(selectedGroupIds, departments) : new Set<string>()),
    [departments, selectedGroupIds],
  );
  const deptById = useMemo(() => new Map((departments ?? []).map((d) => [d.id, d])), [departments]);

  const mainCountByDept = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of members ?? []) {
      if (m.departmentId) map.set(m.departmentId, (map.get(m.departmentId) ?? 0) + 1);
    }
    return map;
  }, [members]);

  const peopleInScope = useMemo(() => {
    if (!members || mode !== "some") return null;
    const covered = new Set([...selectedGroupIds, ...includedIds]);
    const uids = new Set(userEntries.map((u) => u.id));
    for (const m of members) {
      if (m.departmentId && covered.has(m.departmentId)) uids.add(m.uid);
      else if (includeSecondary && m.secondaryDepartmentIds.some((id) => covered.has(id))) uids.add(m.uid);
    }
    return uids.size;
  }, [members, mode, selectedGroupIds, includedIds, userEntries, includeSecondary]);

  const emit = (next: TaggedUser[]) => {
    setLastSome(next);
    onChange(next);
  };

  const chooseMode = (next: "all" | "some") => {
    setMode(next);
    onChange(next === "all" ? [] : lastSome);
  };

  const toggleGroup = (dept: DepartmentLite) => {
    if (selectedGroupIds.has(dept.id)) {
      emit(value.filter((u) => !(isGroupScopeEntry(u) && u.id === dept.id)));
      return;
    }
    // Chọn nhóm cha → bỏ các nhóm con đã chọn riêng trước đó (đã gồm rồi).
    const descendants = departments ? collectDescendantIds([dept.id], departments) : new Set<string>();
    const kept = value.filter((u) => !(isGroupScopeEntry(u) && descendants.has(u.id)));
    emit([...kept, toGroupScopeEntry(dept)]);
  };

  const removeEntry = (entry: TaggedUser) => {
    emit(value.filter((u) => !(u.id === entry.id && isGroupScopeEntry(u) === isGroupScopeEntry(entry))));
  };

  const term = normalizeSearch(query.trim());
  const visibleRows = term === "" ? rows : rows.filter(({ dept }) => normalizeSearch(dept.name).includes(term));

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ModeOption
          checked={mode === "all"}
          onSelect={() => chooseMode("all")}
          title="Toàn công ty"
          desc="Mọi người đều thấy và gửi được."
        />
        <ModeOption
          checked={mode === "some"}
          onSelect={() => chooseMode("some")}
          title="Chỉ một số nhóm / người"
          desc="Chọn nhóm cha là gồm luôn các nhóm con."
        />
      </div>

      {mode === "some" && (
        <>
          <div className="overflow-hidden rounded border border-[var(--color-border)]">
            <div className="flex border-b border-[var(--color-border)]" role="tablist">
              <TabButton active={tab === "groups"} onClick={() => setTab("groups")}>
                <Users size={14} /> Nhóm {groupEntries.length > 0 && `(${groupEntries.length})`}
              </TabButton>
              <TabButton active={tab === "users"} onClick={() => setTab("users")}>
                <User size={14} /> Người lẻ {userEntries.length > 0 && `(${userEntries.length})`}
              </TabButton>
            </div>

            {tab === "groups" ? (
              <div>
                <div className="relative border-b border-[var(--color-border)]">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Tìm nhóm"
                    className="h-[36px] w-full bg-white pl-8 pr-3 text-[14px] outline-none"
                  />
                </div>
                <div className="max-h-[300px] overflow-y-auto p-1.5">
                  {loadError && (
                    <p className="px-2 py-3 text-[12px] text-[var(--color-danger-red)]">
                      Không tải được danh sách nhóm từ App Tổng, vui lòng thử lại sau.
                    </p>
                  )}
                  {!loadError && !departments && <p className="px-2 py-3 text-[12px] text-gray-400">Đang tải nhóm...</p>}
                  {departments && visibleRows.length === 0 && (
                    <p className="px-2 py-3 text-[12px] text-gray-400">Không có nhóm phù hợp.</p>
                  )}
                  {visibleRows.map(({ dept, depth }) => {
                    const included = includedIds.has(dept.id);
                    const checked = selectedGroupIds.has(dept.id) || included;
                    const count = mainCountByDept.get(dept.id);
                    return (
                      <label
                        key={dept.id}
                        className={`flex min-h-[34px] items-center gap-2 rounded px-2 py-1 text-[14px] ${
                          included ? "cursor-not-allowed text-gray-400" : "cursor-pointer text-gray-700 hover:bg-gray-50"
                        }`}
                        style={{ paddingLeft: `${8 + (term === "" ? depth : 0) * 20}px` }}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0"
                          checked={checked}
                          disabled={included}
                          onChange={() => toggleGroup(dept)}
                        />
                        <span className="min-w-0 flex-1 truncate" title={dept.name}>
                          {dept.name}
                        </span>
                        {included && <span className="shrink-0 text-[11px] font-semibold text-[var(--color-confirm-green)]">đã gồm</span>}
                        {count !== undefined && <span className="shrink-0 text-[12px] text-gray-400">{count} người</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="p-2">
                <TagUserInput
                  value={userEntries}
                  onChange={(users) => emit([...groupEntries, ...users])}
                  placeholder="Gõ @ để thêm người lẻ"
                />
              </div>
            )}
          </div>

          {(groupEntries.length > 0 || (tab === "groups" && userEntries.length > 0)) && (
            <div className="flex flex-wrap gap-1.5">
              {groupEntries.map((g) => {
                const missing = departments !== null && !deptById.has(g.id);
                return (
                  <Chip key={`g-${g.id}`} tone="group" onRemove={() => removeEntry(g)}>
                    <Users size={12} /> {deptById.get(g.id)?.name ?? g.name}
                    {missing && " (không còn)"}
                  </Chip>
                );
              })}
              {tab === "groups" &&
                userEntries.map((u) => (
                  <Chip key={`u-${u.id}`} tone="user" onRemove={() => removeEntry(u)}>
                    <User size={12} /> {u.name}
                  </Chip>
                ))}
            </div>
          )}

          <label className={`flex items-start gap-2 text-[13.5px] ${groupEntries.length === 0 ? "text-gray-400" : "text-gray-700"}`}>
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0"
              checked={includeSecondary}
              disabled={groupEntries.length === 0}
              onChange={(e) => onIncludeSecondaryChange(e.target.checked)}
            />
            <span>
              Tính cả người <b>kiêm nhiệm</b> ở nhóm đã chọn
              <span className="block text-[12px] text-gray-400">Người có đơn vị kiêm nhiệm thuộc nhóm đã chọn cũng thấy và gửi được.</span>
            </span>
          </label>

          {value.length === 0 ? (
            <p className="rounded bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              Chưa chọn nhóm hay người nào — lưu lúc này sẽ là <b>Toàn công ty</b>.
            </p>
          ) : (
            peopleInScope !== null && (
              <p className="rounded bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
                Khoảng <b>{peopleInScope}</b> người (đang hoạt động) trong phạm vi.
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

function ModeOption({
  checked,
  onSelect,
  title,
  desc,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded border px-3 py-2 ${
        checked ? "border-[var(--color-action-blue)] bg-blue-50" : "border-[var(--color-border)] bg-white"
      }`}
    >
      <input type="radio" className="mt-1" checked={checked} onChange={onSelect} />
      <span>
        <span className="block text-[14px] font-medium text-gray-800">{title}</span>
        <span className="block text-[12px] text-gray-500">{desc}</span>
      </span>
    </label>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-[13px] font-semibold ${
        active ? "bg-white text-[var(--color-action-blue)]" : "bg-gray-50 text-gray-500"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({
  tone,
  onRemove,
  children,
}: {
  tone: "group" | "user";
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-[12.5px] font-medium ${
        tone === "group" ? "bg-blue-50 text-[var(--color-action-blue)]" : "bg-gray-100 text-gray-700"
      }`}
    >
      <span className="inline-flex min-w-0 items-center gap-1 truncate">{children}</span>
      <button type="button" onClick={onRemove} aria-label="Bỏ chọn" className="rounded-full p-0.5 hover:bg-black/5">
        <X size={12} />
      </button>
    </span>
  );
}

/** Tóm tắt phạm vi để hiển thị 1 dòng (thẻ "Thông tin chung"). */
export function describeUsedFor(usedFor: TaggedUser[], includeSecondary: boolean): string {
  if (usedFor.length === 0) return "Toàn công ty";
  const groups = usedFor.filter(isGroupScopeEntry).map((g) => `Nhóm ${g.name}`);
  const users = usedFor.filter((u) => !isGroupScopeEntry(u)).map((u) => u.name);
  const text = [...groups, ...users].join(", ");
  return groups.length > 0 && !includeSecondary ? `${text} (không tính kiêm nhiệm)` : text;
}
