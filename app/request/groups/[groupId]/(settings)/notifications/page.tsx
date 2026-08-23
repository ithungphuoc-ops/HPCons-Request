"use client";

import { useParams } from "next/navigation";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import { useRequestContext } from "@/context/RequestContext";
import { selectClass } from "@/components/shared/form-styles";
import { DEFAULT_GROUP_NOTIFICATION_RULES, type GroupNotificationRules } from "@/lib/types";

export default function GroupNotificationsPage() {
  return (
    <RequireAdminRole>
      <GroupNotificationsPageInner />
    </RequireAdminRole>
  );
}

function GroupNotificationsPageInner() {
  const params = useParams<{ groupId: string }>();
  const { getGroupById, updateGroup } = useRequestContext();
  const group = getGroupById(params.groupId);

  if (!group) return null;

  const rules: GroupNotificationRules = { ...DEFAULT_GROUP_NOTIFICATION_RULES, ...group.notificationRules };

  const setRule = <K extends keyof GroupNotificationRules>(key: K, value: GroupNotificationRules[K]) => {
    updateGroup(group.id, { notificationRules: { ...rules, [key]: value } });
  };

  return (
    <div className="max-w-[640px]">
      <h2 className="mb-1 text-[15px] font-semibold text-gray-800">Thông báo</h2>
      <p className="mb-4 text-[12px] text-gray-500">
        Cấu hình ở CẤP NHÓM — khác &quot;Cài đặt thông báo&quot; cá nhân của từng người dùng.
      </p>

      <div className="flex flex-col divide-y divide-gray-100 rounded-[3px] border border-[var(--color-border)] bg-white">
        <NotifRow question="Loại duyệt lần lượt, người tạo đề xuất luôn nhận được thông báo, người duyệt chỉ nhận khi đến lượt, người theo dõi chỉ nhận khi đề xuất được tạo hoặc chấp thuận hoàn toàn">
          <BoolSelect value={rules.sequentialTurnBasedNotify} onChange={(v) => setRule("sequentialTurnBasedNotify", v)} />
        </NotifRow>

        <NotifRow question="Loại luồng duyệt trong khối người duyệt, thông báo theo từng khối người duyệt">
          <BoolSelect value={rules.perStepBlockNotify} onChange={(v) => setRule("perStepBlockNotify", v)} />
        </NotifRow>

        <NotifRow question="Thông báo email" note="Chỉ lưu cấu hình, chưa gửi email thật (chưa có hạ tầng).">
          <BoolSelect value={rules.emailNotify} onChange={(v) => setRule("emailNotify", v)} />
        </NotifRow>
      </div>
    </div>
  );
}

function NotifRow({
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
