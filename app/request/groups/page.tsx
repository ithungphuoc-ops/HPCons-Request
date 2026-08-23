"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Layers, Mail, MailX, Plus, Search, UserCog, X as XIcon } from "lucide-react";
import { useRequestContext, type StatusFilter } from "@/context/RequestContext";
import GroupCategoryCard from "@/components/request/GroupCategoryCard";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import Modal from "@/components/shared/Modal";
import TagUserInput from "@/components/shared/TagUserInput";
import {
  cancelButtonClass,
  confirmButtonClass,
  inputClass,
} from "@/components/shared/form-styles";
import { fixedStepUsers } from "@/lib/approval-logic";
import type { ApproverStepDef, TaggedUser } from "@/lib/types";
import Link from "next/link";

const filterTabs: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "active", label: "Đang khả dụng" },
  { key: "closed", label: "Đang tạm đóng" },
];

export default function GroupsPage() {
  return (
    <RequireAdminRole>
      <GroupsPageInner />
    </RequireAdminRole>
  );
}

function GroupsPageInner() {
  const {
    filteredCategoryGroups,
    statusFilter,
    setStatusFilter,
    searchTerm,
    setSearchTerm,
    openCreateGroup,
    updateGroup,
    getGroupById,
  } = useRequestContext();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [slaModalOpen, setSlaModalOpen] = useState(false);
  const [approverModalOpen, setApproverModalOpen] = useState(false);

  useEffect(() => {
    if (!createMenuOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(event.target as Node)) {
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [createMenuOpen]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const bulkSetEmail = (enabled: boolean) => {
    selectedIds.forEach((id) => updateGroup(id, { notifyManager: enabled }));
    clearSelection();
  };

  const applySla = (hours: number | null) => {
    selectedIds.forEach((id) => updateGroup(id, { slaHours: hours }));
    setSlaModalOpen(false);
    clearSelection();
  };

  const applyReplaceApprover = (from: TaggedUser, to: TaggedUser) => {
    selectedIds.forEach((id) => {
      const group = getGroupById(id);
      if (!group) return;
      // Chỉ thay bước "người cố định" và bước "linh động" (đều có danh sách
      // người Admin tự gán tay) trùng đúng người cần đổi — không đụng tới bước
      // tự động lấy quản lý trực tiếp/vai trò (§1.5 quy tắc). Bước nhiều người
      // (users): chỉ thay đúng người trùng trong danh sách, giữ nguyên những
      // người còn lại + code/condition của bước.
      const nextSteps: ApproverStepDef[] = group.approverSteps.map((step) => {
        if (step.kind === "fixed") {
          const users = fixedStepUsers(step);
          if (!users.some((u) => u.id === from.id)) return step;
          const nextUsers = users.map((u) => (u.id === from.id ? to : u));
          return { ...step, user: nextUsers[0], users: nextUsers };
        }
        if (step.kind === "flexible_approver") {
          if (!step.users.some((u) => u.id === from.id)) return step;
          return { ...step, users: step.users.map((u) => (u.id === from.id ? to : u)) };
        }
        return step;
      });
      updateGroup(id, { approverSteps: nextSteps });
    });
    setApproverModalOpen(false);
    clearSelection();
  };

  return (
    <div className="px-8 py-6">
      <div className="mb-1 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-[23px] font-bold text-gray-900">Quản lý nhóm đề xuất</h1>
          <div className="mt-3 flex items-center gap-5">
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                className={`pb-2 text-[13px] ${
                  statusFilter === tab.key
                    ? "border-b-2 border-[var(--color-action-blue)] font-semibold text-[var(--color-action-blue)]"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm nhóm đề xuất"
              className="h-[36px] w-[230px] rounded border border-[var(--color-border)] bg-white pl-8 pr-3 text-[13px] outline-none focus:border-[var(--color-action-blue)]"
            />
          </div>

          <div className="relative" ref={createMenuRef}>
            <div className="flex h-[36px] items-stretch overflow-hidden rounded bg-[var(--color-action-blue)] text-white">
              <button
                type="button"
                onClick={openCreateGroup}
                className="flex items-center gap-1.5 pl-4 pr-3 text-[13px] font-medium hover:brightness-95"
              >
                <Plus size={15} />
                Tạo nhóm đề xuất
              </button>
              <button
                type="button"
                onClick={() => setCreateMenuOpen((v) => !v)}
                aria-label="Xem thêm lựa chọn tạo nhóm"
                aria-expanded={createMenuOpen}
                className="flex items-center border-l border-white/30 px-2 hover:brightness-95"
              >
                <ChevronDown size={14} />
              </button>
            </div>

            {createMenuOpen && (
              <div className="absolute right-0 top-[42px] z-10 w-[200px] rounded border border-[var(--color-border)] bg-white shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    openCreateGroup();
                    setCreateMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-gray-50"
                >
                  <Plus size={14} /> Tạo nhóm đề xuất
                </button>
                <Link
                  href="/request/groups/from-template"
                  onClick={() => setCreateMenuOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-gray-50"
                >
                  <Layers size={14} /> Tạo nhóm từ mẫu
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 mt-4 flex items-center gap-3 rounded-[3px] border border-[var(--color-action-blue)] bg-blue-50 px-4 py-2.5">
          <span className="text-[13px] font-medium text-gray-700">
            Đã chọn {selectedIds.size} nhóm
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => bulkSetEmail(true)}
              className="flex h-8 items-center gap-1.5 rounded border border-[var(--color-border)] bg-white px-3 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
            >
              <Mail size={13} /> Bật thông báo email
            </button>
            <button
              type="button"
              onClick={() => bulkSetEmail(false)}
              className="flex h-8 items-center gap-1.5 rounded border border-[var(--color-border)] bg-white px-3 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
            >
              <MailX size={13} /> Tắt thông báo email
            </button>
            <button
              type="button"
              onClick={() => setSlaModalOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded border border-[var(--color-border)] bg-white px-3 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
            >
              Đặt thời hạn xử lý
            </button>
            <button
              type="button"
              onClick={() => setApproverModalOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded border border-[var(--color-border)] bg-white px-3 text-[12px] font-medium text-gray-700 hover:bg-gray-50"
            >
              <UserCog size={13} /> Thay người duyệt
            </button>
            <button
              type="button"
              onClick={clearSelection}
              aria-label="Bỏ chọn tất cả"
              className="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <XIcon size={14} />
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        {filteredCategoryGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-[3px] border border-dashed border-[var(--color-border)] bg-white py-16">
            <p className="text-[13px] text-gray-400">
              Không tìm thấy nhóm đề xuất nào phù hợp.
            </p>
            <button
              type="button"
              onClick={openCreateGroup}
              className="flex h-[36px] items-center gap-1.5 rounded bg-[var(--color-action-blue)] px-4 text-[13px] font-medium text-white hover:brightness-95"
            >
              <Plus size={15} /> Tạo nhóm đề xuất
            </button>
          </div>
        ) : (
          filteredCategoryGroups.map((category) => (
            <GroupCategoryCard
              key={category.id}
              category={category}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
            />
          ))
        )}
      </div>

      {slaModalOpen && (
        <BulkSlaModal onClose={() => setSlaModalOpen(false)} onConfirm={applySla} />
      )}
      {approverModalOpen && (
        <BulkReplaceApproverModal
          onClose={() => setApproverModalOpen(false)}
          onConfirm={applyReplaceApprover}
        />
      )}
    </div>
  );
}

function BulkSlaModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (hours: number | null) => void;
}) {
  const [hours, setHours] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    if (hours.trim() === "") {
      onConfirm(null);
      return;
    }
    const value = Number(hours);
    if (!Number.isFinite(value) || value < 0) {
      setError("Thời hạn phải là số giờ hợp lệ (>= 0), hoặc để trống để bỏ thời hạn.");
      return;
    }
    onConfirm(value);
  };

  return (
    <Modal
      title="Đặt thời hạn xử lý hàng loạt"
      width={400}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={cancelButtonClass}>
            Hủy bỏ
          </button>
          <button type="button" onClick={handleConfirm} className={confirmButtonClass}>
            Áp dụng
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <label className="text-[13px] font-medium text-gray-700">Thời hạn (giờ)</label>
        <input
          type="number"
          min={0}
          className={inputClass}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="Để trống = không đặt thời hạn"
        />
        {error && <p className="text-[12px] text-[var(--color-danger-red)]">{error}</p>}
      </div>
    </Modal>
  );
}

function BulkReplaceApproverModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (from: TaggedUser, to: TaggedUser) => void;
}) {
  const [from, setFrom] = useState<TaggedUser[]>([]);
  const [to, setTo] = useState<TaggedUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    if (from.length === 0 || to.length === 0) {
      setError("Chọn cả người bị thay và người thay thế.");
      return;
    }
    onConfirm(from[0], to[0]);
  };

  return (
    <Modal
      title="Thay người duyệt hàng loạt"
      width={440}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={cancelButtonClass}>
            Hủy bỏ
          </button>
          <button type="button" onClick={handleConfirm} className={confirmButtonClass}>
            Áp dụng
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-gray-500">
          Chỉ áp dụng cho bước duyệt &quot;người cố định&quot; trùng đúng người bị thay — không
          đổi bước tự động lấy quản lý trực tiếp/vai trò. Chỉ ảnh hưởng đề xuất tạo SAU khi
          áp dụng.
        </p>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-gray-700">
            Người bị thay <span className="text-[var(--color-danger-red)]">*</span>
          </label>
          <TagUserInput value={from} onChange={(users) => setFrom(users.slice(-1))} />
        </div>
        <div>
          <label className="mb-1 block text-[13px] font-medium text-gray-700">
            Người thay thế <span className="text-[var(--color-danger-red)]">*</span>
          </label>
          <TagUserInput value={to} onChange={(users) => setTo(users.slice(-1))} />
        </div>
        {error && <p className="text-[12px] text-[var(--color-danger-red)]">{error}</p>}
      </div>
    </Modal>
  );
}
