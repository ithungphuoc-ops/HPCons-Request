"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Plus, X } from "lucide-react";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import { useRequestContext } from "@/context/RequestContext";
import { selectClass } from "@/components/shared/form-styles";
import type { AdjustmentApprovalBranch, AdjustmentApprovalRules, AdjustmentApproverRef } from "@/lib/types";

interface DepartmentLite {
  id: string;
  name: string;
}

const EMPTY_RULES: AdjustmentApprovalRules = { allowFollowers: true, branches: [], catchAllApprovers: [] };

export default function GroupAdjustmentApprovalPage() {
  return (
    <RequireAdminRole>
      <GroupAdjustmentApprovalPageInner />
    </RequireAdminRole>
  );
}

function GroupAdjustmentApprovalPageInner() {
  const params = useParams<{ groupId: string }>();
  const { getGroupById, updateGroup } = useRequestContext();
  const group = getGroupById(params.groupId);
  const [departments, setDepartments] = useState<DepartmentLite[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/directory/departments")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { departments?: DepartmentLite[] }) => {
        if (!cancelled) setDepartments(data.departments ?? []);
      })
      .catch(() => {
        if (!cancelled) setDepartments([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!group) return null;

  const enabled = group.adjustmentApprovalRules != null;
  const rules = group.adjustmentApprovalRules ?? EMPTY_RULES;

  const save = (next: AdjustmentApprovalRules | null) => {
    updateGroup(group.id, { adjustmentApprovalRules: next });
  };

  return (
    <div className="max-w-[760px]">
      <h2 className="mb-1 text-[15px] font-semibold text-gray-800">Điều chỉnh sau duyệt</h2>
      <p className="mb-4 text-[12px] text-gray-500">
        Mặc định chỉ người gửi đề xuất mới sửa được số lượng/quy cách sau khi đã duyệt, và lưu thẳng ngay. Bật mục
        này để mở thêm quyền cho người theo dõi theo phòng ban, kèm 1 hoặc nhiều người phải duyệt trước khi có hiệu
        lực.
      </p>

      <label className="mb-4 flex items-center gap-2 rounded-[3px] border border-[var(--color-border)] bg-white p-3">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={enabled}
          onChange={(e) => save(e.target.checked ? EMPTY_RULES : null)}
        />
        <span className="text-[14px] font-medium text-gray-700">Bật thiết lập riêng cho nhóm này</span>
      </label>

      {!enabled ? (
        <p className="rounded bg-gray-50 px-3 py-2 text-[13px] text-gray-500">
          Đang TẮT — chỉ người gửi đề xuất sửa được, lưu thẳng ngay, không ai cần duyệt (hành vi mặc định).
        </p>
      ) : (
        <>
          <label className="mb-4 flex items-start gap-2 rounded-[3px] border border-[var(--color-border)] bg-white p-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0"
              checked={rules.allowFollowers}
              onChange={(e) => save({ ...rules, allowFollowers: e.target.checked })}
            />
            <span>
              <span className="block text-[14px] font-medium text-gray-700">
                Cho phép người theo dõi (không phải người gửi) cũng bấm &quot;Điều chỉnh&quot;
              </span>
              <span className="block text-[12px] text-gray-400">
                Tắt thì chỉ người gửi đề xuất mới bấm được — bảng nhánh bên dưới chỉ áp dụng cho người gửi.
              </span>
            </span>
          </label>

          <div className="mb-3 flex flex-col gap-3">
            {rules.branches.map((branch, i) => (
              <BranchCard
                key={branch.id}
                branch={branch}
                departments={departments}
                onChange={(next) => {
                  const branches = rules.branches.map((b, idx) => (idx === i ? next : b));
                  save({ ...rules, branches });
                }}
                onRemove={() => save({ ...rules, branches: rules.branches.filter((_, idx) => idx !== i) })}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              save({
                ...rules,
                branches: [...rules.branches, { id: crypto.randomUUID(), departments: [], requiredApprovers: [] }],
              })
            }
            className="mb-4 flex items-center gap-1.5 rounded border border-dashed border-gray-300 px-3 py-2 text-[13px] font-medium text-gray-500 hover:border-[var(--color-action-blue)] hover:text-[var(--color-action-blue)]"
          >
            <Plus size={14} /> Thêm nhánh
          </button>

          <div className="rounded-[3px] border border-dashed border-amber-300 bg-amber-50 p-3">
            <p className="mb-2 text-[12.5px] font-semibold uppercase tracking-wide text-amber-700">
              Nhánh mặc định — người theo dõi không khớp nhánh nào ở trên
            </p>
            <p className="mb-2 text-[12px] text-amber-700">
              Người gửi đề xuất không khớp nhánh nào ở trên LUÔN lưu thẳng ngay, không đọc mục này. Để trống bên dưới
              = người theo dõi không khớp nhánh nào thì không được bấm &quot;Điều chỉnh&quot;.
            </p>
            <ApproverChips
              value={rules.catchAllApprovers}
              departments={departments}
              onChange={(next) => save({ ...rules, catchAllApprovers: next })}
            />
          </div>
        </>
      )}
    </div>
  );
}

function BranchCard({
  branch,
  departments,
  onChange,
  onRemove,
}: {
  branch: AdjustmentApprovalBranch;
  departments: DepartmentLite[] | null;
  onChange: (next: AdjustmentApprovalBranch) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-[3px] border border-[var(--color-border)] bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Nhánh</span>
        <button type="button" onClick={onRemove} aria-label="Xoá nhánh" className="text-gray-300 hover:text-[var(--color-danger-red)]">
          <X size={15} />
        </button>
      </div>

      <p className="mb-1 text-[12px] font-medium text-gray-600">Nếu người điều chỉnh thuộc phòng ban</p>
      <DepartmentChips
        value={branch.departments}
        departments={departments}
        onChange={(next) => onChange({ ...branch, departments: next })}
      />

      <p className="mb-1 mt-3 text-[12px] font-medium text-gray-600">Thì cần những ai duyệt</p>
      <ApproverChips
        value={branch.requiredApprovers}
        departments={departments}
        onChange={(next) => onChange({ ...branch, requiredApprovers: next })}
      />
      {branch.requiredApprovers.length === 0 && (
        <p className="mt-1 text-[11.5px] italic text-gray-400">Để trống = không cần ai duyệt, lưu thẳng ngay.</p>
      )}
      {branch.requiredApprovers.length > 1 && (
        <p className="mt-1 text-[11.5px] italic text-gray-400">Tất cả phải duyệt (AND).</p>
      )}
    </div>
  );
}

function DepartmentChips({
  value,
  departments,
  onChange,
}: {
  value: { id: string; name: string }[];
  departments: DepartmentLite[] | null;
  onChange: (next: { id: string; name: string }[]) => void;
}) {
  const options = (departments ?? []).filter((d) => !value.some((v) => v.id === d.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((d) => (
        <span
          key={d.id}
          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[12.5px] font-medium text-[var(--color-action-blue)]"
        >
          {d.name}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => v.id !== d.id))}
            aria-label={`Bỏ phòng ban ${d.name}`}
            className="text-[var(--color-action-blue)]/60 hover:text-[var(--color-danger-red)]"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {options.length > 0 && (
        <select
          className={`${selectClass} !h-7 !w-auto !py-0 text-[12.5px]`}
          value=""
          onChange={(e) => {
            const dept = options.find((d) => d.id === e.target.value);
            if (dept) onChange([...value, { id: dept.id, name: dept.name }]);
          }}
        >
          <option value="">+ phòng ban</option>
          {options.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function approverRefKey(ref: AdjustmentApproverRef): string {
  return ref.kind === "chi_huy_truong" ? "chi_huy_truong" : `department_leader:${ref.departmentId}`;
}

function approverRefLabel(ref: AdjustmentApproverRef): string {
  return ref.kind === "chi_huy_truong" ? "Chỉ huy trưởng" : `Trưởng phòng ${ref.departmentName}`;
}

function ApproverChips({
  value,
  departments,
  onChange,
}: {
  value: AdjustmentApproverRef[];
  departments: DepartmentLite[] | null;
  onChange: (next: AdjustmentApproverRef[]) => void;
}) {
  const usedKeys = new Set(value.map(approverRefKey));
  const options: { key: string; ref: AdjustmentApproverRef; label: string }[] = [
    {
      key: "chi_huy_truong",
      ref: { kind: "chi_huy_truong" as const },
      label: "Chỉ huy trưởng (người duyệt bước 1 của đề xuất)",
    },
    ...(departments ?? []).map((d) => ({
      key: `department_leader:${d.id}`,
      ref: { kind: "department_leader" as const, departmentId: d.id, departmentName: d.name },
      label: `Trưởng phòng ${d.name}`,
    })),
  ].filter((o) => !usedKeys.has(o.key));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((ref) => (
        <span
          key={approverRefKey(ref)}
          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[12.5px] font-medium text-emerald-700"
        >
          {approverRefLabel(ref)}
          <button
            type="button"
            onClick={() => onChange(value.filter((v) => approverRefKey(v) !== approverRefKey(ref)))}
            aria-label={`Bỏ ${approverRefLabel(ref)}`}
            className="text-emerald-700/60 hover:text-[var(--color-danger-red)]"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {options.length > 0 && (
        <select
          className={`${selectClass} !h-7 !w-auto !py-0 text-[12.5px]`}
          value=""
          onChange={(e) => {
            const picked = options.find((o) => o.key === e.target.value);
            if (picked) onChange([...value, picked.ref]);
          }}
        >
          <option value="">+ người duyệt</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
