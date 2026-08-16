"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, Paperclip, Plus, Trash2, X } from "lucide-react";
import { useRequestContext } from "@/context/RequestContext";
import { HPCORE_MEMBER_GROUPS_API } from "@/lib/constants";
import { deserializeTableRows, toWireTableRows } from "@/lib/table-field";
import { evaluateConditionGroup } from "@/lib/server/conditions";
import { resolveComputedValue } from "@/lib/server/computed-fields";
import TagUserInput from "@/components/shared/TagUserInput";
import DatePicker from "@/components/ui/DatePicker";
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
  kind: "fixed" | "submitter_manager";
  user: TaggedUser | null;
  error?: string;
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
  const { getGroupById } = useRequestContext();
  const group = getGroupById(params.groupId);

  const [draftId, setDraftId] = useState<string | null>(searchParams.get("draftId"));
  // Trạng thái GỐC của đề xuất đang sửa (null = đang tạo mới, không phải sửa
  // draftId nào) — "pending" thì ẩn "Lưu nháp" (không còn khái niệm nháp ở
  // trạng thái này) và đổi nhãn nút chính, xem loadedStatus bên dưới.
  const [loadedStatus, setLoadedStatus] = useState<RequestInstance["status"] | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [followers, setFollowers] = useState<TaggedUser[]>(group?.followers ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
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
  const [editingStepIndex, setEditingStepIndex] = useState<number | null>(null);

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
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    // Ô "Quản lý trực tiếp" LUÔN bắt chọn tay (không tự điền sẵn, khớp đúng
    // hành vi Base.vn thật) — chặn gửi nếu còn bước submitter_manager nào
    // chưa được chọn.
    if (
      approverPreview.status === "ok" &&
      approverPreview.steps.some((s) => s.kind === "submitter_manager" && !managerOverrides[s.index])
    ) {
      setSubmitError("Vui lòng chọn quản lý trực tiếp trước khi gửi đề xuất.");
      return;
    }

    const managerOverridesPayload: Record<number, string> = {};
    for (const [index, user] of Object.entries(managerOverrides)) {
      managerOverridesPayload[Number(index)] = user.id;
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
                onChange={(value) => setFieldValue(field.id, value)}
                // Field "tự tính" đang tính ra được giá trị (có nhánh khớp) →
                // khoá không cho gõ tay; không nhánh nào khớp → cho gõ tay như
                // field thường (xem specs/computed-field-values).
                readOnlyComputed={
                  !!field.computedFrom &&
                  resolveComputedValue(field.computedFrom, values, group.fields) !== null
                }
              />
            ))}

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
              // gửi nếu người dùng bỏ trống (xem lib/server/requests.ts). "fixed"
              // thì luôn hiện đúng người server trả về (không có gì để "chọn").
              const displayUser = step.kind === "fixed" ? step.user : managerOverrides[step.index];
              const editing = step.kind === "submitter_manager" && (editingStepIndex === step.index || !displayUser);
              // "fixed": nhãn là CHỨC DANH người được gán (vd "Trưởng phòng Kỹ
              // thuật Thi công Khối 2"), không phải tên suông — khớp cách
              // Base.vn thật hiển thị, tra qua users/{uid}.title lúc gửi (xem
              // withTitle() ở lib/server/requests.ts). Không có chức danh thì
              // dùng tạm tên.
              const rowLabel =
                step.kind === "submitter_manager" ? "Quản lý trực tiếp" : (displayUser?.title ?? displayUser?.name ?? "Người duyệt");

              return (
                <div key={step.index} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                  <div className="shrink-0 sm:w-[220px]">
                    <label className="pt-1.5 text-[13px] font-semibold text-gray-700 block">
                      {rowLabel}
                      {step.kind === "submitter_manager" && " *"}
                    </label>
                    {step.kind === "submitter_manager" && (
                      <p className="text-[12px] text-gray-400">
                        Bạn phải thông báo cho người quản lý trực tiếp của mình về đề xuất này
                      </p>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pt-1.5">
                    {step.kind === "fixed" ? (
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
                          placeholder="Sử dụng @ để tag quản lý trực tiếp"
                          directoryUrl="/api/directory"
                          browseAllLabel="Chọn quản lý trực tiếp"
                          browseAllDirectoryUrl="/api/directory/managers"
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
              <TagUserInput value={followers} onChange={setFollowers} />
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
            disabled={submitting || savingDraft}
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
}: {
  field: ProposalField;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
  /** true = field "tự tính" đang tính ra được giá trị → ô nhập chỉ đọc. */
  readOnlyComputed?: boolean;
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
      <div className="min-w-0 flex-1">
        <FieldControl field={field} value={value} onChange={onChange} readOnlyComputed={readOnlyComputed} />
        {readOnlyComputed && (
          <p className="mt-1 text-[12px] text-gray-400">
            Tự động ghép từ trường khác — thay đổi các trường liên quan để cập nhật.
          </p>
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
}: {
  field: ProposalField;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnlyComputed?: boolean;
}) {
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

      if (columns.length === 0) {
        return (
          <p className="text-[12px] text-gray-400">
            Trường bảng này chưa cấu hình cột — vào Mẫu biểu đề xuất để thêm cột.
          </p>
        );
      }

      return (
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
