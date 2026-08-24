"use client";

import { useParams } from "next/navigation";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import { useRequestContext } from "@/context/RequestContext";
import { selectClass } from "@/components/shared/form-styles";
import { DEFAULT_GROUP_PERMISSION_RULES, type GroupPermissionRules } from "@/lib/types";

export default function GroupPermissionsPage() {
  return (
    <RequireAdminRole>
      <GroupPermissionsPageInner />
    </RequireAdminRole>
  );
}

function GroupPermissionsPageInner() {
  const params = useParams<{ groupId: string }>();
  const { getGroupById, updateGroup } = useRequestContext();
  const group = getGroupById(params.groupId);

  if (!group) return null;

  const rules: GroupPermissionRules = { ...DEFAULT_GROUP_PERMISSION_RULES, ...group.permissionRules };

  const setRule = <K extends keyof GroupPermissionRules>(key: K, value: GroupPermissionRules[K]) => {
    updateGroup(group.id, { permissionRules: { ...rules, [key]: value } });
  };

  return (
    <div className="max-w-[640px]">
      <h2 className="mb-1 text-[15px] font-semibold text-gray-800">Tùy chỉnh về phân quyền</h2>
      <p className="mb-4 text-[12px] text-gray-500">7 cờ thật áp dụng cho nhóm đề xuất này.</p>

      <div className="flex flex-col divide-y divide-gray-100 rounded-[3px] border border-[var(--color-border)] bg-white">
        <PermRow
          question="Quyền được chỉnh sửa danh sách người theo dõi (system owners luôn có quyền chỉnh sửa)"
        >
          <select
            className={selectClass}
            value={rules.followersEditableBy}
            onChange={(e) => setRule("followersEditableBy", e.target.value as GroupPermissionRules["followersEditableBy"])}
          >
            <option value="all_viewers">Tất cả người dùng có thể xem đề xuất</option>
            <option value="system_owners_only">Chỉ Admin/Owner</option>
          </select>
        </PermRow>

        <PermRow question="Khi tạo đề xuất, người tạo có thể thêm người theo dõi mới nhưng không thể bỏ người theo dõi mặc định">
          <BoolSelect value={rules.creatorCanAddButNotRemoveDefaultFollowers} onChange={(v) => setRule("creatorCanAddButNotRemoveDefaultFollowers", v)} />
        </PermRow>

        <PermRow question="Tự động thêm người nhận công việc con trong đề xuất là người theo dõi đề xuất đó">
          <BoolSelect value={rules.autoAddSubtaskAssigneesAsFollowers} onChange={(v) => setRule("autoAddSubtaskAssigneesAsFollowers", v)} />
        </PermRow>

        <PermRow question="Chặn chỉnh sửa thảo luận và bình luận khi đề xuất đã được xử lý bởi ít nhất một người">
          <BoolSelect value={rules.lockCommentsAfterFirstDecision} onChange={(v) => setRule("lockCommentsAfterFirstDecision", v)} />
        </PermRow>

        <PermRow question="Cho phép người theo dõi mặc định của nhóm có thể xuất dữ liệu đề xuất">
          <BoolSelect value={rules.defaultFollowersCanExportData} onChange={(v) => setRule("defaultFollowersCanExportData", v)} />
        </PermRow>

        <PermRow question="Cho phép người duyệt mặc định của nhóm có thể xuất dữ liệu đề xuất">
          <BoolSelect value={rules.defaultApproversCanExportData} onChange={(v) => setRule("defaultApproversCanExportData", v)} />
        </PermRow>

        <PermRow question="Cho phép người duyệt chuyển tiếp cho người khác duyệt trước (vd: chưa hiểu rõ đề xuất, chuyển cho người hiểu rõ hơn xử lý trước — trách nhiệm đầu tiên thuộc người đó, xong quay lại mình duyệt tiếp rồi mới tới người sau)">
          <BoolSelect value={rules.approversCanDelegateApproval} onChange={(v) => setRule("approversCanDelegateApproval", v)} />
        </PermRow>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-[3px] border border-[var(--color-border)] bg-white p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Phạm vi sử dụng
          </p>
          {group.usedFor.length === 0 ? (
            <p className="text-[13px] text-gray-600">Toàn công ty</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {group.usedFor.map((u) => (
                <span key={u.id} className="rounded-full bg-gray-100 px-2 py-1 text-[12px] text-gray-700">
                  {u.name}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-gray-400">Chỉnh sửa ở tab &quot;Thiết lập chung&quot;.</p>
        </div>

        <div className="rounded-[3px] border border-[var(--color-border)] bg-white p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Người theo dõi mặc định
          </p>
          {group.followers.length === 0 ? (
            <p className="text-[13px] text-gray-400">Chưa có</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {group.followers.map((f) => (
                <span key={f.id} className="rounded-full bg-gray-100 px-2 py-1 text-[12px] text-gray-700">
                  {f.name}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-gray-400">Chỉnh sửa ở tab &quot;Thiết lập chung&quot;.</p>
        </div>
      </div>
    </div>
  );
}

function PermRow({
  question,
  note,
  children,
}: {
  question: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="max-w-[380px]">
        <p className="text-[13px] text-gray-700">{question}</p>
        {note && <p className="mt-1 text-[11px] text-gray-400">⏳ {note}</p>}
      </div>
      <div className="shrink-0 sm:w-[220px]">{children}</div>
    </div>
  );
}

function BoolSelect({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <select className={selectClass} value={value ? "yes" : "no"} onChange={(e) => onChange(e.target.value === "yes")}>
      <option value="yes">Có</option>
      <option value="no">Không</option>
    </select>
  );
}
