"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CategoryGroup, ConditionGroup, ProposalField, ProposalGroup } from "@/lib/types";
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
  /** Xoá hẳn 1 nhóm đề xuất — máy chủ tự chặn nếu nhóm đang "Đang khả dụng",
   *  ném lỗi để nơi gọi tự hiện thông báo (xem GroupRow). */
  deleteGroup: (groupId: string) => Promise<void>;
  createGroupOpen: boolean;
  openCreateGroup: () => void;
  closeCreateGroup: () => void;
  createGroup: (
    data: Omit<ProposalGroup, "id" | "fields" | "pinned" | "createdAt" | "status">,
  ) => Promise<ProposalGroup>;
  getGroupById: (groupId: string) => ProposalGroup | undefined;
  updateGroup: (groupId: string, patch: Partial<ProposalGroup>) => void;
  /** Nhân bản 1 nhóm đề xuất — chép toàn bộ cấu hình sang nhóm mới, tạo sẵn
   * ở trạng thái "closed" (xem app/api/groups/[id]/duplicate/route.ts). Trả
   * về nhóm mới để nơi gọi tự điều hướng tới. `sourceName` tuỳ chọn để nơi
   * gọi truyền thẳng tên đã có sẵn, khỏi tự tra lại. */
  duplicateGroup: (groupId: string, sourceName?: string) => Promise<ProposalGroup>;
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

/** Bỏ mọi rule tham chiếu tới `code` khỏi 1 nhóm điều kiện — nhóm rỗng rule
 *  vẫn là ConditionGroup hợp lệ (luôn thoả mãn, xem evaluateConditionGroup),
 *  không cần trả về undefined. Dùng khi xoá 1 trường để dọn sạch mọi điều
 *  kiện đang phụ thuộc vào nó ở NƠI KHÁC, tránh máy chủ từ chối lưu vì "tham
 *  chiếu tới trường không tồn tại" (Sếp chốt 29/09/2026: tự động dọn thay vì
 *  bắt tự vào sửa tay từng trường phụ thuộc). */
