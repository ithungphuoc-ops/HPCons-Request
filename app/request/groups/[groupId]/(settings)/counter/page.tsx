"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useRequestContext } from "@/context/RequestContext";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import { confirmButtonClass, selectClass } from "@/components/shared/form-styles";

export default function CounterSettingsPage() {
  return (
    <RequireAdminRole>
      <CounterSettingsPageInner />
    </RequireAdminRole>
  );
}

function CounterSettingsPageInner() {
  const params = useParams<{ groupId: string }>();
  const { getGroupById, updateGroup } = useRequestContext();
  const group = getGroupById(params.groupId);

  const [useOwnCounter, setUseOwnCounter] = useState(group?.useOwnCounter ?? false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!group) return;
    setUseOwnCounter(group.useOwnCounter ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  if (!group) return null;

  const handleSave = () => {
    updateGroup(group.id, { useOwnCounter });
    setSavedAt(Date.now());
  };

  return (
    <div className="max-w-[560px]">
      <h2 className="mb-4 text-[15px] font-semibold text-gray-800">Bộ đếm</h2>
      <p className="mb-4 text-[12px] text-gray-500">Mẫu bộ đếm sinh tự động cho đề xuất của nhóm này.</p>

      <label className="mb-1 block text-[14px] font-medium text-gray-700">
        Sử dụng mã bộ đếm cho nhóm đề xuất?
      </label>
      <p className="mb-1 text-[12px] text-gray-400">
        Bật thì mã đề xuất của nhóm này tăng riêng, độc lập với mã của nhóm khác — mã bắt đầu lại từ 000001
        kể từ lần đầu bật.
      </p>
      <select
        className={selectClass}
        value={useOwnCounter ? "yes" : "no"}
        onChange={(e) => setUseOwnCounter(e.target.value === "yes")}
      >
        <option value="no">Không</option>
        <option value="yes">Có</option>
      </select>

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={handleSave} className={`${confirmButtonClass} flex-none px-6`}>
          Lưu thay đổi
        </button>
        {savedAt && (
          <span className="text-[12px] text-gray-400">
            Đã lưu lúc {new Date(savedAt).toLocaleTimeString("vi-VN")}
          </span>
        )}
      </div>
    </div>
  );
}
