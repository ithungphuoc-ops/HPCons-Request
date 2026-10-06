"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import { ADJUSTMENT_GUIDE_MAX_LENGTH } from "@/lib/adjustment-settings";

interface GuideResponse {
  guide: string;
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  defaultGuide: string;
}

/**
 * "Cài đặt chung" của app Đề xuất — cài đặt CẤP APP (không theo nhóm), chỉ
 * Owner/Admin. Hiện có 1 mục: "Hướng dẫn điều chỉnh sau duyệt" (Sếp duyệt demo
 * dieu-chinh-tu-chon-nguoi-duyet-2026-10-06).
 */
export default function AppGeneralSettingsPage() {
  return (
    <RequireAdminRole>
      <AppGeneralSettingsInner />
    </RequireAdminRole>
  );
}

function AppGeneralSettingsInner() {
  const [data, setData] = useState<GuideResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/app-settings/adjustment-guide")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Không tải được cài đặt."))))
      .then((d: GuideResponse) => {
        if (cancelled) return;
        setData(d);
        setDraft(d.guide);
      })
      .catch((err) => {
        if (!cancelled) setMessage({ ok: false, text: err instanceof Error ? err.message : "Có lỗi xảy ra." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/app-settings/adjustment-guide", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guide: draft }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<GuideResponse> & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Không lưu được.");
      setData(body as GuideResponse);
      setDraft(body.guide ?? draft);
      setMessage({ ok: true, text: "Đã lưu hướng dẫn." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Có lỗi xảy ra." });
    } finally {
      setSaving(false);
    }
  };

  const dirty = data !== null && draft.trim() !== data.guide.trim();

  return (
    <div className="max-w-[760px] px-4 py-4 md:px-8 md:py-6">
      <h1 className="mb-1 text-[18px] font-semibold text-gray-800">Cài đặt chung</h1>
      <p className="mb-5 text-[12.5px] text-gray-500">Áp dụng cho toàn bộ app Đề xuất (mọi nhóm). Chỉ Owner/Admin sửa được.</p>

      <section className="rounded-[3px] border border-[var(--color-border)] bg-white p-4" data-testid="adjustment-guide-settings">
        <h2 className="mb-1 text-[15px] font-semibold text-gray-800">Hướng dẫn điều chỉnh sau duyệt</h2>
        <p className="mb-3 text-[12.5px] text-gray-500">
          Nội dung này hiện thành cảnh báo vàng mỗi khi có người bấm &quot;Điều chỉnh đề nghị sau duyệt&quot; — giúp họ
          chọn đúng 2 người duyệt. Để trống = không hiện cảnh báo.
        </p>
        {data === null && !message ? (
          <p className="text-[13px] text-gray-400">Đang tải...</p>
        ) : (
          <>
            <textarea
              value={draft}
              maxLength={ADJUSTMENT_GUIDE_MAX_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              aria-label="Nội dung hướng dẫn điều chỉnh sau duyệt"
              className="w-full rounded border border-[var(--color-border)] px-3 py-2 text-[14px] leading-relaxed text-gray-800 outline-none focus:border-[var(--color-action-blue)]"
            />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[12px] text-gray-400">
              <span>
                {draft.length}/{ADJUSTMENT_GUIDE_MAX_LENGTH} ký tự
                {data?.isDefault ? " · đang dùng nội dung mặc định" : ""}
                {data?.updatedBy && data.updatedAt
                  ? ` · sửa lần cuối: ${data.updatedBy}, ${new Date(data.updatedAt).toLocaleString("vi-VN")}`
                  : ""}
              </span>
              {data && (
                <button
                  type="button"
                  onClick={() => setDraft(data.defaultGuide)}
                  className="text-[12.5px] font-medium text-[var(--color-action-blue)] hover:underline"
                >
                  Dùng nội dung mặc định
                </button>
              )}
            </div>

            <p className="mb-1 mt-4 text-[12px] font-medium text-gray-600">Xem trước trong hộp Điều chỉnh</p>
            {draft.trim() ? (
              <div className="flex gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[13.5px] text-amber-800">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold">Hướng dẫn điều chỉnh sau duyệt</p>
                  <p className="whitespace-pre-line break-words">{draft.trim()}</p>
                </div>
              </div>
            ) : (
              <p className="text-[13px] italic text-gray-400">(Không hiện cảnh báo)</p>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={save}
                disabled={saving || !dirty}
                className="rounded bg-[var(--color-action-blue)] px-4 py-2 text-[14px] font-medium text-white hover:brightness-95 disabled:opacity-50"
              >
                {saving ? "Đang lưu..." : "Lưu hướng dẫn"}
              </button>
              {message && (
                <span className={`text-[13px] ${message.ok ? "text-[var(--color-confirm-green)]" : "text-[var(--color-danger-red)]"}`}>
                  {message.text}
                </span>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
