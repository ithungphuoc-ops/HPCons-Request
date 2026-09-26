"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, Loader2, Paperclip, Plus, Trash2, Upload, X } from "lucide-react";
import { DateLeadTimeZonesNote } from "@/components/request/DateLeadTimeZonesNote";
import { useRequestContext } from "@/context/RequestContext";
import {
  HPCORE_MEMBER_GROUPS_API,
  MAX_DIRECT_UPLOAD_FILE_SIZE,
  MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL,
} from "@/lib/constants";
import { uploadAttachments } from "@/lib/upload-client";
import type { TableColumnType } from "@/lib/types";
import {
  deserializeTableRows,
  formatCellForDisplay,
  isNumericColumnType,
  isRequiredTableColumn,
  isValidCellValue,
  normalizeRawForStorage,
  numericTypeForFieldDataType,
  parseCellToRaw,
  resolveTableColumnTypes,
  sumColumn,
  toWireTableRows,
  downloadTableTemplateFile,
  parseTableImportFile,
} from "@/lib/table-field";
import { evaluateConditionGroup } from "@/lib/server/conditions";
import { resolveComputedValue } from "@/lib/server/computed-fields";
import { computeManagerFlowNumbers } from "@/lib/manager-flow-numbering";
import { isSubmitterEditableStep } from "@/lib/approval-logic";
import {
  classifyDateLeadTimeByDate,
  countBusinessDaysBetween,
  dateLeadTimeBlockedMessage,
  DATE_LEAD_TIME_PAST_MESSAGE,
  DATE_LEAD_TIME_URGENT_NOTE,
  parseFieldDateOnly,
  resolveDateLeadTimeNumbers,
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
import type {
  FieldDataType,
  ProposalField,
  RequestAttachment,
  RequestInstance,
  TaggedUser,
} from "@/lib/types";

const MAX_ATTACHMENTS = 6;
// Tải thẳng lên R2 nên trần do CHÍNH mình chọn, không còn là 4,5MB của Vercel.
const MAX_ATTACHMENT_SIZE = MAX_DIRECT_UPLOAD_FILE_SIZE;

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
  const [deletingDraft, setDeletingDraft] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
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
        // Đã bị xoá thì KHÔNG nạp form — để nạp thì người dùng sửa rồi bấm gửi,
        // máy chủ chặn (409) nhưng họ phải gõ lại từ đầu mới biết. Báo ngay.
        if (data.request.deletedAt) {
          setSubmitError("Bản nháp này đã bị xoá. Liên hệ Owner/Admin nếu cần khôi phục.");
          return;
        }
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
    const now = new Date();
    const days = countBusinessDaysBetween(now, target);
    const status = classifyDateLeadTimeByDate(target, rule, now);

    setUrgentConfirmed((prev) => {
      if (!(field.id in prev)) return prev;
      const next = { ...prev };
      delete next[field.id];
      return next;
    });

    if (status === "past" || status === "blocked") {
      const message =
        status === "past"
          ? DATE_LEAD_TIME_PAST_MESSAGE
          : dateLeadTimeBlockedMessage(resolveDateLeadTimeNumbers(rule).blockDays);
      setErrors((prev) => ({ ...prev, [field.id]: message }));
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

  /**
   * Xoá bản nháp đang mở (Sếp yêu cầu 14/09/2026).
   *
   * Trước đây KHÔNG có đường nào xoá nháp trong giao diện: danh sách trỏ nháp
   * thẳng vào trang soạn này, còn nút "Xoá" thì nằm trong menu "Thêm" của
   * trang chi tiết — mà nháp không bao giờ mở được trang chi tiết. Hệ quả là
   * nháp chỉ có thể sinh ra chứ không mất đi (lúc làm việc này production
   * đang tồn 4 bản nháp không ai xoá được).
   *
   * Dùng lại đúng `DELETE /api/requests/[id]` sẵn có — xoá MỀM (ghi
   * `deletedAt`), dữ liệu vẫn nằm nguyên trong Firestore và khôi phục được
   * qua /api/requests/[id]/restore, nên bấm nhầm không mất gì vĩnh viễn.
   */
  const deleteDraft = async () => {
    if (!draftId || deletingDraft) return;
    setConfirmDeleteOpen(false);
    setDeletingDraft(true);
    setSubmitError(null);
    try {
      // Đọc lại trạng thái THẬT trước khi xoá: mở cùng bản nháp ở 2 tab, tab
      // kia bấm gửi thì tab này vẫn giữ loadedStatus "draft" từ lúc tải — xoá
      // đi sẽ xoá nhầm một đề xuất VỪA GỬI ĐI, trong khi hộp xác nhận vừa hứa
      // "chưa từng được gửi đi nên không ai nhận thông báo".
      const check = await fetch(`/api/requests/${draftId}`);
      if (check.ok) {
        const fresh = (await check.json()) as { request: RequestInstance };
        if (fresh.request.status !== "draft") {
          setSubmitError(
            "Đề xuất này không còn là bản nháp (có thể đã được gửi ở cửa sổ khác) — tải lại trang để xem trạng thái mới.",
          );
          setDeletingDraft(false);
          return;
        }
      }
      const res = await fetch(`/api/requests/${draftId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể xoá bản nháp.");
      }
      // `replace` chứ KHÔNG `push`/`back`: nó GỠ URL của bản nháp vừa xoá khỏi
      // lịch sử trình duyệt. Nếu để lại, bấm Back là mở lại đúng trang soạn đó
      // — và trước khi có chốt chặn ở PATCH, bấm gửi sẽ tạo ra "đề xuất ma"
      // (status pending nhưng deletedAt còn, không ai thấy).
      router.replace("/request/list?scope=mine");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
      setDeletingDraft(false);
    }
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
    // Một mốc "bây giờ" duy nhất cho cả vòng lặp — tránh 2 field cạnh nhau rơi
    // vào 2 ngày khác nhau nếu bấm Gửi đúng lúc nửa đêm.
    const submitStartedAt = new Date();
    if (group.requiresSubmissionForm !== false) {
      for (const field of visibleFields) {
        if (field.required && isEmptyValue(values[field.id])) {
          nextErrors[field.id] = "Trường này là bắt buộc.";
        }
        // TÍNH LẠI từ giá trị đang có, KHÔNG đọc `dateLeadTimeStatus` —
        // state đó chỉ được set khi người dùng tự chọn ngày qua
        // handleDateFieldChange. Mở lại BẢN NHÁP thì `values` được nạp sẵn
        // nhưng state kia vẫn rỗng: đọc state sẽ ra `undefined`, bỏ qua lỗi,
        // để đơn đi thẳng lên API rồi mới bị máy chủ chặn — lúc đó câu lỗi
        // rơi vào `submitError` chung chứ không chỉ đúng ô ngày. Lỗi thật,
        // CodeRabbit phát hiện trên PR #13 (13/09/2026).
        if (field.dateLeadTimeRule?.enabled) {
          const rawDate = values[field.id];
          const targetDate = typeof rawDate === "string" ? parseFieldDateOnly(rawDate) : null;
          const dateStatus = targetDate
            ? classifyDateLeadTimeByDate(targetDate, field.dateLeadTimeRule, submitStartedAt)
            : undefined;
          if (dateStatus === "past") nextErrors[field.id] = DATE_LEAD_TIME_PAST_MESSAGE;
          else if (dateStatus === "blocked")
            nextErrors[field.id] = dateLeadTimeBlockedMessage(
              resolveDateLeadTimeNumbers(field.dateLeadTimeRule).blockDays,
            );
        }
        // Cột "then chốt" (Tên hàng/Quy cách/ĐVT/Mục đích sử dụng/Số lượng) ở
        // field kiểu bảng — chặn sớm phía trình duyệt, máy chủ vẫn kiểm lại
        // (lib/server/requests.ts findInvalidTableRows) phòng ai gọi thẳng
        // API né qua chỗ này. Chỉ 2 hàm không phải "server-only" dùng lại
        // được ở đây — logic không tách chung 100% với server được vì
        // findInvalidTableRows nằm trong file "server-only".
        // Trường số đứng riêng: ô nhập là <input type="text"> (để hiện được
        // dấu phẩy ngăn hàng nghìn) nên mất hàng rào sẵn có của type="number"
        // — phải tự kiểm lại ở đây, nếu không chuỗi bậy sẽ lọt xuống Firestore.
        const numericFieldType = numericTypeForFieldDataType(field.dataType);
        if (numericFieldType) {
          const raw = values[field.id];
          const text = raw === null || raw === undefined ? "" : String(raw).trim();
          if (text !== "" && !isValidCellValue(text, numericFieldType)) {
            nextErrors[field.id] =
              numericFieldType === "int"
                ? `"${field.name}" phải là số nguyên, không âm.`
                : `"${field.name}" phải là số, không âm (dùng dấu chấm cho phần thập phân).`;
          }
        }
        if (field.dataType === "table" || field.dataType === "base_table") {
          const columns = field.tableColumns ?? [];
          const rows = deserializeTableRows(values[field.id]);
          // Kiểm theo KIỂU cột admin khai (13/09/2026) — trước đây chỉ soi cột
          // tên "Số lượng". Nhóm chưa khai kiểu vẫn ra đúng như cũ.
          const cellTypes = resolveTableColumnTypes(columns, field.tableColumnTypes);
          for (const row of rows) {
            if (!row.some((cell) => cell?.trim())) continue;
            columns.forEach((col, ci) => {
              const cell = row[ci] ?? "";
              if (isRequiredTableColumn(col) && !cell.trim()) {
                nextErrors[field.id] = `Bảng "${field.name}" còn dòng thiếu "${col}".`;
              } else if (cell.trim() && !isValidCellValue(cell, cellTypes[ci])) {
                const wanted = cellTypes[ci] === "int" ? "số nguyên" : "số";
                nextErrors[field.id] = `Bảng "${field.name}": "${col}" phải là ${wanted}.`;
              }
            });
          }
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
    // hành vi Base.vn thật) — chặn gửi nếu còn bước bắt chọn tay nào (gồm cả
    // "Linh động" có bật `submitterAssigns`, 28/08/2026) chưa được chọn. Tra
    // `group.approverSteps[s.index]` vì preview trả về từ API không mang theo
    // field cấu hình `submitterAssigns`, chỉ có `kind`.
    if (
      approverPreview.steps.some((s) => {
        const rawStep = group.approverSteps[s.index];
        return !!rawStep && isSubmitterEditableStep(rawStep) && !managerOverrides[s.index];
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
          <div className="mt-3 whitespace-pre-line rounded-[6px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] leading-relaxed text-emerald-900">
            {group.description}
          </div>
        )
      )}

      <div className="mt-5 rounded-[6px] border border-[var(--color-border)] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
            <label className="shrink-0 pt-1.5 text-[14px] font-semibold text-gray-700 sm:w-[220px]">
              Nhóm đề xuất
            </label>
            <div className="min-w-0 flex-1">
              <input className={disabledInputClass} value={group.name} disabled readOnly />
            </div>
          </div>

          {group.fields.length === 0 && (
            <p className="text-[14px] text-gray-400">Nhóm này chưa có trường dữ liệu nào.</p>
          )}
          {visibleFields
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((field) => (
              <FieldRow
                key={field.id}
                field={field}
                groupId={group.id}
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
              <p className="text-[14px] leading-relaxed text-gray-700">
                Trường &quot;<strong>{urgentPrompt.field.name}</strong>&quot; chỉ còn{" "}
                <strong>{urgentPrompt.days} ngày làm việc</strong> — việc này có thật sự gấp không?
              </p>
            </Modal>
          )}

          {approverPreview.status === "loading" && (
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="shrink-0 pt-1.5 text-[14px] font-semibold text-gray-700 sm:w-[220px]">Người duyệt</label>
              <p className="pt-1.5 text-[14px] text-gray-400">Đang xác định người duyệt...</p>
            </div>
          )}
          {approverPreview.status === "error" && (
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="shrink-0 pt-1.5 text-[14px] font-semibold text-gray-700 sm:w-[220px]">Người duyệt</label>
              <p className="pt-1.5 text-[14px] text-[var(--color-danger-red)]">{approverPreview.message}</p>
            </div>
          )}
          {approverPreview.status === "ok" && approverPreview.steps.length === 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
              <label className="shrink-0 pt-1.5 text-[14px] font-semibold text-gray-700 sm:w-[220px]">Người duyệt</label>
              <p className="pt-1.5 text-[14px] text-gray-400">Nhóm này chưa cấu hình người duyệt.</p>
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
              // `isSubmitterEditableStep()` (lib/approval-logic.ts, dùng chung
              // với lib/server/requests.ts) khớp cả "submitter_manager" lẫn
              // "flexible_approver" có bật `submitterAssigns` — dùng lại đúng
              // 1 định nghĩa, tránh 2 nơi tự lặp điều kiện rồi lệch nhau dần.
              const isEditableKind = !!rawStep && isSubmitterEditableStep(rawStep);
              const isFlexibleSubmitterAssign = step.kind === "flexible_approver" && isEditableKind;
              // Danh sách được PHÉP chọn khi giới hạn — rỗng = không giới hạn
              // (người gửi tag được bất kỳ ai), xem ApproverStepDef.
              const flexibleCandidates =
                isFlexibleSubmitterAssign && rawStep?.kind === "flexible_approver" && rawStep.users.length > 0
                  ? rawStep.users
                  : undefined;
              const displayUser = isEditableKind ? managerOverrides[step.index] : step.user;
              const editing = isEditableKind && (editingStepIndex === step.index || !displayUser);
              // "fixed"/"flexible_approver" (chế độ Admin gán sẵn): ưu tiên TÊN
              // BƯỚC do Admin đặt (`step.name`, vd "QL BP") — khớp cách Base.vn
              // thật hiển thị tên vai trò thay vì tên người; không có thì rơi về
              // chức danh/tên người được gán (tra qua users/{uid}.title lúc
              // gửi, xem withTitle() ở lib/server/requests.ts).
              const managerFlowNumber = managerFlowNumberByStepIndex.get(step.index);
              // "submitter_manager" giờ CŨNG ưu tiên `rawStep.name` (Admin tự đặt
              // ở "Cấu hình luồng duyệt" của nhóm, ô "Tên bước" — field này vốn
              // đã tồn tại sẵn cho "fixed"/"flexible_approver", chỉ là trang gửi
              // đề xuất trước đây không đọc nó cho kind này) — Sếp yêu cầu
              // 13/09/2026 muốn tự đổi chữ "Luồng duyệt 1" thành "Quản lý trực
              // tiếp" (hoặc bất kỳ chữ nào) mà không cần sửa code mỗi lần. Không
              // đặt tên thì rơi về "Luồng duyệt N" (mẫu có ≥2 bước cùng loại,
              // xem lib/manager-flow-numbering.ts) hoặc "Quản lý trực tiếp" như cũ.
              const rowLabel =
                step.kind === "submitter_manager"
                  ? rawStep?.name?.trim()
                    ? rawStep.name
                    : managerFlowNumber
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
                    <label className="pt-1.5 text-[14px] font-semibold text-gray-700 block">
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
                          ? "Chỉ được chọn người có trong danh sách được phép của bước này"
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
            <label className="shrink-0 pt-1.5 text-[14px] font-semibold text-gray-700 sm:w-[220px]">
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
                <p className="mt-1 text-[12px] text-gray-400">
                  Nhóm này chỉ Owner/Admin được sửa danh sách người theo dõi.
                </p>
              )}
            </div>
          </div>
        </div>

        {submitError && (
          <p className="mt-5 text-[14px] text-[var(--color-danger-red)]">{submitError}</p>
        )}

        {loadedStatus === "pending" && (
          <p className="mt-5 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
            Đề xuất này đang chờ duyệt — sửa và gửi lại sẽ xoá mọi quyết định duyệt đã có, duyệt lại từ đầu.
          </p>
        )}
        {/* flex-wrap: hàng này có tới 5 phần tử (Gửi / Lưu nháp / mốc giờ /
            Quay lại / Xoá bản nháp) — trên điện thoại không đủ chỗ một hàng. */}
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-5">
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
          {/* Nút này CHỈ quay lại trang trước, KHÔNG đụng gì tới dữ liệu. Chữ
              "Hủy bỏ" vì vậy chỉ đúng khi đang soạn mới (rời trang là mất phần
              vừa gõ). Còn khi đang sửa một đề xuất ĐÃ nằm trên máy chủ — nháp,
              bị trả lại, hay đang chờ duyệt — thì nó không huỷ gì cả, nên đổi
              thành "Quay lại". Việc xoá tách hẳn ra nút riêng bên phải. */}
          <button
            type="button"
            onClick={() => router.back()}
            className="text-[14px] text-gray-500 hover:underline"
          >
            {loadedStatus !== null ? "Quay lại" : "Hủy bỏ"}
          </button>
          {draftId && loadedStatus === "draft" && (
            <button
              type="button"
              onClick={() => setConfirmDeleteOpen(true)}
              disabled={submitting || savingDraft || deletingDraft}
              className="ml-auto flex items-center gap-1.5 text-[14px] font-medium text-[var(--color-danger-red)] hover:underline disabled:opacity-60"
            >
              <Trash2 size={15} />
              {deletingDraft ? "Đang xoá..." : "Xoá bản nháp"}
            </button>
          )}
        </div>

        {confirmDeleteOpen && (
          <Modal
            title="Xoá bản nháp"
            width={440}
            onClose={() => setConfirmDeleteOpen(false)}
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(false)}
                  className={cancelButtonClass}
                >
                  Giữ lại bản nháp
                </button>
                <button
                  type="button"
                  onClick={deleteDraft}
                  disabled={deletingDraft}
                  className="flex h-[38px] flex-1 items-center justify-center rounded bg-[var(--color-danger-red)] text-[14px] font-semibold text-white hover:brightness-95 disabled:opacity-60"
                >
                  Xoá bản nháp
                </button>
              </>
            }
          >
            <p className="text-[14px] leading-relaxed text-gray-700">
              Bản nháp này sẽ được gỡ khỏi danh sách của bạn. Đề xuất{" "}
              <strong>chưa từng được gửi đi</strong> nên không ai nhận được thông báo gì.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-gray-500">
              Dữ liệu vẫn được giữ lại, Owner/Admin khôi phục được nếu bấm nhầm.
            </p>
          </Modal>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  groupId,
  value,
  error,
  onChange,
  readOnlyComputed,
  dateLeadTimeFlagged,
  onTableColumnsChange,
}: {
  field: ProposalField;
  /** Chỉ dùng cho field có `suggestFromHistory` — biết đúng nhóm để xin gợi ý. */
  groupId: string;
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
  // Ngày đang chọn có rơi vào vùng CHẶN không — suy ra từ chính `value` đang
  // hiện chứ không nhận qua prop, để không bao giờ lệch với ô ngày bên cạnh.
  const ngayDangChon =
    field.dateLeadTimeRule?.enabled && typeof value === "string" ? parseFieldDateOnly(value) : null;
  const ngayBiChan =
    ngayDangChon !== null &&
    classifyDateLeadTimeByDate(ngayDangChon, field.dateLeadTimeRule) === "blocked";

  if (field.dataType === "section_title") {
    return (
      <div className="-mx-6 mt-1 border-b border-gray-100 bg-gray-50 px-6 py-2">
        <h2 className="text-[14px] font-semibold uppercase tracking-wide text-gray-500">
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
        className={`shrink-0 text-[14px] font-semibold text-gray-700 ${isTable ? "" : "pt-1.5 sm:w-[220px]"}`}
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
          groupId={groupId}
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
        {/* Ngày bị CHẶN → hiện ĐÚNG khối luật như trong thiết lập, không phải
            một câu rút gọn. Sếp yêu cầu 15/09/2026, nguyên văn: "ngoài phiếu đề
            nghị sẽ ra thông báo như trong thiết lập" — lần đầu tôi tự rút gọn
            thành một câu, sai với yêu cầu, Sếp bắt lỗi.
            Ngày QUÁ KHỨ thì vẫn là câu ngắn: nó không liên quan tới 2 con số cấu
            hình, kể cả 3 vùng ra là lạc đề.
            Tính lại trạng thái TẠI ĐÂY từ chính `value` đang hiện, không giữ
            state riêng, nên không có đường nào lệch với ô ngày bên cạnh. */}
        {ngayBiChan ? (
          <div className="mt-1.5">
            <DateLeadTimeZonesNote rule={field.dateLeadTimeRule} tone="danger" />
          </div>
        ) : (
          error && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{error}</p>
        )}
      </div>
    </div>
  );
}

function FieldControl({
  field,
  groupId,
  value,
  onChange,
  readOnlyComputed,
  onTableColumnsChange,
}: {
  field: ProposalField;
  groupId: string;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnlyComputed?: boolean;
  onTableColumnsChange?: (columns: string[]) => void;
}) {
  const [tableImportStatus, setTableImportStatus] = useState<string | null>(null);
  const tableFileInputRef = useRef<HTMLInputElement>(null);
  switch (field.dataType) {
    case "short_text":
      // contractCodeLookup ưu tiên hơn suggestFromHistory nếu Admin lỡ bật cả
      // 2 trên cùng field (ràng buộc cứng quan trọng hơn gợi ý mềm).
      if (field.contractCodeLookup && !readOnlyComputed) {
        return (
          <ShortTextWithContractCodeLookup
            groupId={groupId}
            fieldId={field.id}
            value={(value as string) ?? ""}
            placeholder={field.placeholder}
            onChange={onChange}
          />
        );
      }
      if (field.suggestFromHistory && !readOnlyComputed) {
        return (
          <ShortTextWithSuggestions
            groupId={groupId}
            fieldId={field.id}
            value={(value as string) ?? ""}
            placeholder={field.placeholder}
            onChange={onChange}
          />
        );
      }
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
    case "decimal":
    case "currency":
      return (
        <NumericFieldInput
          dataType={field.dataType}
          value={value}
          onChange={onChange}
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
            <label key={opt} className="flex items-center gap-2 text-[14px] text-gray-700">
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
      // Hàm dùng chung — xem lib/table-field.ts (tách ra 04/09/2026 để dùng lại
      // ở khu vực "Bổ sung sau duyệt" trên trang chi tiết đề xuất).
      const downloadTemplateFile = () =>
        downloadTableTemplateFile(columns, `mau-${field.code ?? field.name}.xlsx`);

      // "+ Thêm file" — đọc file đã điền qua hàm dùng chung `parseTableImportFile`
      // (thuần, không state), rồi ghi kết quả vào state cục bộ của trang soạn.
      // Cột LẠ tự thêm vào cấu hình cột của field (thuộc GROUP, áp dụng chung
      // nhóm — xem design.md của change add-request-detail-base-parity,
      // Decision #10; khác hành vi ở trang chi tiết sau duyệt, xem
      // add-post-approval-supplement Decision 3).
      const importTableFile = async (file: File) => {
        setTableImportStatus("Đang đọc file...");
        const result = await parseTableImportFile(file, columns, field.tableColumnTypes);
        if (tableFileInputRef.current) tableFileInputRef.current.value = "";
        if (!result.ok) {
          // Giữ đúng hành vi gốc: cột mới phát hiện được vẫn thêm vào cấu
          // hình bảng dù không có dòng dữ liệu nào để nhập (2 việc độc lập
          // nhau) — xem comment ở lib/table-field.ts, TableImportResult.
          if (result.newHeaders?.length) onTableColumnsChange?.(result.finalColumns!);
          setTableImportStatus(result.error);
          return;
        }
        const { newHeaders, finalColumns, newRows } = result;
        if (newHeaders.length > 0) onTableColumnsChange?.(finalColumns);
        // Bảng mới mở luôn có sẵn 1 dòng trống để người dùng gõ tay — nhập file
        // vào mà giữ nguyên dòng đó thì bảng dư 1 dòng trống ở đầu (Sếp báo
        // 13/09/2026). Bỏ MỌI dòng trống hoàn toàn đang có trước khi ghép dữ
        // liệu từ file; dòng đã gõ dở vẫn giữ nguyên.
        const keptOldRows = rows.filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""));
        // Dòng cũ cần bù thêm ô trống cho (các) cột mới vừa thêm để số cột khớp.
        const paddedOldRows = keptOldRows.map((r) => finalColumns.map((_, i) => r[i] ?? ""));
        onChange([...paddedOldRows, ...newRows]);
        setTableImportStatus(
          newHeaders.length > 0
            ? `Đã thêm ${newHeaders.length} cột mới + ${newRows.length} dòng dữ liệu.`
            : `Đã thêm ${newRows.length} dòng dữ liệu.`,
        );
      };

      const importButtons = (
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadTemplateFile}
            disabled={columns.length === 0}
            className="flex h-7 items-center gap-1 rounded border border-[var(--color-border)] px-2 text-[12px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <FileDown size={12} /> Tải file mẫu
          </button>
          <button
            type="button"
            onClick={() => tableFileInputRef.current?.click()}
            className="flex h-7 items-center gap-1 rounded border border-[var(--color-action-blue)] px-2 text-[12px] font-medium text-[var(--color-action-blue)] hover:bg-blue-50"
          >
            <Upload size={12} /> Nhập Excel theo file mẫu
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
          {tableImportStatus && <span className="text-[12px] text-gray-500">{tableImportStatus}</span>}
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

      const columnTypes = resolveTableColumnTypes(columns, field.tableColumnTypes);
      // Dòng TỔNG chỉ hiện khi có ít nhất 1 cột tiền tệ (Sếp chốt 13/09/2026).
      const hasMoneyColumn = columnTypes.includes("money");

      return (
        <div>
          {importButtons}
          <div className="overflow-hidden rounded border border-[var(--color-border)]">
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead className="border-b border-[var(--color-border)] bg-gray-100/80">
                  <tr>
                    <th className="w-9 px-2 py-2 text-left text-[12px] font-semibold text-gray-500">#</th>
                    {columns.map((col, i) => (
                      <th
                        key={i}
                        title={col}
                        className={`min-w-[110px] max-w-[240px] truncate border-l border-[var(--color-border)] px-2.5 py-2 text-[12px] font-semibold uppercase tracking-wide text-gray-600 ${
                          isNumericColumnType(columnTypes[i]) ? "text-right" : "text-left"
                        }`}
                      >
                        {col}
                        {isRequiredTableColumn(col) && (
                          <span className="text-[var(--color-danger-red)]"> *</span>
                        )}
                      </th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className="border-t border-[var(--color-border)] transition-colors hover:bg-blue-50/40"
                    >
                      <td className="px-2 py-1.5 text-center text-[12px] tabular-nums text-gray-500">
                        {rowIndex + 1}
                      </td>
                      {columns.map((colName, colIndex) => {
                        const columnType = columnTypes[colIndex];
                        const cellValue = row[colIndex] ?? "";
                        const invalid = cellValue.trim() !== "" && !isValidCellValue(cellValue, columnType);
                        return (
                          <td key={colIndex} className="border-l border-gray-100 px-1 py-1">
                            <TableCellInput
                              value={cellValue}
                              columnType={columnType}
                              columnName={colName}
                              invalid={invalid}
                              onCommit={(next) => updateCell(rowIndex, colIndex, next)}
                            />
                          </td>
                        );
                      })}
                      <td className="px-1 py-1 text-center">
                        {rows.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRow(rowIndex)}
                            aria-label="Xóa dòng"
                            className="text-gray-400 transition-colors hover:text-[var(--color-danger-red)]"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {hasMoneyColumn && (
                    <tr className="border-t border-[var(--color-border)] bg-gray-50/70 font-bold">
                      <td className="px-2 py-2 text-center text-[12px] text-gray-500" />
                      {columns.map((_, colIndex) => {
                        const total = columnTypes[colIndex] === "money" ? sumColumn(rows, colIndex) : null;
                        return (
                          <td
                            key={colIndex}
                            className={`border-l border-gray-100 px-2.5 py-2 text-[14px] ${
                              total === null ? "text-gray-500" : "text-right tabular-nums text-gray-900"
                            }`}
                          >
                            {total === null
                              ? colIndex === 0
                                ? "Tổng cộng"
                                : ""
                              : formatCellForDisplay(String(total), "money")}
                          </td>
                        );
                      })}
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addRow}
              className="flex w-full items-center justify-center gap-1 border-t border-[var(--color-border)] bg-gray-50/60 py-2 text-[12.5px] font-medium text-[var(--color-action-blue)] transition-colors hover:bg-blue-50"
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

/**
 * 1 ô của trường Bảng. Cột SỐ: đang gõ thì hiện SỐ THÔ cho dễ sửa (không chấm
 * phẩy giữa chừng làm nhảy con trỏ), rời ô mới định dạng lại; giá trị đẩy lên
 * cha LUÔN là số thô. Cột văn bản: y như ô thường.
 *
 * Tách thành component riêng vì cần state "đang gõ" — không đặt useState
 * trong thân `switch` của FieldControl được (vi phạm luật hook).
 */
/**
 * Ô nhập cho trường số đứng riêng (Số nguyên / Số thập phân / Tiền tệ).
 *
 * Tách thành component riêng vì cần `useState` — không đặt hook trong `switch`
 * của `FieldControl` được. Cùng lý do đã tách `TableCellInput` bên dưới, và cố
 * ý chạy đúng một kiểu với nó để người dùng không phải học 2 cách gõ số:
 *   - Đang gõ  → hiện số THÔ, dễ sửa, không bị dấu phẩy nhảy loạn dưới con trỏ.
 *   - Rời ô    → hiện bản đã định dạng ("74,610,000 VNĐ").
 *
 * GIÁ TRỊ LƯU XUỐNG vẫn là KIỂU SỐ như trước, không phải chuỗi — điều kiện hiển
 * thị field và công thức đều so sánh sau khi ép kiểu số (xem ProposalField.
 * condition ở lib/types.ts), lưu thành chuỗi là vỡ chỗ đó. Chỉ khi người dùng
 * gõ thứ không phải số thì mới giữ nguyên chuỗi họ gõ, để phần kiểm tra lúc gửi
 * báo lỗi và họ thấy được mình đã gõ gì.
 */
function NumericFieldInput({
  dataType,
  value,
  onChange,
}: {
  dataType: FieldDataType;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const columnType = numericTypeForFieldDataType(dataType) ?? "decimal";
  const [draft, setDraft] = useState<string | null>(null);
  const stored = value === null || value === undefined ? "" : String(value);
  const shown = draft ?? formatCellForDisplay(stored, columnType);

  const commit = () => {
    const parsed = parseCellToRaw(draft ?? "", columnType);
    setDraft(null);
    if (parsed === "") {
      onChange("");
      return;
    }
    // Chuẩn hoá trước khi lưu để số lưu xuống KHỚP số hiện ra — xem
    // normalizeRawForStorage() ở lib/table-field.ts.
    const raw = normalizeRawForStorage(parsed, columnType);
    onChange(isValidCellValue(raw, columnType) ? Number(raw) : raw);
  };

  return (
    <input
      type="text"
      inputMode={columnType === "int" ? "numeric" : "decimal"}
      className={inputClass}
      value={shown}
      onFocus={() => setDraft(stored)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
    />
  );
}

function TableCellInput({
  value,
  columnType,
  columnName,
  invalid,
  onCommit,
}: {
  value: string;
  columnType: TableColumnType;
  columnName: string;
  invalid: boolean;
  onCommit: (next: string) => void;
}) {
  const numeric = isNumericColumnType(columnType);
  // null = không focus -> hiện bản đã định dạng.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (numeric ? formatCellForDisplay(value, columnType) : value);

  return (
    <input
      value={shown}
      onFocus={() => setDraft(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        if (!numeric) onCommit(e.target.value);
      }}
      onBlur={(e) => {
        if (numeric) onCommit(normalizeRawForStorage(parseCellToRaw(e.target.value, columnType), columnType));
        setDraft(null);
      }}
      inputMode={columnType === "int" ? "numeric" : numeric ? "decimal" : undefined}
      title={invalid ? `"${columnName}" phải là ${columnType === "int" ? "số nguyên" : "số"}` : undefined}
      className={`h-9 w-full rounded border bg-transparent px-2 text-[14px] text-gray-900 outline-none placeholder:text-gray-400 focus:border-[var(--color-action-blue)] focus:bg-white ${
        invalid
          ? "border-[var(--color-danger-red)] bg-red-50"
          : "border-transparent hover:border-[var(--color-border)] hover:bg-white"
      } ${numeric ? "text-right tabular-nums" : ""}`}
    />
  );
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
      setError(
        `Tệp "${tooBig.name}" vượt quá ${MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL} — tách bớt hoặc nén lại rồi gửi.`,
      );
      return;
    }

    setUploading(true);
    setError(null);
    try {
      // Tải THẲNG lên R2 bằng link ký sẵn (không qua Vercel nên không dính
      // trần 4,5MB) — xem lib/upload-client.ts.
      const uploaded = await uploadAttachments(files);
      onChange([...attachments, ...uploaded]);
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
      <p className="text-[12px] text-gray-400">
        Tối đa {MAX_ATTACHMENTS} tệp, mỗi tệp không quá {MAX_DIRECT_UPLOAD_FILE_SIZE_LABEL}.
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

/**
 * Ô nhập tự do CÓ GỢI Ý (Sếp chốt 17/09/2026) — tải các giá trị đã từng
 * nhập cho ĐÚNG field này trong CÙNG nhóm (GET /api/groups/[id]/field-
 * suggestions), hiện qua <datalist> chuẩn của trình duyệt: vẫn gõ tự do
 * bình thường, gợi ý chỉ là 1 dropdown tuỳ chọn hiện thêm bên dưới ô nhập,
 * không ép chọn. Dùng chung khuôn mẫu input+datalist đã có ở "Phân loại"
 * lúc tạo nhóm (CreateGroupModal.tsx) — khác ở nguồn dữ liệu là ĐỘNG (đọc
 * từ đề xuất thật) thay vì mảng cố định.
 */
function ShortTextWithSuggestions({
  groupId,
  fieldId,
  value,
  placeholder,
  onChange,
}: {
  groupId: string;
  fieldId: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const listId = `field-suggest-${fieldId}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/groups/${groupId}/field-suggestions?fieldId=${fieldId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { suggestions?: string[] } | null) => {
        if (!cancelled) setSuggestions(data?.suggestions ?? []);
      })
      .catch(() => {
        // Lỗi tải gợi ý không chặn nhập liệu — ô nhập vẫn dùng bình thường như
        // short_text thường, chỉ là không có gợi ý lần này.
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, fieldId]);

  return (
    <>
      <input
        className={inputClass}
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

/**
 * Field bật `contractCodeLookup` — KHÁC `ShortTextWithSuggestions` ở chỗ ép
 * buộc: gõ xong rời khỏi ô mà không khớp đúng 1 Số Hợp Đồng CĐT thật thì báo
 * lỗi ngay tại chỗ. Đây CHỈ là hỗ trợ trải nghiệm — hàng rào thật nằm ở
 * `findInvalidContractCodeFields` phía máy chủ (lib/server/requests.ts), gọi
 * lúc gửi chính thức, không tin danh sách đã tải ở đây.
 */
function ShortTextWithContractCodeLookup({
  groupId,
  fieldId,
  value,
  placeholder,
  onChange,
}: {
  groupId: string;
  fieldId: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<{ code: string; project: string }[]>([]);
  const [mismatch, setMismatch] = useState(false);
  const listId = `field-contract-${fieldId}`;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/groups/${groupId}/contract-code-suggestions?fieldId=${fieldId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { suggestions?: { code: string; project: string }[] } | null) => {
        if (!cancelled) setSuggestions(data?.suggestions ?? []);
      })
      .catch(() => {
        // Lỗi tải danh sách không chặn nhập liệu ngay — validate thật vẫn
        // chạy ở máy chủ lúc gửi chính thức.
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, fieldId]);

  return (
    <>
      <input
        className={mismatch ? `${inputClass} border-red-400 focus:border-red-500` : inputClass}
        list={listId}
        value={value}
        placeholder={placeholder ?? "Gõ số hợp đồng…"}
        onChange={(e) => {
          setMismatch(false);
          onChange(e.target.value);
        }}
        onBlur={() => {
          const v = value.trim();
          if (!v) {
            setMismatch(false);
            return;
          }
          setMismatch(!suggestions.some((s) => s.code === v));
        }}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s.code} value={s.code}>
            {s.project}
          </option>
        ))}
      </datalist>
      {mismatch && (
        <p className="mt-1 text-[12px] text-red-600">
          Chưa đúng số hợp đồng nào trong hệ thống Công nợ — chọn 1 dòng trong gợi ý.
        </p>
      )}
    </>
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
