"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, Loader2, Paperclip, Plus, Trash2, Upload, X } from "lucide-react";
import { useRequestContext } from "@/context/RequestContext";
import { HPCORE_MEMBER_GROUPS_API } from "@/lib/constants";
import { deserializeTableRows, toWireTableRows } from "@/lib/table-field";
import { evaluateConditionGroup } from "@/lib/server/conditions";
import { resolveComputedValue } from "@/lib/server/computed-fields";
import { computeManagerFlowNumbers } from "@/lib/manager-flow-numbering";
import {
  classifyDateLeadTime,
  countBusinessDaysBetween,
  DATE_LEAD_TIME_BLOCKED_MESSAGE,
  DATE_LEAD_TIME_URGENT_NOTE,
  parseFieldDateOnly,
  type DateLeadTimeStatus,
} from "@/lib/date-lead-time";
import TagUserInput from "@/components/shared/TagUserInput";
import DatePicker from "@/components/ui/DatePicker";
import Modal from "@/components/shared/Modal";
import { useCurrentSession } from "@/lib/useCurrentSession";
import { DEFAULT_GROUP_PERMISSION_RULES } from "@/lib/types";
import {
  cancelButtonClass,
  confirmButtonClass,
  disabledInputClass,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/shared/form-styles";
import type { ProposalField, RequestAttachment, RequestInstance, TaggedUser } from "@/lib/types";

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

type FieldValues = Record<string, unknown>;

/** Khớp ResolvedApproverStep ở lib/server/requests.ts (không import trực
 * tiếp vì file đó có "server-only", chỉ dùng được ở route handler). */
type ApproverStepPreview = {
  index: number;
  kind: "fixed" | "submitter_manager" | "flexible_approver";
  user: TaggedUser | null;
  error?: string;
  name?: string;
};

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export default function SubmitRequestPage() {
  const params = useParams<{ groupId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { getGroupById, updateField } = useRequestContext();
  const group = getGroupById(params.groupId);
  const { isAdmin } = useCurrentSession();
  const permissionRules = { ...DEFAULT_GROUP_PERMISSION_RULES, ...group?.permissionRules };
  // "Quyền được chỉnh sửa danh sách người theo dõi": "system_owners_only" thì
  // người gửi thường (không phải Owner/Admin) CHỈ xem, không sửa được danh
  // sách người theo dõi lúc soạn đề xuất — xem design.md Decision #5, Open
  // Questions #1 (enum có thể chưa đủ, tạm 2 giá trị đã xác nhận).
  const followersEditable = isAdmin || permissionRules.followersEditableBy === "all_viewers";

  const [draftId, setDraftId] = useState<string | null>(searchParams.get("draftId"));
  // Trạng thái GỐC của đề xuất đang sửa (null = đang tạo mới, không phải sửa
  // draftId nào) — "pending" thì ẩn "Lưu nháp" (không còn khái niệm nháp ở
  // trạng thái này) và đổi nhãn nút chính, xem loadedStatus bên dưới.
  const [loadedStatus, setLoadedStatus] = useState<RequestInstance["status"] | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [followers, setFollowers] = useState<TaggedUser[]>(group?.followers ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Mức "gấp" hiện tại của từng field có bật dateLeadTimeRule, theo id field —
  // suy ra lại mỗi lần đổi giá trị ngày (handleDateFieldChange bên dưới).
  const [dateLeadTimeStatus, setDateLeadTimeStatus] = useState<Record<string, DateLeadTimeStatus>>({});
  // Field nào đã được người gửi XÁC NHẬN "thật cần thiết" ở hộp hỏi gấp — chỉ
  // field có mặt ở đây (giá trị true) mới được đánh dấu màu + ghi chú. Đổi
  // ngày là bị xoá khỏi đây, phải xác nhận lại (xem handleDateFieldChange).
  const [urgentConfirmed, setUrgentConfirmed] = useState<Record<string, boolean>>({});
  // Hộp hỏi "có thật cần thiết không" đang mở cho field nào — null = không mở.
  const [urgentPrompt, setUrgentPrompt] = useState<{ field: ProposalField; days: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [approverPreview, setApproverPreview] = useState<
    | { status: "loading" }
    | { status: "ok"; approvers: TaggedUser[]; steps: ApproverStepPreview[] }
    | { status: "error"; message: string }
  >({ status: "loading" });
  // Lựa chọn thủ công "quản lý trực tiếp" theo index của bước duyệt — chỉ áp
  // dụng cho bước kind "submitter_manager", ghi đè lên kết quả auto-resolve.
  const [managerOverrides, setManagerOverrides] = useState<Record<number, TaggedUser>>({});
  // Người duyệt THÊM cùng hàng "Quản lý trực tiếp" (Sếp yêu cầu 16/08/2026):
  // @ thêm bao nhiêu người cũng được, TẤT CẢ (quản lý + người thêm) đều phải
  // duyệt — gửi kèm managerOverrides dạng mảng uid, server tự xác thực lại.
  const [extraApprovers, setExtraApprovers] = useState<Record<number, TaggedUser[]>>({});
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);
  // Đánh số "Luồng duyệt 1/2/3..." — logic tách sang lib/manager-flow-numbering.ts
  // (test riêng ở manager-flow-numbering.test.ts, kể cả đúng kịch bản bug đã
  // sửa: bước "fixed" xen giữa các bước "submitter_manager").
  const managerFlowNumberByStepIndex = useMemo(
    () => (approverPreview.status === "ok" ? computeManagerFlowNumbers(approverPreview.steps) : new Map()),
    [approverPreview],
  );

  useEffect(() => {
    if (!draftId) return;
    fetch(`/api/requests/${draftId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { request: RequestInstance }) => {
        setValues(data.request.values ?? {});
        setFollowers(data.request.followers ?? []);
        setLoadedStatus(data.request.status);
      })
      .catch(() => setSubmitError("Không tải được bản nháp."));
  }, [draftId]);

  // `group` (từ RequestContext) tải bất đồng bộ — lúc submit page mount lần
  // đầu, danh sách nhóm thường CHƯA tải xong nên group=undefined, khiến
  // useState(group?.followers ?? []) ở trên khởi tạo rỗng và KHÔNG BAO GIỜ tự
  // cập nhật lại khi group tải xong sau đó (đây chính là bug: người theo dõi
  // mặc định của nhóm không hiện ra dù đã cấu hình sẵn). Đồng bộ lại ở đây
  // ngay khi group sẵn sàng — bỏ qua nếu đang tải nháp (nháp tự có followers
  // riêng từ effect trên, ưu tiên hơn mặc định của nhóm).
  useEffect(() => {
    if (!group || draftId) return;
    setFollowers(group.followers);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ cần chạy lại khi đổi nhóm, không phải mọi lần group đổi tham chiếu.
  }, [group?.id]);

  // Chỉ những field được ít nhất 1 bước duyệt dùng làm điều kiện mới ảnh
  // hưởng preview — gộp giá trị các field đó thành 1 khoá ổn định để effect
  // dưới đây KHÔNG chạy lại mỗi lần gõ phím ở field khác (vd văn bản tự do),
  // chỉ chạy lại khi giá trị THỰC SỰ liên quan tới điều kiện đổi.
  const conditionFieldIds = group
    ? new Set(
        group.approverSteps
          .flatMap((s) => s.condition?.rules.map((r) => r.fieldCode) ?? [])
          .map((code) => group.fields.find((f) => f.code === code)?.id)
          .filter((id): id is string => !!id),
      )
    : new Set<string>();
  const relevantValuesKey = JSON.stringify(
    Object.fromEntries(Object.entries(values).filter(([id]) => conditionFieldIds.has(id))),
  );

  useEffect(() => {
    if (!group) return;
    setApproverPreview({ status: "loading" });
    fetch(`/api/groups/${group.id}/approver-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    })
      .then(async (res) => {
        const body = (await res.json()) as {
          approvers?: TaggedUser[];
          steps?: ApproverStepPreview[];
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? "Không xác định được người duyệt.");
        setApproverPreview({ status: "ok", approvers: body.approvers ?? [], steps: body.steps ?? [] });
      })
      .catch((err) =>
        setApproverPreview({
          status: "error",
          message: err instanceof Error ? err.message : "Không xác định được người duyệt.",
        }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ cần chạy lại khi đổi nhóm hoặc giá trị field liên quan điều kiện đổi, không phải mọi lần values đổi tham chiếu.
  }, [group?.id, relevantValuesKey]);

  // Field "tự tính" (computedFrom): tự tính lại giá trị theo THỜI GIAN THỰC
  // mỗi khi bất kỳ field nào đổi — phép tính chỉ là ghép chuỗi trên vài field
  // nên chạy mỗi lần đổi values vẫn rẻ, không cần lọc field nguồn trước.
  // Guard "changed ? next : prev" trả về ĐÚNG tham chiếu cũ khi không có gì
  // đổi → React bỏ qua re-render, không gây vòng lặp vô hạn.
  useEffect(() => {
    if (!group) return;
    const computedFields = group.fields.filter((f) => f.computedFrom);
    if (computedFields.length === 0) return;
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const field of computedFields) {
        const computed = resolveComputedValue(field.computedFrom!, prev, group.fields);
        if (computed !== null && prev[field.id] !== computed) {
          next[field.id] = computed;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- group lấy theo id là đủ (fields đổi thì id không đổi nhưng lần render kế tiếp values đổi sẽ kéo effect chạy lại).
  }, [group?.id, values]);

  if (!group) return null;

  // Field có `visibleWhen` chỉ hiện khi điều kiện thoả mãn — vd 4 field
  // "Thiết bị..." chỉ hiện đúng 1 cái tuỳ "Nhóm đề xuất" đang chọn. Field ẩn
  // KHÔNG bắt buộc trả lời dù `required=true` (đúng theo Base.vn thật).
  const isFieldVisible = (field: ProposalField) =>
    !field.visibleWhen || evaluateConditionGroup(field.visibleWhen, values, group.fields);
  const visibleFields = group.fields.filter(isFieldVisible);

  const setFieldValue = (fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const clearDateLeadTimeFlags = (fieldId: string) => {
    setDateLeadTimeStatus((prev) => {
      if (!(fieldId in prev)) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
    setUrgentConfirmed((prev) => {
      if (!(fieldId in prev)) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
    setErrors((prev) => {
      if (!(fieldId in prev)) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };

  /**
   * onChange riêng cho field date/datetime có bật `dateLeadTimeRule` — Sếp
   * chốt 20/08/2026. Luôn ghi giá trị người dùng chọn (không chặn ở đây),
   * rồi phân loại mức gấp: "blocked" báo lỗi ngay tại field (chặn gửi thật ở
   * handleSubmit); "urgent" mở hộp hỏi "có cần thiết không" — xác nhận thì
   * đánh dấu; "ok" xoá mọi cờ cũ. Đổi ngày LUÔN xoá xác nhận cũ — phải hỏi
   * lại vì mức gấp có thể đã đổi.
   */
  const handleDateFieldChange = (field: ProposalField, value: unknown) => {
    setFieldValue(field.id, value);
    const rule = field.dateLeadTimeRule;
    if (!rule?.enabled) return;

    if (isEmptyValue(value)) {
      clearDateLeadTimeFlags(field.id);
      return;
    }
    const target = parseFieldDateOnly(value as string);
    if (!target) return;
    const days = countBusinessDaysBetween(new Date(), target);
    const status = classifyDateLeadTime(days, rule.standardDays);

    setDateLeadTimeStatus((prev) => ({ ...prev, [field.id]: status }));
    setUrgentConfirmed((prev) => {
      if (!(field.id in prev)) return prev;
      const next = { ...prev };
      delete next[field.id];
      return next;
    });

    if (status === "blocked") {
      setErrors((prev) => ({ ...prev, [field.id]: DATE_LEAD_TIME_BLOCKED_MESSAGE }));
      setUrgentPrompt((prev) => (prev?.field.id === field.id ? null : prev));
    } else {
      setErrors((prev) => {
        if (!(field.id in prev)) return prev;
        const next = { ...prev };
        delete next[field.id];
        return next;
      });
      if (status === "urgent") {
        setUrgentPrompt({ field, days });
      } else {
        setUrgentPrompt((prev) => (prev?.field.id === field.id ? null : prev));
      }
    }
  };

  const buildPayloadValues = (): FieldValues => {
    const payload: FieldValues = { ...values };
    for (const field of group.fields) {
      if (
        (field.dataType === "table" || field.dataType === "base_table") &&
        payload[field.id] !== undefined
      ) {
        payload[field.id] = toWireTableRows(payload[field.id]);
      }
    }
    return payload;
  };

  const saveDraft = async () => {
    setSavingDraft(true);
    setSubmitError(null);
    try {
      const payloadValues = buildPayloadValues();
      if (draftId) {
        const res = await fetch(`/api/requests/${draftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: payloadValues, followers, isDraft: true }),
        });
        if (!res.ok) throw new Error("Không thể lưu nháp.");
      } else {
        const res = await fetch("/api/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId: group.id, values: payloadValues, followers, isDraft: true }),
        });
        if (!res.ok) throw new Error("Không thể lưu nháp.");
        const data = (await res.json()) as { request: RequestInstance };
        setDraftId(data.request.id);
      }
      setDraftSavedAt(Date.now());
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmit = async () => {
    const nextErrors: Record<string, string> = {};
    if (group.requiresSubmissionForm !== false) {
      for (const field of visibleFields) {
        if (field.required && isEmptyValue(values[field.id])) {
          nextErrors[field.id] = "Trường này là bắt buộc.";
        }
        // Mốc cứng ≤2 ngày làm việc — kiểm lại ở đây (không chỉ tin state đã
        // set lúc onChange) để phòng field bị ẩn/hiện lại qua visibleWhen mà
        // không đi lại qua handleDateFieldChange.
        if (field.dateLeadTimeRule?.enabled && dateLeadTimeStatus[field.id] === "blocked") {
          nextErrors[field.id] = DATE_LEAD_TIME_BLOCKED_MESSAGE;
        }
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    // Chặn gửi khi CHƯA biết chắc danh sách bước duyệt (đang tải lại preview
    // do vừa đổi 1 field ảnh hưởng điều kiện, hoặc preview lỗi) — trước đây
    // guard dưới đây chỉ chạy khi status === "ok" nên bấm Gửi đúng lúc đang
    // tải/lỗi sẽ lọt qua kiểm tra "phải chọn tay quản lý trực tiếp" hoàn toàn
    // (bug thật phát hiện qua code review 18/08/2026). Nút Gửi cũng bị khoá
    // cùng điều kiện này (xem disabled ở bên dưới) — chặn ở đây thêm 1 lớp
    // phòng trường hợp bấm Enter hoặc race khác ngoài click nút.
    if (approverPreview.status !== "ok") {
      setSubmitError(
        approverPreview.status === "loading"
          ? "Đang xác định người duyệt, vui lòng đợi rồi bấm Gửi lại."
          : "Không xác định được người duyệt, vui lòng thử lại hoặc liên hệ admin.",
      );
      return;
    }

    // Ô "Quản lý trực tiếp" LUÔN bắt chọn tay (không tự điền sẵn, khớp đúng
    // hành vi Base.vn thật) — chặn gửi nếu còn bước submitter_manager nào
    // chưa được chọn. "Linh động" có bật `submitterAssigns` cũng bắt chọn tay
    // tương tự (28/08/2026) — tra `group.approverSteps[s.index]` vì preview
    // trả về từ API không mang theo field cấu hình này, chỉ có `kind`.
    if (
      approverPreview.steps.some((s) => {
        if (s.kind === "submitter_manager") return !managerOverrides[s.index];
        const rawStep = group.approverSteps[s.index];
        if (rawStep?.kind === "flexible_approver" && rawStep.submitterAssigns) {
          return !managerOverrides[s.index];
        }
        return false;
      })
    ) {
      setSubmitError("Vui lòng chọn đủ người duyệt cho các bước cần chọn trước khi gửi đề xuất.");
      return;
    }

    const managerOverridesPayload: Record<number, string[]> = {};
    for (const [index, user] of Object.entries(managerOverrides)) {
      const idx = Number(index);
      // Người đầu = quản lý được chọn, sau đó là người duyệt thêm (loại trùng
      // uid với quản lý để không tạo 2 dòng duyệt cho cùng 1 người).
      const extraIds = (extraApprovers[idx] ?? []).map((u) => u.id).filter((id) => id !== user.id);
      managerOverridesPayload[idx] = [user.id, ...extraIds];
    }

    setErrors({});
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payloadValues = buildPayloadValues();
      const res = draftId
        ? await fetch(`/api/requests/${draftId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              values: payloadValues,
              followers,
              isDraft: false,
              managerOverrides: managerOverridesPayload,
            }),
          })
        : await fetch("/api/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              groupId: group.id,
              values: payloadValues,
              followers,
              managerOverrides: managerOverridesPayload,
            }),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể gửi đề xuất, vui lòng thử lại.");
      }
      router.push("/request/list?scope=mine");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[960px] px-8 py-6">
      <h1 className="text-[22px] font-bold text-gray-900">Gửi đề xuất: {group.name}</h1>
      {group.descriptionHtml ? (
        // Nội dung đã được sanitize phía server (lib/validation.ts
        // sanitizeDescriptionHtml) trước khi lưu — an toàn để render trực tiếp.
        <div
          className="prose prose-sm mt-3 max-w-none rounded-[6px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900"
          dangerouslySetInnerHTML={{ __html: group.descriptionHtml }}
        />
      ) : (
        group.description && (
          <div className="mt-3 whitespace-pre-line rounded-[6px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] leading-relaxed text-emerald-900">
            {group.description}
          </div>
        )
      )}

      <div className="mt-5 rounded-[6px] border border-[var(--color-border)] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
            <label className="shrink-0 pt-1.5 text-[13px] font-semibold text-gray-700 sm:w-[220px]">
              Nhóm đề xuất
            </label>
            <div className="min-w-0 flex-1">
              <input className={disabledInputClass} value={group.name} disabled readOnly />
            </div>
          </div>

          {group.fields.length === 0 && (
            <p className="text-[13px] text-gray-400">Nhóm này chưa có trường dữ liệu nào.</p>
          )}
          {visibleFields
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                value={values[field.id]}
                error={errors[field.id]}
                onChange={(value) =>
                  field.dateLeadTimeRule?.enabled
                    ? handleDateFieldChange(field, value)
                    : setFieldValue(field.id, value)
                }
                // Field bảng — "+ Thêm file" phát hiện cột lạ trong file import
                // thì tự thêm vào cấu hình cột của field (thuộc GROUP, áp dụng
                // chung cho mọi đề xuất sau này của nhóm) — xem design.md của
                // change add-request-detail-base-parity, Decision #10.
                onTableColumnsChange={(columns) => updateField(group.id, field.id, { ...field, tableColumns: columns })}
                // Field "tự tính" đang tính ra được giá trị (có nhánh khớp) →
                // khoá không cho gõ tay; không nhánh nào khớp → cho gõ tay như
                // field thường (xem specs/computed-field-values).
                readOnlyComputed={
                  !!field.computedFrom &&
                  resolveComputedValue(field.computedFrom, values, group.fields) !== null
                }
                dateLeadTimeFlagged={!!urgentConfirmed[field.id]}
              />
            ))}

          {urgentPrompt && (
            <Modal
              title="Xác nhận mức độ gấp"
              width={440}
              onClose={() => setUrgentPrompt(null)}
              footer={
                <>
                  <button
                    type="button"
                    onClick={() => setUrgentPrompt(null)}
                    className={cancelButtonClass}
                  >
                    Không cần thiết, tôi đổi ngày khác
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUrgentConfirmed((prev) => ({ ...prev, [urgentPrompt.field.id]: true }));
                      setUrgentPrompt(null);
                    }}
                    className={confirmButtonClass}
                  >
                    Có, thật sự cần thiết
                  </button>
                </>
              }
            >
              <p className="text-[13px] leading-relaxed text-gray-700">
                Trường &quot;<strong>{urgentPrompt.field.name}</strong>&quot; chỉ còn{" "}
                <strong>{urgentPrompt.days} ngày làm việc</strong> — việc này có thật sự gấp/cần thiết
                không?
              </p>
            </Modal>
          )}

          {approverPreview.status === "loading" && (
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="shrink-0 pt-1.5 text-[13px] font-semibold text-gray-700 sm:w-[220px]">Người duyệt</label>
              <p className="pt-1.5 text-[13px] text-gray-400">Đang xác định người duyệt...</p>
            </div>
          )}
          {approverPreview.status === "error" && (
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="shrink-0 pt-1.5 text-[13px] font-semibold text-gray-700 sm:w-[220px]">Người duyệt</label>
              <p className="pt-1.5 text-[13px] text-[var(--color-danger-red)]">{approverPreview.message}</p>
            </div>
          )}
          {approverPreview.status === "ok" && approverPreview.steps.length === 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="shrink-0 pt-1.5 text-[13px] font-semibold text-gray-700 sm:w-[220px]">Người duyệt</label>
              <p className="pt-1.5 text-[13px] text-gray-400">Nhóm này chưa cấu hình người duyệt.</p>
            </div>
          )}
          {approverPreview.status === "ok" &&
            approverPreview.steps.map((step) => {
              // "submitter_manager": KHÔNG tự điền sẵn giá trị auto-resolve —
              // ảnh chụp thật từ request.base.vn (Base.vn gốc) cho thấy ô này
              // LUÔN để trống, bắt người gửi tự tag tay mỗi lần, dù server vẫn
              // có auto-resolve theo department.leaderId làm lưới an toàn lúc
              // gửi nếu người dùng bỏ trống (xem lib/server/requests.ts).
              // "flexible_approver" có bật `submitterAssigns` (tra `group.
              // approverSteps` — preview không mang field cấu hình này) CŨNG
              // bắt người gửi tự chọn, khớp đúng cơ chế "Linh động" thật của
              // Base.vn (28/08/2026, Sếp đối chiếu lại — trước đó hiểu nhầm là
              // Admin gán cố định). "fixed", và "flexible_approver" KHÔNG bật
              // submitterAssigns, thì luôn hiện đúng người Admin đã gán sẵn ở
              // cấu hình nhóm (không có gì để "chọn").
              const rawStep = group.approverSteps[step.index];
              const isFlexibleSubmitterAssign =
                step.kind === "flexible_approver" && rawStep?.kind === "flexible_approver" && !!rawStep.submitterAssigns;
              // Danh sách được PHÉP chọn khi giới hạn — rỗng = không giới hạn
              // (người gửi tag được bất kỳ ai), xem ApproverStepDef.
              const flexibleCandidates =
                isFlexibleSubmitterAssign && rawStep?.kind === "flexible_approver" && rawStep.users.length > 0
                  ? rawStep.users
                  : undefined;
              const isEditableKind = step.kind === "submitter_manager" || isFlexibleSubmitterAssign;
              const displayUser = isEditableKind ? managerOverrides[step.index] : step.user;
              const editing = isEditableKind && (editingStepIndex === step.index || !displayUser);
              // "fixed"/"flexible_approver" (chế độ Admin gán sẵn): ưu tiên TÊN
              // BƯỚC do Admin đặt (`step.name`, vd "QL BP") — khớp cách Base.vn
              // thật hiển thị tên vai trò thay vì tên người; không có thì rơi về
              // chức danh/tên người được gán (tra qua users/{uid}.title lúc
              // gửi, xem withTitle() ở lib/server/requests.ts).
              const managerFlowNumber = managerFlowNumberByStepIndex.get(step.index);
              const rowLabel =
                step.kind === "submitter_manager"
                  ? managerFlowNumber
                    ? `Luồng duyệt ${managerFlowNumber}`
                    : "Quản lý trực tiếp" // lưới an toàn — không nên xảy ra, nhưng tránh nhãn rỗng nếu có
                  : isFlexibleSubmitterAssign
                    ? (step.name ?? "Người duyệt")
                    : (step.name ?? displayUser?.title ?? displayUser?.name ?? "Người duyệt");

              return (
                // key gộp cả id người: bước "fixed"/"flexible_approver" nhiều
                // người sinh NHIỀU dòng cùng step.index (xem
                // resolveApproverStepsDetailed) — chỉ dùng index sẽ trùng key React.
                <div
                  key={`${step.index}-${isEditableKind ? "manager" : (step.user?.id ?? "empty")}`}
                  className="flex flex-col gap-1 sm:flex-row sm:gap-4"
                >
                  <div className="shrink-0 sm:w-[220px]">
                    <label className="pt-1.5 text-[13px] font-semibold text-gray-700 block">
                      {rowLabel}
                      {isEditableKind && " *"}
                    </label>
                    {step.kind === "submitter_manager" && (
                      <p className="text-[12px] text-gray-400">
                        Bạn phải thông báo cho người quản lý trực tiếp của mình về đề xuất này
                      </p>
                    )}
                    {isFlexibleSubmitterAssign && (
                      <p className="text-[12px] text-gray-400">
                        {flexibleCandidates
                          ? "Chỉ được chọn 1 trong số người duyệt được phép của bước này"
                          : "Chọn người duyệt phù hợp cho bước này (vd đúng công trình/bộ phận của bạn)"}
                      </p>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pt-1.5">
                    {!isEditableKind ? (
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1.5 rounded-full bg-gray-100 py-0.5 pl-1 pr-2.5 text-[12px] text-gray-700">
                          {displayUser && (
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-action-blue)] text-[9px] font-semibold text-white">
                              {displayUser.avatarInitial}
                            </span>
                          )}
                          {displayUser?.name ?? "—"}
                        </span>
                      </div>
                    ) : editing ? (
                      <div className="flex flex-col gap-1">
                        {/* value luôn rỗng — TagUserInput vốn multi-select, nếu truyền
                            sẵn người đang có thì gõ tên mới chỉ THÊM chứ không THAY
                            (đã gặp lỗi thật: gõ "@hau" không thay được Cẩm Thu vì chị
                            vẫn còn là 1 thẻ đã chọn). Chọn 1 người ở đây luôn có nghĩa
                            là "chọn/thay", không cần dọn thẻ cũ trước. */}
                        <TagUserInput
                          value={[]}
                          onChange={(users) => {
                            if (!users[0]) return;
                            setManagerOverrides((prev) => ({ ...prev, [step.index]: users[0] }));
                            setEditingStepIndex(null);
                          }}
                          placeholder={
                            isFlexibleSubmitterAssign
                              ? `Gõ @ để chọn người duyệt cho "${rowLabel}"`
                              : "Sử dụng @ để tag quản lý trực tiếp"
                          }
                          directoryUrl="/api/directory"
                          browseAllLabel={
                            isFlexibleSubmitterAssign
                              ? flexibleCandidates
                                ? "Xem danh sách được chọn"
                                : undefined
                              : "Chọn quản lý trực tiếp"
                          }
                          browseAllDirectoryUrl={isFlexibleSubmitterAssign ? undefined : "/api/directory/managers"}
                          candidates={flexibleCandidates}
                        />
                        {managerOverrides[step.index] && (
                          <button
                            type="button"
                            onClick={() => setEditingStepIndex(null)}
                            className="self-start text-[12px] font-medium text-gray-400 hover:underline"
                          >
                            Huỷ, giữ nguyên {managerOverrides[step.index].name}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1.5 rounded-full bg-gray-100 py-0.5 pl-1 pr-2.5 text-[12px] text-gray-700">
                            {displayUser && (
                              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-action-blue)] text-[9px] font-semibold text-white">
                                {displayUser.avatarInitial}
                              </span>
                            )}
                            {displayUser?.name ?? "—"}
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingStepIndex(step.index)}
                            className="text-[12px] font-medium text-[var(--color-action-blue)] hover:underline"
                          >
                            Đổi
                          </button>
                        </div>
                        {/* Người duyệt THÊM cùng hàng — @ được nhiều người, tất
                            cả (người đã chọn + người thêm) đều phải duyệt mới qua. */}
                        <TagUserInput
                          value={extraApprovers[step.index] ?? []}
                          onChange={(users) =>
                            setExtraApprovers((prev) => ({ ...prev, [step.index]: users }))
                          }
                          placeholder="Gõ @ để thêm người cùng duyệt (tất cả phải duyệt)"
                          candidates={flexibleCandidates}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

          <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
            <label className="shrink-0 pt-1.5 text-[13px] font-semibold text-gray-700 sm:w-[220px]">
              Người theo dõi
            </label>
            <div className="min-w-0 flex-1">
              {followersEditable ? (
                <TagUserInput
                  value={followers}
                  onChange={(next) => {
                    // "Người tạo có thể thêm nhưng không thể bỏ người theo
                    // dõi mặc định của nhóm" — nếu bật, hợp lại người mặc
                    // định bị lỡ bỏ (chip biến mất rồi hiện lại ngay, chưa có
                    // UI khoá riêng từng chip — xem tasks.md 5.5).
                    if (permissionRules.creatorCanAddButNotRemoveDefaultFollowers) {
                      const defaultIds = new Set((group?.followers ?? []).map((f) => f.id));
                      const missingDefaults = (group?.followers ?? []).filter(
                        (f) => defaultIds.has(f.id) && !next.some((n) => n.id === f.id),
                      );
                      setFollowers([...next, ...missingDefaults]);
                      return;
                    }
                    setFollowers(next);
                  }}
                />
              ) : (
                <div className="flex min-h-[36px] flex-wrap items-center gap-1.5 rounded border border-[var(--color-border)] bg-gray-50 px-3 py-1.5">
                  {followers.length === 0 ? (
                    <span className="text-[12px] text-gray-400">Chưa có người theo dõi</span>
                  ) : (
                    followers.map((f) => (
                      <span key={f.id} className="rounded-full bg-white px-2 py-0.5 text-[12px] text-gray-700 ring-1 ring-inset ring-gray-200">
                        {f.name}
                      </span>
                    ))
                  )}
                </div>
              )}
              {!followersEditable && (
                <p className="mt-1 text-[11px] text-gray-400">
                  Nhóm này chỉ Owner/Admin được sửa danh sách người theo dõi.
                </p>
              )}
            </div>
          </div>
        </div>

        {submitError && (
          <p className="mt-5 text-[13px] text-[var(--color-danger-red)]">{submitError}</p>
        )}

        {loadedStatus === "pending" && (
          <p className="mt-5 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
            Đề xuất này đang chờ duyệt — sửa và gửi lại sẽ xoá mọi quyết định duyệt đã có, duyệt lại từ đầu.
          </p>
        )}
        <div className="mt-6 flex items-center gap-3 border-t border-gray-100 pt-5">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || savingDraft || approverPreview.status !== "ok"}
            className={`${confirmButtonClass} flex-none px-6`}
          >
            {submitting ? "Đang gửi..." : loadedStatus === "pending" ? "Gửi lại đề xuất" : "Gửi đề xuất"}
          </button>
          {loadedStatus !== "pending" && (
            <button
              type="button"
              onClick={saveDraft}
              disabled={submitting || savingDraft}
              className={`${cancelButtonClass} flex-none px-6`}
            >
              {savingDraft ? "Đang lưu..." : "Lưu nháp"}
            </button>
          )}
          {draftSavedAt && (
            <span className="text-[12px] text-gray-400">
              Đã lưu nháp lúc {new Date(draftSavedAt).toLocaleTimeString("vi-VN")}
            </span>
          )}
          <button
            type="button"
            onClick={() => router.back()}
            className="text-[13px] text-gray-500 hover:underline"
          >
            Hủy bỏ
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  field,
  value,
  error,
  onChange,
  readOnlyComputed,
  dateLeadTimeFlagged,
  onTableColumnsChange,
}: {
  field: ProposalField;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
  /** true = field "tự tính" đang tính ra được giá trị → ô nhập chỉ đọc. */
  readOnlyComputed?: boolean;
  /** true = người gửi đã xác nhận "thật cần thiết" cho ngày gấp đang chọn ở
   * field này (dateLeadTimeRule) — đánh dấu màu + ghi chú (Sếp chốt 20/08/2026). */
  dateLeadTimeFlagged?: boolean;
  /** Chỉ có ý nghĩa với field kiểu "table"/"base_table" — gọi khi "+ Thêm
   * file" phát hiện cột lạ trong file import, ghi lại cấu hình cột mới cho
   * field (thuộc GROUP). */
  onTableColumnsChange?: (columns: string[]) => void;
}) {
  if (field.dataType === "section_title") {
    return (
      <div className="-mx-6 mt-1 border-b border-gray-100 bg-gray-50 px-6 py-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-gray-500">
          {field.name}
        </h2>
      </div>
    );
  }

  // Field kiểu Bảng thường có nhiều cột — xếp nhãn lên trên và cho bảng dùng
  // toàn bộ chiều rộng còn lại (thay vì nhường 220px cho nhãn bên trái) để đỡ
  // phải cuộn ngang khi nhóm có ≥5 cột (vd "chi tiết bảng").
  const isTable = field.dataType === "table" || field.dataType === "base_table";

  return (
    <div className={`flex flex-col gap-2 ${isTable ? "" : "sm:flex-row sm:gap-4"}`}>
      <label
        className={`shrink-0 text-[13px] font-semibold text-gray-700 ${isTable ? "" : "pt-1.5 sm:w-[220px]"}`}
      >
        {field.name}
        {field.required && <span className="ml-0.5 text-[var(--color-danger-red)]">*</span>}
      </label>
      <div
        className={
          dateLeadTimeFlagged
            ? "min-w-0 flex-1 rounded-md border border-amber-400 bg-amber-50/60 p-1.5"
            : "min-w-0 flex-1"
        }
      >
        <FieldControl
          field={field}
          value={value}
          onChange={onChange}
          readOnlyComputed={readOnlyComputed}
          onTableColumnsChange={onTableColumnsChange}
        />
        {field.helpText && <p className="mt-1 text-[12px] text-gray-400">{field.helpText}</p>}
        {readOnlyComputed && (
          <p className="mt-1 text-[12px] text-gray-400">
            Tên đề xuất được lấy tự động từ thông tin bên dưới — không nhập tay ở đây.
          </p>
        )}
        {dateLeadTimeFlagged && (
          <p className="mt-1 text-[12px] font-medium text-amber-700">⚠ {DATE_LEAD_TIME_URGENT_NOTE}</p>
        )}
        {error && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{error}</p>}
      </div>
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  readOnlyComputed,
  onTableColumnsChange,
}: {
  field: ProposalField;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnlyComputed?: boolean;
  onTableColumnsChange?: (columns: string[]) => void;
}) {
  const [tableImportStatus, setTableImportStatus] = useState<string | null>(null);
  const tableFileInputRef = useRef<HTMLInputElement>(null);
  switch (field.dataType) {
    case "short_text":
      return (
        <input
          className={readOnlyComputed ? disabledInputClass : inputClass}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnlyComputed}
          readOnly={readOnlyComputed}
        />
      );
    case "paragraph":
      return (
        <textarea
          className={readOnlyComputed ? `${textareaClass} bg-gray-50 text-gray-500` : textareaClass}
          rows={3}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnlyComputed}
          readOnly={readOnlyComputed}
        />
      );
    case "integer":
      return (
        <input
          type="number"
          step={1}
          className={inputClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
      );
    case "decimal":
    case "currency":
      return (
        <input
          type="number"
          step="any"
          className={inputClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
      );
    case "date":
      return (
        <DatePicker
          className={inputClass}
          value={(value as string) ?? ""}
          onChange={(v) => onChange(v)}
        />
      );
    case "datetime":
      return (
        <DatePicker
          className={inputClass}
          value={(value as string) ?? ""}
          onChange={(v) => onChange(v)}
          withTime
        />
      );
    case "department_select":
      return <DepartmentSelectControl value={value} onChange={onChange} />;
    case "user_select":
      return <UserSelectControl value={value as TaggedUser | null} onChange={onChange} />;
    case "single_choice":
      return (
        <select
          className={selectClass}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Chọn một giá trị</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case "multiple_choice": {
      const selected = new Set((value as string[]) ?? []);
      return (
        <div className="flex flex-col gap-1.5">
          {(field.options ?? []).map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-[13px] text-gray-700">
              <input
                type="checkbox"
                checked={selected.has(opt)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(opt);
                  else next.delete(opt);
                  onChange(Array.from(next));
                }}
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }
    case "file":
      return <FileFieldControl value={value} onChange={onChange} />;
    case "table":
    case "base_table": {
      const columns = field.tableColumns ?? [];
      const rawRows = deserializeTableRows(value);
      // Luôn hiện sẵn ít nhất 1 dòng trống để người gửi thấy ngay chỗ nhập,
      // "Thêm dòng" chỉ để thêm dòng THỨ 2 trở đi — không cho xoá về 0 dòng.
      const rows = rawRows.length === 0 ? [columns.map(() => "")] : rawRows;

      const updateCell = (rowIndex: number, colIndex: number, cellValue: string) => {
        const next = rows.map((row) => [...row]);
        if (!next[rowIndex]) next[rowIndex] = columns.map(() => "");
        next[rowIndex][colIndex] = cellValue;
        onChange(next);
      };
      const addRow = () => onChange([...rows, columns.map(() => "")]);
      const removeRow = (rowIndex: number) => {
        if (rows.length <= 1) return;
        onChange(rows.filter((_, i) => i !== rowIndex));
      };

      // "Tải file mẫu" — sinh .xlsx dòng đầu đúng cột hiện có, để điền offline.
      const downloadTemplateFile = async () => {
        const XLSX = await import("xlsx");
        const ws = XLSX.utils.aoa_to_sheet([columns]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Mẫu");
        XLSX.writeFile(wb, `mau-${field.code ?? field.name}.xlsx`);
      };

      // "+ Thêm file" — đọc file đã điền: cột khớp tên (không phân biệt hoa/
      // thường, trim khoảng trắng) nối dòng vào cột đó; cột LẠ tự thêm vào
      // cấu hình cột của field (thuộc GROUP, áp dụng chung nhóm — xem
      // design.md của change add-request-detail-base-parity, Decision #10).
      const importTableFile = async (file: File) => {
        setTableImportStatus("Đang đọc file...");
        try {
          const XLSX = await import("xlsx");
          const buffer = await file.arrayBuffer();
          const wb = XLSX.read(buffer, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rowsFromFile = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
          const [headerRow, ...dataRows] = rowsFromFile;
          if (!headerRow || headerRow.every((h) => !String(h).trim())) {
            setTableImportStatus("File không có dòng tiêu đề hợp lệ.");
            return;
          }
          const fileHeaders = headerRow.map((h) => String(h).trim());
          const normalize = (s: string) => s.trim().toLowerCase();
          const existingByNormalized = new Map(columns.map((c) => [normalize(c), c]));

          // Cột mới = có trong file nhưng chưa khớp tên cột nào đã có.
          const newHeaders = fileHeaders.filter((h) => h && !existingByNormalized.has(normalize(h)));
          const finalColumns = [...columns, ...newHeaders];
          if (newHeaders.length > 0) onTableColumnsChange?.(finalColumns);

          const filledDataRows = dataRows.filter((r) => r.some((cell) => String(cell ?? "").trim()));
          if (filledDataRows.length === 0) {
            setTableImportStatus("File không có dòng dữ liệu nào để nhập.");
            return;
          }

          const newRows = filledDataRows.map((r) =>
            finalColumns.map((col) => {
              const fileColIndex = fileHeaders.findIndex((h) => normalize(h) === normalize(col));
              return fileColIndex >= 0 ? String(r[fileColIndex] ?? "") : "";
            }),
          );
          // Dòng cũ cần bù thêm ô trống cho (các) cột mới vừa thêm để số cột khớp.
          const paddedOldRows = rows.map((r) => finalColumns.map((_, i) => r[i] ?? ""));
          onChange([...paddedOldRows, ...newRows]);
          setTableImportStatus(
            newHeaders.length > 0
              ? `Đã thêm ${newHeaders.length} cột mới + ${newRows.length} dòng dữ liệu.`
              : `Đã thêm ${newRows.length} dòng dữ liệu.`,
          );
        } catch {
          setTableImportStatus("Không đọc được file — kiểm tra lại định dạng .xlsx/.csv.");
        } finally {
          if (tableFileInputRef.current) tableFileInputRef.current.value = "";
        }
      };

      const importButtons = (
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadTemplateFile}
            disabled={columns.length === 0}
            className="flex h-7 items-center gap-1 rounded border border-[var(--color-border)] px-2 text-[11px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <FileDown size={12} /> Tải file mẫu
          </button>
          <button
            type="button"
            onClick={() => tableFileInputRef.current?.click()}
            className="flex h-7 items-center gap-1 rounded border border-[var(--color-action-blue)] px-2 text-[11px] font-medium text-[var(--color-action-blue)] hover:bg-blue-50"
          >
            <Upload size={12} /> Thêm file
          </button>
          <input
            ref={tableFileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importTableFile(file);
            }}
          />
          {tableImportStatus && <span className="text-[11px] text-gray-500">{tableImportStatus}</span>}
        </div>
      );

      if (columns.length === 0) {
        return (
          <div>
            {importButtons}
            <p className="text-[12px] text-gray-400">
              Trường bảng này chưa cấu hình cột — vào Mẫu biểu đề xuất để thêm cột, hoặc bấm &quot;Thêm
              file&quot; để tự tạo cột từ file.
            </p>
          </div>
        );
      }

      return (
        <div>
          {importButtons}
          <div className="overflow-hidden rounded border border-[var(--color-border)]">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="w-8 px-2 py-1.5 text-left text-gray-400">#</th>
                    {columns.map((col, i) => (
                      <th
                        key={i}
                        title={col}
                        className="min-w-[96px] max-w-[220px] truncate px-2 py-1.5 text-left font-medium text-gray-600"
                      >
                        {col}
                      </th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-t border-gray-100">
                      <td className="px-2 py-1 text-gray-400">{rowIndex + 1}</td>
                      {columns.map((_, colIndex) => (
                        <td key={colIndex} className="px-1 py-1">
                          <input
                            value={row[colIndex] ?? ""}
                            onChange={(e) => updateCell(rowIndex, colIndex, e.target.value)}
                            className="h-8 w-full rounded border border-transparent px-2 text-[12px] outline-none hover:border-[var(--color-border)] focus:border-[var(--color-action-blue)]"
                          />
                        </td>
                      ))}
                      <td className="px-1 py-1 text-center">
                        {rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRow(rowIndex)}
                            aria-label="Xóa dòng"
                            className="text-gray-300 hover:text-[var(--color-danger-red)]"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addRow}
              className="flex w-full items-center justify-center gap-1 border-t border-gray-100 py-2 text-[12px] text-[var(--color-action-blue)] hover:bg-blue-50"
            >
              <Plus size={13} /> Thêm dòng
            </button>
          </div>
        </div>
      );
    }
    case "formula":
      return (
        <p className="text-[12px] text-gray-400">
          Loại trường &quot;{field.name}&quot; chưa được hỗ trợ khi gửi đề xuất.
        </p>
      );
    default:
      return null;
  }
}

function FileFieldControl({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const attachments = (value as RequestAttachment[]) ?? [];
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      setError(`Chỉ được đính kèm tối đa ${MAX_ATTACHMENTS} tệp.`);
      return;
    }
    const tooBig = files.find((f) => f.size > MAX_ATTACHMENT_SIZE);
    if (tooBig) {
      setError(`Tệp "${tooBig.name}" vượt quá 10MB.`);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      files.forEach((f) => formData.append("files", f));
      const res = await fetch("/api/uploads", { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể tải tệp lên.");
      }
      const data = (await res.json()) as { attachments: RequestAttachment[] };
      onChange([...attachments, ...data.attachments]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setUploading(false);
    }
  };

  const removeAt = (index: number) => {
    onChange(attachments.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-2">
      {attachments.length > 0 && (
        <ul className="flex flex-col gap-1">
          {attachments.map((att, index) => (
            <li
              key={att.path}
              className="flex items-center gap-2 rounded border border-[var(--color-border)] px-2.5 py-1.5 text-[12px]"
            >
              <Paperclip size={13} className="shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1 truncate text-gray-700">{att.name}</span>
              <span className="shrink-0 text-gray-400">
                {(att.size / 1024 / 1024).toFixed(1)}MB
              </span>
              <button
                type="button"
                onClick={() => removeAt(index)}
                aria-label="Xóa tệp"
                className="shrink-0 text-gray-300 hover:text-[var(--color-danger-red)]"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {attachments.length < MAX_ATTACHMENTS && (
        <label className="flex w-fit cursor-pointer items-center gap-1.5 rounded border border-dashed border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-action-blue)] hover:bg-blue-50">
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
          {uploading ? "Đang tải lên..." : "Thêm tệp đính kèm"}
          <input
            type="file"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}
      <p className="text-[11px] text-gray-400">
        Tối đa {MAX_ATTACHMENTS} tệp, mỗi tệp không quá 10MB.
      </p>
      {error && <p className="text-[12px] text-[var(--color-danger-red)]">{error}</p>}
    </div>
  );
}

function UserSelectControl({
  value,
  onChange,
}: {
  value: TaggedUser | null;
  onChange: (value: unknown) => void;
}) {
  return (
    <TagUserInput
      value={value ? [value] : []}
      onChange={(users) => onChange(users.slice(-1)[0] ?? null)}
      placeholder="Gõ @ để chọn người dùng"
    />
  );
}

function DepartmentSelectControl({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [groups, setGroups] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(HPCORE_MEMBER_GROUPS_API)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch failed"))))
      .then((data: { groups: { id: string; name: string }[] }) => setGroups(data.groups ?? []))
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <p className="text-[12px] text-[var(--color-danger-red)]">
        Không tải được danh sách bộ phận từ account.hpcore.vn, vui lòng thử lại sau.
      </p>
    );
  }
  if (!groups) {
    return <p className="text-[12px] text-gray-400">Đang tải danh sách bộ phận...</p>;
  }

  return (
    <select
      className={selectClass}
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Chọn bộ phận</option>
      {groups.map((g) => (
        <option key={g.id} value={g.name}>
          {g.name}
        </option>
      ))}
    </select>
  );
}
