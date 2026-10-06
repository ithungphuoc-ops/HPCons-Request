"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import { useRequestContext } from "@/context/RequestContext";
import {
  ADJUSTMENT_APPROVER_COUNT,
  ADJUSTMENT_GUIDE_MAX_LENGTH,
  resolveAdjustmentFieldRules,
  type AdjustmentFieldRules,
} from "@/lib/adjustment-settings";
import type { AdjustmentApprovalRules, ProposalGroup } from "@/lib/types";

/**
 * Tab "Điều chỉnh sau duyệt" của nhóm — từ 06/10/2026 (Sếp duyệt demo
 * dieu-chinh-tu-chon-nguoi-duyet) BỎ bảng "nhánh theo phòng ban → người duyệt"
 * (PR #68): người điều chỉnh tự chọn đúng 2 người duyệt. Ở đây có:
 * - "Hướng dẫn hiện cho người điều chỉnh" — RIÊNG từng nhóm (Sếp chốt
 *   06/10/2026, thay trang "Cài đặt chung" toàn app của PR #85).
 * - "Cho phép người theo dõi cũng bấm Điều chỉnh" (giữ theo nhóm như cũ).
 * - Ô Ghi chú / Đính kèm tệp: Có / Bắt buộc (cùng kiểu "Ý kiến khi phê duyệt").
 * Dữ liệu nhánh cũ KHÔNG bị xoá (lưu lại nguyên khi bật/tắt ô người theo dõi).
 */
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
  const [hint, setHint] = useState<string | null>(null);

  if (!group) return null;

  const rules = group.adjustmentApprovalRules ?? null;
  const allowFollowers = rules?.allowFollowers === true;
  const legacyBranchCount = (rules?.branches?.length ?? 0) + ((rules?.catchAllApprovers?.length ?? 0) > 0 ? 1 : 0);
  const fieldRules = resolveAdjustmentFieldRules(group);

  const setAllowFollowers = (checked: boolean) => {
    if (!rules && !checked) return;
    // Giữ nguyên mọi key cũ (branches/catchAllApprovers) — chỉ đổi allowFollowers.
    const next: AdjustmentApprovalRules = { ...(rules ?? {}), allowFollowers: checked };
    updateGroup(group.id, { adjustmentApprovalRules: next });
  };

  const setFieldRule = (which: keyof AdjustmentFieldRules, patch: Partial<{ enabled: boolean; required: boolean }>) => {
    const next: AdjustmentFieldRules = {
      note: { ...fieldRules.note },
      attachment: { ...fieldRules.attachment },
    };
    next[which] = { ...next[which], ...patch };
    if (!next[which].enabled) next[which].required = false;
    if (!next.note.enabled && !next.attachment.enabled) {
      setHint("Phải giữ ít nhất 1 trong 2 ô (Ghi chú hoặc Đính kèm tệp) — điều chỉnh không được rỗng.");
      return;
    }
    setHint(null);
    const value: NonNullable<ProposalGroup["adjustmentFieldRules"]> = {
      noteEnabled: next.note.enabled,
      noteRequired: next.note.required,
      attachmentEnabled: next.attachment.enabled,
      attachmentRequired: next.attachment.required,
    };
    updateGroup(group.id, { adjustmentFieldRules: value });
  };

  const rows: { key: keyof AdjustmentFieldRules; label: string }[] = [
    { key: "note", label: "Ghi chú" },
    { key: "attachment", label: "Đính kèm tệp" },
  ];

  return (
    <div className="max-w-[760px]">
      <h2 className="mb-1 text-[15px] font-semibold text-gray-800">Điều chỉnh sau duyệt</h2>
      <p className="mb-4 text-[12.5px] text-gray-500">
        Mọi điều chỉnh đề nghị đã duyệt đều phải được duyệt lại: người điều chỉnh tự chọn đúng {ADJUSTMENT_APPROVER_COUNT}{" "}
        người duyệt (gợi ý nhanh: Người duyệt cuối, Trưởng phòng Thu mua) — đủ cả {ADJUSTMENT_APPROVER_COUNT} người duyệt
        thì điều chỉnh mới có hiệu lực.
      </p>

      <AdjustmentGuideEditor key={group.id} group={group} onSave={(value) => updateGroup(group.id, { adjustmentGuide: value })} />

      <label className="mb-4 flex items-start gap-2 rounded-[3px] border border-[var(--color-border)] bg-white p-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0"
          checked={allowFollowers}
          onChange={(e) => setAllowFollowers(e.target.checked)}
          data-testid="adjustment-allow-followers"
        />
        <span>
          <span className="block text-[14px] font-medium text-gray-700">
            Cho phép người theo dõi (không phải người gửi) cũng bấm &quot;Điều chỉnh&quot;
          </span>
          <span className="block text-[12px] text-gray-400">
            Tắt thì chỉ người gửi đề xuất mới bấm được.
          </span>
        </span>
      </label>

      <div className="rounded-[3px] border border-[var(--color-border)] bg-white p-3">
        <p className="mb-1 text-[14px] font-medium text-gray-700">Nội dung điều chỉnh</p>
        <p className="mb-2 text-[12px] text-gray-400">
          Có hiện ô ghi chú / ô đính kèm tệp (tối đa 6 tệp) trong hộp Điều chỉnh không, và có bắt buộc không. Luôn
          phải có ít nhất ghi chú hoặc 1 tệp mới gửi được.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]" data-testid="adjustment-field-rules-table">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[12px] text-gray-400">
                <th className="py-1.5 pr-2 text-left font-medium">Ô</th>
                <th className="w-[56px] px-2 py-1.5 text-center font-medium">Có</th>
                <th className="w-[72px] px-2 py-1.5 text-center font-medium">Bắt buộc</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, label }) => {
                const rule = fieldRules[key];
                return (
                  <tr key={key} className="border-b border-[var(--color-border)] last:border-b-0">
                    <td className="py-2 pr-2 text-gray-700">{label}</td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${label} — có`}
                        checked={rule.enabled}
                        onChange={(e) => setFieldRule(key, { enabled: e.target.checked })}
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${label} — bắt buộc`}
                        checked={rule.enabled && rule.required}
                        disabled={!rule.enabled}
                        title={rule.enabled ? undefined : "Bật “Có” trước"}
                        className="disabled:cursor-not-allowed disabled:opacity-40"
                        onChange={(e) => setFieldRule(key, { required: e.target.checked })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {hint && <p className="mt-2 text-[12px] text-[var(--color-danger-red)]">{hint}</p>}
      </div>

      {legacyBranchCount > 0 && (
        <p className="mt-4 rounded bg-gray-50 px-3 py-2 text-[12px] text-gray-500">
          Nhóm này còn cấu hình &quot;nhánh theo phòng ban&quot; cũ ({legacyBranchCount} mục) — KHÔNG còn áp dụng từ
          06/10/2026 (người điều chỉnh tự chọn người duyệt). Dữ liệu cũ vẫn được giữ, không bị xoá.
        </p>
      )}
    </div>
  );
}