function stripFieldCodeFromCondition(condition: ConditionGroup, code: string): ConditionGroup {
  return { ...condition, rules: condition.rules.filter((r) => r.fieldCode !== code) };
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
  // Chị Nhung phản hồi thật 29/09/2026: sửa cấu hình nhóm/trường xong tự
  // "quay lại như cũ" mà không rõ vì sao — đọc code phát hiện máy chủ CÓ từ
  // chối lưu (validate lỗi rõ ràng, xem app/api/groups/[id]/route.ts) nhưng
  // updateGroup không hề bắt lỗi, còn updateField/addField/removeField chỉ
  // âm thầm revert không báo gì. Hộp lỗi dùng CHUNG này để mọi hàm sửa
  // nhóm/trường đều báo được, không phải sửa lại 15+ nơi đang gọi updateGroup.
  // Nằm GIỮA màn hình (Sếp chốt lại 29/09/2026: banner góc dưới-phải trước
  // đó dễ bị bỏ lỡ) — không tự ẩn, phải bấm "Đã hiểu" mới đóng, vì nội dung
  // lỗi thật (vd tên trường tham chiếu) thường dài, cần thời gian đọc kỹ.
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const showError = useCallback((message: string) => setErrorToast(message), []);

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
      let previous: ProposalGroup | null = null;
      mutateGroup(groupId, (g) => {
        previous = g;
        return { ...g, ...patch };
      });
      reportActivity({
        action: "Sửa cấu hình nhóm đề xuất",
        entityType: "proposal_group",
        entityId: groupId,
        detail: `Cập nhật: ${Object.keys(patch).join(", ")}`,
      });
      patchGroupRequest(groupId, patch)
        .then((group) => {
          // Đồng bộ lại giá trị thật từ server (ví dụ category đã được chuẩn hoá).
          mutateGroup(groupId, () => group);
          if (patch.category) refetchGroups();
        })
        .catch((err) => {
          // TRƯỚC ĐÂY: không có .catch() nào cả — máy chủ từ chối lưu (validate
          // lỗi, xem app/api/groups/[id]/route.ts) mà không ai biết, giao diện
          // vẫn hiện bản đã sửa cho tới lần load lại mới "tự quay về như cũ",
          // trông như thao tác không lưu được (chị Nhung phản hồi 29/09/2026).
          if (previous) {
            const revertTo = previous;
            mutateGroup(groupId, () => revertTo);
          }
          showError(err instanceof Error ? err.message : "Không thể lưu thay đổi, vui lòng thử lại.");
        });
    },
    [mutateGroup, refetchGroups, showError],
  );

  const duplicateGroup = useCallback(
    // `sourceName` tuỳ chọn — nơi gọi (vd layout.tsx) thường đã có sẵn tên
    // nhóm trong scope, truyền thẳng vào để khỏi tra lại categoryGroups lần
    // nữa; không truyền thì tự tra qua getGroupById() như trước.
    async (groupId: string, sourceName?: string): Promise<ProposalGroup> => {
      const resolvedSourceName = sourceName ?? getGroupById(groupId)?.name ?? groupId;
      const res = await fetch(`/api/groups/${groupId}/duplicate`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể nhân bản nhóm đề xuất.");
      }
      const { group } = (await res.json()) as { group: ProposalGroup };
      reportActivity({
        action: "Nhân bản nhóm đề xuất",
        entityType: "proposal_group",
        entityId: group.id,
        detail: `Nhân bản từ "${resolvedSourceName}" → "${group.name}"`,
      });
      // Chèn ngay nhóm mới vào state TRƯỚC khi refetch — nơi gọi (layout.tsx)
      // điều hướng sang trang nhóm mới NGAY sau khi hàm này resolve, và
      // refetchGroups() ở dưới âm thầm bỏ qua nếu GET /api/groups lỗi (xem
      // định nghĩa refetchGroups) — không chèn trước thì getGroupById() ở
      // trang mới có thể trả undefined ngay cả khi nhóm đã tạo thành công
      // trên server, hiện lầm "Không tìm thấy nhóm đề xuất này".
      setCategoryGroups((prev) =>
        prev.map((cat) => (cat.name === group.category ? { ...cat, groups: [...cat.groups, group] } : cat)),
      );
      // Best-effort — nhóm mới ĐÃ tạo thành công trên server và ĐÃ có trong
      // state (chèn ở trên) trước khi gọi refetch này; nếu chính fetch() ở
      // refetchGroups ném lỗi (mất mạng...), không được để lỗi đó vọt lên
      // làm duplicateGroup() reject — nơi gọi sẽ hiểu lầm là NHÂN BẢN thất
      // bại và báo lỗi cho Admin, dù thực tế đã thành công (CodeRabbit phát hiện).
      await refetchGroups().catch(() => {});
      return group;
    },
    [getGroupById, refetchGroups],
  );

  const deleteGroup = useCallback(
    async (groupId: string) => {
      const groupName = getGroupById(groupId)?.name ?? groupId;
      const res = await fetch(`/api/groups/${groupId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể xoá nhóm đề xuất.");
      }
      setCategoryGroups((prev) =>
        prev.map((cat) => ({ ...cat, groups: cat.groups.filter((g) => g.id !== groupId) })),
      );
      reportActivity({ action: "Xoá nhóm đề xuất", entityType: "proposal_group", entityId: groupId, detail: `Xoá nhóm "${groupName}"` });
    },
    [getGroupById],
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
      patchGroupRequest(groupId, { fields: orderedFields }).catch((err) => {
        mutateGroup(groupId, (g) => ({ ...g, fields: group.fields }));
        showError(err instanceof Error ? err.message : "Không thể thêm trường, vui lòng thử lại.");
      });
    },
    [getGroupById, mutateGroup, showError],
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
      patchGroupRequest(groupId, { fields: nextFields }).catch((err) => {
        mutateGroup(groupId, (g) => ({ ...g, fields: group.fields }));
        showError(err instanceof Error ? err.message : "Không thể lưu trường vừa sửa, vui lòng thử lại.");
      });
    },
    [getGroupById, mutateGroup, showError],
  );

  const removeField = useCallback(
    (groupId: string, fieldId: string) => {
      const group = getGroupById(groupId);
      if (!group) return;
      const removed = group.fields.find((f) => f.id === fieldId);
      const removedCode = removed?.code;

      // Dọn sạch mọi "Điều kiện hiển thị"/"điều kiện duyệt"/"điều kiện theo
      // dõi" đang tham chiếu tới mã trường vừa xoá — Sếp chốt 29/09/2026: xoá
      // 1 trường mà trường khác đang phụ thuộc vào nó (qua điều kiện) trước
      // đây bị máy chủ TỪ CHỐI lưu (đúng, để không làm 3 field kia biến mất
      // vĩnh viễn khỏi form) nhưng không ai biết cách gỡ — tự động bỏ rule
      // tham chiếu tới mã đã xoá (nhóm điều kiện rỗng rule = luôn hiển thị,
      // xem evaluateConditionGroup) thay vì bắt tự vào sửa tay từng nơi.
      const nextFields = group.fields
        .filter((f) => f.id !== fieldId)
        .map((f) =>
          removedCode && f.visibleWhen
            ? { ...f, visibleWhen: stripFieldCodeFromCondition(f.visibleWhen, removedCode) }
            : f,
        );
      const nextApproverSteps = removedCode
        ? group.approverSteps.map((s) =>
            s.condition ? { ...s, condition: stripFieldCodeFromCondition(s.condition, removedCode) } : s,
          )
        : group.approverSteps;
      const nextFollowersConditional = removedCode
        ? group.followersConditional?.map((fc) => ({
            ...fc,
            condition: stripFieldCodeFromCondition(fc.condition, removedCode),
          }))
        : group.followersConditional;

      mutateGroup(groupId, (g) => ({
        ...g,
        fields: nextFields,
        approverSteps: nextApproverSteps,
        followersConditional: nextFollowersConditional,
      }));
      reportActivity({ action: "Xoá trường tuỳ chỉnh", entityType: "proposal_field", entityId: fieldId, detail: `Nhóm ${groupId}: xoá trường "${removed?.name ?? fieldId}"` });
      patchGroupRequest(groupId, {
        fields: nextFields,
        approverSteps: nextApproverSteps,
        followersConditional: nextFollowersConditional,
      }).catch((err) => {
        mutateGroup(groupId, (g) => ({
          ...g,
          fields: group.fields,
          approverSteps: group.approverSteps,
          followersConditional: group.followersConditional,
        }));
        showError(err instanceof Error ? err.message : "Không thể xoá trường, vui lòng thử lại.");
      });
    },
    [getGroupById, mutateGroup, showError],
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
      patchGroupRequest(groupId, { fields: reordered }).catch((err) => {
        mutateGroup(groupId, (g) => ({ ...g, fields: group.fields }));
        showError(err instanceof Error ? err.message : "Không thể lưu lại thứ tự trường, vui lòng thử lại.");
      });
    },
    [getGroupById, mutateGroup, showError],
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
    duplicateGroup,
    deleteGroup,
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
    <RequestContext.Provider value={value}>
      {children}
      {errorToast && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setErrorToast(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-label="Không thể lưu"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-lg text-[var(--color-danger-red)]">
                ⚠️
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-gray-900">Không thể lưu</p>
                <p className="mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-gray-600">{errorToast}</p>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setErrorToast(null)}
                className="rounded-[3px] bg-[var(--color-action-blue)] px-4 py-1.5 text-[13px] font-medium text-white hover:brightness-95"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}
    </RequestContext.Provider>
  );
}

export function useRequestContext() {
  const ctx = useContext(RequestContext);
  if (!ctx) {
    throw new Error("useRequestContext must be used within a RequestProvider");
  }
  return ctx;
}
