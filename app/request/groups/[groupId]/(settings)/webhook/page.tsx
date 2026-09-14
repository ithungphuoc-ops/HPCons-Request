"use client";

import { useState } from "react";
import { inputClass, confirmButtonClass } from "@/components/shared/form-styles";
import RequireAdminRole from "@/components/request/RequireAdminRole";

export default function WebhookSettingsPage() {
  return (
    <RequireAdminRole>
      <WebhookSettingsPageInner />
    </RequireAdminRole>
  );
}

function WebhookSettingsPageInner() {
  const [webhookUrl, setWebhookUrl] = useState("");

  return (
    <div className="max-w-[560px]">
      <h2 className="mb-4 text-[15px] font-semibold text-gray-800">Chuyển tiếp và Webhook</h2>
      <p className="mb-4 text-[12px] text-gray-500">
        Gửi sự kiện của nhóm đề xuất này (tạo mới, duyệt, từ chối) tới một địa chỉ Webhook bên ngoài.
      </p>

      <label className="mb-1 block text-[14px] font-medium text-gray-700">Địa chỉ Webhook</label>
      <input
        className={inputClass}
        placeholder="https://example.com/webhook"
        value={webhookUrl}
        onChange={(e) => setWebhookUrl(e.target.value)}
      />

      <button type="button" className={`${confirmButtonClass} mt-4 flex-none px-6`}>
        Lưu thay đổi
      </button>
    </div>
  );
}
