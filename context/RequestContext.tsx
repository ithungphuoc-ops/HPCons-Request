"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CategoryGroup, ProposalField, ProposalGroup } from "@/lib/types";
import { reportActivity } from "@/lib/reportActivity";

export type StatusFilter = "all" | "active" | "closed";

interface RequestContextValue {
  categoryGroups: CategoryGroup[];
  statusFilter: StatusFilter;
  setStatusFilter: (filter: StatusFilter) => void;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filteredCategoryGroups: CategoryGroup[];
  collapsedCategoryIds: Set<string>;
  toggleCategoryCollapsed: (categoryId: string) => void;
  toggleGroupStatus: (groupId: string) => Promise<void>;
  toggleGroupPinned: (groupId: string) => void;
  createGroupOpen: boolean;
  openCreateGroup: () => void;
  closeCreateGroup: () => void;
  createGroup: (
    data: Omit<ProposalGroup, "id" | "fields" | "pinned" | "createdAt" | "status">,
  ) => Promise<ProposalGroup>;
  getGroupById: (groupId: string) => ProposalGroup | undefined;
  updateGroup: (groupId: string, patch: Partial<ProposalGroup>) => void;
  addField: (
    groupId: string,
    field: Omit<ProposalField, "id" | "order">,
    afterFieldId?: string | null,
  ) => void;
  updateField: (
    groupId: string,
    fieldId: string,
    patch: Omit<ProposalField, "id" | "order">,
  ) => void;
  removeField: (groupId: string, fieldId: string) => void;
  reorderFields: (groupId: string, orderedIds: string[]) => void;
  addFieldModalGroupId: string | null;
  editingField: ProposalField | null;
  openAddFieldModal: (groupId: string) => void;
  openEditFieldModal: (groupId: string, field: ProposalField) => void;
  closeAddFieldModal: () => void;
  /** Menu điều hướng (FuncBar) dạng trượt trên màn hình nhỏ — ẩn theo mặc định. */
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

const RequestContext = createContext<RequestContextValue | null>(null);

async function patchGroupRequest(
  groupId: string,
  patch: Partial<ProposalGroup>,
): Promise<ProposalGroup> {
  const res = await fetch(`/api/groups/${groupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? "Không thể cập nhật nhóm đề xuất.");
  }
  const { group } = (await res.json()) as { group: ProposalGroup };
  return group;
}

export function RequestProvider({ children }: { children: React.ReactNode }) {
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(
    new Set(),
  );
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [addFieldModalGroupId, setAddFieldModalGroupId] = useState<string | null>(
    null,
  );
  const [editingField, setEditingField] = useState<ProposalField | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const refetchGroups = useCallback(async () => {
    const res = await fetch("/api/groups");
    if (!res.ok) return;
    const data = (await res.json()) as { categoryGroups: CategoryGroup[] };
    setCategoryGroups(data.categoryGroups ?? []);
  }, []);

  useEffect(() => {
    refetchGroups();
  }, [refetchGroups]);

  const toggleCategoryCollapsed = useCallback((categoryId: string) => {
    setCollapsedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }, []);

  const mutateGroup = useCallback(
    (groupId: string, mutator: (group: ProposalGroup) => ProposalGroup) => {
      setCategoryGroups((prev) =>
        prev.map((cat) => ({
          ...cat,
          groups: cat.groups.map((g) => (g.id === groupId ? mutator(g) : g)),
        })),
      );
    },
    [],
  );

  const toggleGroupStatus = useCallback(
    async (groupId: string) => {
      let previousStatus: ProposalGroup["status"] | null = null;
      let nextStatus: ProposalGroup["status"] = "active";
      mutateGroup(groupId, (g) => {
        previousStatus = g.status;
        nextStatus = g.status === "active" ? "closed" : "active";
        return { ...g, status: nextStatus };
      });

      try {
        await patchGroupRequest(groupId, { status: nextStatus });
      } catch (err) {
        if (previousStatus) {
          const revertTo = previousStatus;
          mutateGroup(groupId, (g) => ({ ...g, status: revertTo }));
        }
        throw err instanceof Error
          ? err
          : new Error("Không thể cập nhật trạng thái, vui lòng thử lại.");
      }
    },
    [mutateGroup],
  );

  const toggleGroupPinned = useCallback(
    (groupId: string) => {
      let previousPinned: boolean | null = null;
      let nextPinned = false;
      mutateGroup(groupId, (g) => {
        previousPinned = g.pinned;
        nextPinned = !g.pinned;
        return { ...g, pinned: nextPinned };
      });

      patchGroupRequest(groupId, { pinned: nextPinned }).catch(() => {
        if (previousPinned !== null) {
          const revertTo = previousPinned;
          mutateGroup(groupId, (g) => ({ ...g, pinned: revertTo }));
        }
      });
    },
    [mutateGroup],
  );

  const createGroup = useCallback(
    async (
      data: Omit<ProposalGroup, "id" | "fields" | "pinned" | "createdAt" | "status">,
    ): Promise<ProposalGroup> => {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể tạo nhóm đề xuất.");
      }
      const { group } = (await res.json()) as { group: ProposalGroup };
      reportActivity({ action: "Tạo nhóm đề xuất", entityType: "proposal_group", entityId: group.id, detail: `Tạo nhóm "${group.name}"` });
      // Danh mục mới (nếu có) do server tạo — nạp lại toàn bộ để đồng bộ chính xác.
      await refetchGroups();
      setCreateGroupOpen(false);
      return group;
    },
    [refetchGroups],
  );

  const getGroupById = useCallback(
    (groupId: string) => {
      for (const cat of categoryGroups) {
        const found = cat.groups.find((g) => g.id === groupId);
        if (found) return found;
      }
      return undefined;
    },
    [categoryGroups],
  );

  const updateGroup = useCallback(
    (groupId: string, patch: Partial<ProposalGroup>) => {
      mutateGroup(groupId, (g) => ({ ...g, ...patch }));
      reportActivity({
        action: "Sửa cấu hình nhóm đề xuất",
        entityType: "proposal_group",
        entityId: groupId,
        detail: `Cập nhật: ${Object.keys(patch).join(", ")}`,
      });
      patchGroupRequest(groupId, patch).then((group) => {
        // Đồng bộ lại giá trị thật từ server (ví dụ category đã được chuẩn hoá).
        mutateGroup(groupId, () => group);
        if (patch.category) refetchGroups();
      });
    },
    [mutateGroup, refetchGroups],
  );

  const addField = useCallback(
    (
      groupId: string,
      field: Omit<ProposalField, "id" | "order">,
      afterFieldId?: string | null,
    ) => {
      const group = getGroupById(groupId);
      if (!group) return;

      const newField: ProposalField = { ...field, id: crypto.randomUUID(), order: 0 };
      let fields: ProposalField[];
      if (!afterFieldId) {
        fields = [newField, ...group.fields];
      } else {
        const index = group.fields.findIndex((f) => f.id === afterFieldId);
        fields =
          index === -1
            ? [...group.fields, newField]
            : [
                ...group.fields.slice(0, index + 1),
                newField,
                ...group.fields.slice(index + 1),
              ];
      }
      const orderedFields = fields.map((f, i) => ({ ...f, order: i + 1 }));

      mutateGroup(groupId, (g) => ({ ...g, fields: orderedFields }));
      setAddFieldModalGroupId(null);
      reportActivity({ action: "Thêm trường tuỳ chỉnh", entityType: "proposal_field", entityId: newField.id, detail: `Nhóm ${groupId}: thêm trường "${field.name}"` });
      patchGroupRequest(groupId, { fields: orderedFields }).catch(() => {
        mutateGroup(groupId, (g) => ({ ...g, fields: group.fields }));
      });
    },
    [getGroupById, mutateGroup],
  );

  const updateField = useCallback(
    (groupId: string, fieldId: string, patch: Omit<ProposalField, "id" | "order">) => {
      const group = getGroupById(groupId);
      if (!group) return;
      const nextFields = group.fields.map((f) =>
        f.id === fieldId ? { ...patch, id: f.id, order: f.order } : f,
      );

      mutateGroup(groupId, (g) => ({ ...g, fields: nextFields }));
      setAddFieldModalGroupId(null);
      setEditingField(null);
      reportActivity({ action: "Sửa trường tuỳ chỉnh", entityType: "proposal_field", entityId: fieldId, detail: `Nhóm ${groupId}: sửa trường "${patch.name}"` });
      patchGroupRequest(groupId, { fields: nextFields }).catch(() => {
        mutateGroup(groupId, (g) => ({ ...g, fields: group.fields }));
      });
    },
    [getGroupById, mutateGroup],
  );

  const removeField = useCallback(
    (groupId: string, fieldId: string) => {
      const group = getGroupById(groupId);
      if (!group) return;
      const removed = group.fields.find((f) => f.id === fieldId);
      const nextFields = group.fields.filter((f) => f.id !== fieldId);

      mutateGroup(groupId, (g) => ({ ...g, fields: nextFields }));
      reportActivity({ action: "Xoá trường tuỳ chỉnh", entityType: "proposal_field", entityId: fieldId, detail: `Nhóm ${groupId}: xoá trường "${removed?.name ?? fieldId}"` });
      patchGroupRequest(groupId, { fields: nextFields }).catch(() => {
        mutateGroup(groupId, (g) => ({ ...g, fields: group.fields }));
      });
    },
    [getGroupById, mutateGroup],
  );

  const reorderFields = useCallback(
    (groupId: string, orderedIds: string[]) => {
      const group = getGroupById(groupId);
      if (!group) return;
      const fieldMap = new Map(group.fields.map((f) => [f.id, f]));
      const reordered = orderedIds
        .map((id, index) => {
          const field = fieldMap.get(id);
          return field ? { ...field, order: index + 1 } : null;
        })
        .filter((f): f is ProposalField => f !== null);

      mutateGroup(groupId, (g) => ({ ...g, fields: reordered }));
      patchGroupRequest(groupId, { fields: reordered }).catch(() => {
        mutateGroup(groupId, (g) => ({ ...g, fields: group.fields }));
      });
    },
    [getGroupById, mutateGroup],
  );

  const filteredCategoryGroups = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return categoryGroups
      .map((cat) => ({
        ...cat,
        groups: cat.groups.filter((g) => {
          const matchesStatus =
            statusFilter === "all" ? true : g.status === statusFilter;
          const matchesTerm =
            term === "" ||
            g.name.toLowerCase().includes(term) ||
            g.description.toLowerCase().includes(term);
          return matchesStatus && matchesTerm;
        }),
      }))
      .filter((cat) => cat.groups.length > 0);
  }, [categoryGroups, statusFilter, searchTerm]);

  const value: RequestContextValue = {
    categoryGroups,
    statusFilter,
    setStatusFilter,
    searchTerm,
    setSearchTerm,
    filteredCategoryGroups,
    collapsedCategoryIds,
    toggleCategoryCollapsed,
    toggleGroupStatus,
    toggleGroupPinned,
    createGroupOpen,
    openCreateGroup: () => setCreateGroupOpen(true),
    closeCreateGroup: () => setCreateGroupOpen(false),
    createGroup,
    getGroupById,
    updateGroup,
    addField,
    updateField,
    removeField,
    reorderFields,
    addFieldModalGroupId,
    editingField,
    openAddFieldModal: (groupId: string) => {
      setEditingField(null);
      setAddFieldModalGroupId(groupId);
    },
    openEditFieldModal: (groupId: string, field: ProposalField) => {
      setEditingField(field);
      setAddFieldModalGroupId(groupId);
    },
    closeAddFieldModal: () => {
      setAddFieldModalGroupId(null);
      setEditingField(null);
    },
    mobileNavOpen,
    setMobileNavOpen,
  };

  return (
    <RequestContext.Provider value={value}>{children}</RequestContext.Provider>
  );
}

export function useRequestContext() {
  const ctx = useContext(RequestContext);
  if (!ctx) {
    throw new Error("useRequestContext must be used within a RequestProvider");
  }
  return ctx;
}