/**
 * Khối "Hướng dẫn hiện cho người điều chỉnh" của NHÓM — textarea + xem trước
 * cảnh báo vàng + nút "Dùng nội dung mặc định". Lưu bằng nút (không lưu theo
 * từng phím gõ). `null` = theo nội dung mặc định; chuỗi rỗng = không hiện cảnh
 * báo. Nội dung mặc định lấy từ máy chủ (hướng dẫn chung cũ nếu từng lưu,
 * không thì mặc định trong code).
 */
function AdjustmentGuideEditor({
  group,
  onSave,
}: {
  group: ProposalGroup;
  onSave: (value: string | null) => void;
}) {
  const ownGuide = typeof group.adjustmentGuide === "string" ? group.adjustmentGuide : null;
  const [defaultGuide, setDefaultGuide] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Nhóm đã soạn riêng → hiện ngay; chưa → chờ tải nội dung mặc định.
  const [draft, setDraft] = useState<string | null>(ownGuide);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/app-settings/adjustment-guide")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Không tải được nội dung mặc định."))))
      .then((d: { defaultGuide: string }) => {
        if (cancelled) return;
        setDefaultGuide(d.defaultGuide);
        setDraft((cur) => (cur === null ? d.defaultGuide : cur));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const usingDefault = ownGuide === null;
  const effective = usingDefault ? defaultGuide : ownGuide;
  const text = draft ?? "";
  const dirty = draft !== null && effective !== null && text.trim() !== effective.trim();
  const tooLong = text.trim().length > ADJUSTMENT_GUIDE_MAX_LENGTH;

  return (
    <section
      className="mb-4 rounded-[3px] border border-[var(--color-border)] bg-white p-3"
      data-testid="group-adjustment-guide"
    >
      <p className="mb-1 text-[14px] font-medium text-gray-700">Hướng dẫn hiện cho người điều chỉnh</p>
      <p className="mb-2 text-[12px] text-gray-400">
        Hiện thành cảnh báo vàng mỗi khi có người bấm &quot;Điều chỉnh đề nghị&quot; ở đề xuất của nhóm này — giúp họ
        chọn đúng {ADJUSTMENT_APPROVER_COUNT} người duyệt. Để trống rồi lưu = không hiện cảnh báo.
      </p>
      {draft === null ? (
        <p className="text-[13px] text-gray-400">{loadError ?? "Đang tải..."}</p>
      ) : (
        <>
          <textarea
            value={text}
            maxLength={ADJUSTMENT_GUIDE_MAX_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            aria-label="Nội dung hướng dẫn điều chỉnh sau duyệt của nhóm"
            className="w-full rounded border border-[var(--color-border)] px-3 py-2 text-[14px] leading-relaxed text-gray-800 outline-none focus:border-[var(--color-action-blue)]"
          />
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[12px] text-gray-400">
            <span>
              {text.length}/{ADJUSTMENT_GUIDE_MAX_LENGTH} ký tự ·{" "}
              {usingDefault ? "đang dùng nội dung mặc định" : "nội dung riêng của nhóm"}
            </span>
            {defaultGuide !== null && (
              <button
                type="button"
                disabled={usingDefault && !dirty}
                onClick={() => {
                  setDraft(defaultGuide);
                  if (!usingDefault) onSave(null);
                }}
                className="text-[12.5px] font-medium text-[var(--color-action-blue)] hover:underline disabled:cursor-default disabled:text-gray-300 disabled:no-underline"
              >
                Dùng nội dung mặc định
              </button>
            )}
          </div>

          <p className="mb-1 mt-3 text-[12px] font-medium text-gray-600">Xem trước trong hộp Điều chỉnh</p>
          {text.trim() ? (
            <div className="flex gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[13.5px] text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">Hướng dẫn điều chỉnh sau duyệt</p>
                <p className="whitespace-pre-line break-words">{text.trim()}</p>
              </div>
            </div>
          ) : (
            <p className="text-[13px] italic text-gray-400">(Không hiện cảnh báo)</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onSave(text.trim())}
              disabled={!dirty || tooLong}
              className="rounded bg-[var(--color-action-blue)] px-4 py-1.5 text-[14px] font-medium text-white hover:brightness-95 disabled:opacity-50"
            >
              Lưu hướng dẫn
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => setDraft(effective)}
                className="text-[13px] text-gray-500 hover:underline"
              >
                Huỷ thay đổi
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
