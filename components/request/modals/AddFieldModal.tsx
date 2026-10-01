"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import Modal from "@/components/shared/Modal";
import {
  cancelButtonClass,
  confirmButtonClass,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/shared/form-styles";
import { useRequestContext } from "@/context/RequestContext";
import { CONDITION_ELIGIBLE_TYPES, ConditionEditor } from "@/components/request/ApproverStepsEditor";
import {
  fieldDataTypeLabels,
  type ComputedTemplateBranch,
  type ConditionGroup,
  type FieldDataType,
  type TableColumnType,
} from "@/lib/types";
import { DateLeadTimeZonesNote } from "@/components/request/DateLeadTimeZonesNote";
import {
  DATE_LEAD_TIME_DEFAULT_BLOCK_DAYS,
  DATE_LEAD_TIME_DEFAULT_STANDARD_DAYS,
  DATE_LEAD_TIME_MAX_DAYS,
  resolveDateLeadTimeNumbers,
  validateDateLeadTimeNumbers,
} from "@/lib/date-lead-time";
import {
  resolveTableColumnTypes,
  TABLE_COLUMN_TYPE_LABELS,
  TABLE_COLUMN_TYPES,
} from "@/lib/table-field";
import { slugifyFieldName } from "@/lib/print-template";
import { validateFieldName, validateFieldOptions } from "@/lib/validation";
import {
  EXTERNAL_CODE_SOURCE_FIELDS,
  EXTERNAL_CODE_SOURCE_ID_LIST,
  EXTERNAL_CODE_SOURCE_LABELS,
  resolveExternalCodeLookup,
} from "@/lib/external-code-source-labels";
import type { ExternalCodeSourceId } from "@/lib/types";

const dataTypes = Object.keys(fieldDataTypeLabels) as FieldDataType[];
const choiceTypes: FieldDataType[] = ["single_choice", "multiple_choice"];
const tableTypes: FieldDataType[] = ["table", "base_table"];
/** Chỉ field văn bản mới cấu hình được "tự động ghép giá trị từ trường khác". */
const computedEligibleTypes: FieldDataType[] = ["short_text", "paragraph"];
/** Chỉ field ngày mới cấu hình được ràng buộc "ngày cần cấp" (dateLeadTimeRule). */
const dateLeadTimeEligibleTypes: FieldDataType[] = ["date", "datetime"];
/** Chỉ field văn bản ngắn mới bật được "gợi ý từ lịch sử" (paragraph để văn
 * bản dài, gợi ý cả đoạn văn không hợp lý — Sếp chốt 17/09/2026). */
const suggestFromHistoryEligibleTypes: FieldDataType[] = ["short_text"];
/** Chỉ field văn bản ngắn mới bật được ràng buộc mã tham chiếu ngoài (cùng lý
 * do suggestFromHistoryEligibleTypes) — xem
 * openspec/changes/add-external-code-lookup-picker. */
const externalCodeLookupEligibleTypes: FieldDataType[] = ["short_text"];
/** Admin tự gõ 2 mốc (Sếp chốt "phương án C" 13/09/2026) — không còn danh sách cứng. */

export default function AddFieldModal() {
  const { addFieldModalGroupId, editingField, closeAddFieldModal, getGroupById, addField, updateField } =
    useRequestContext();

  const group = addFieldModalGroupId ? getGroupById(addFieldModalGroupId) : undefined;
  const isEditMode = editingField !== null;

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [dataType, setDataType] = useState<FieldDataType>("short_text");
  const [required, setRequired] = useState(false);
  const [helpText, setHelpText] = useState("");
  const [afterFieldId, setAfterFieldId] = useState<string>("");
  const [options, setOptions] = useState<string[]>([""]);
  const [tableColumns, setTableColumns] = useState<string[]>([""]);
  // Kiểu của từng cột, SONG SONG index với tableColumns (Sếp chốt 13/09/2026).
  const [tableColumnTypes, setTableColumnTypes] = useState<TableColumnType[]>(["text"]);
  const [formula, setFormula] = useState("");
  const [visibleWhen, setVisibleWhen] = useState<ConditionGroup | undefined>(undefined);
  // null = tắt "tự động ghép giá trị"; mảng (kể cả rỗng) = đang bật, mỗi phần
  // tử là 1 nhánh { điều kiện tuỳ chọn + mẫu chuỗi ${ma_truong} }.
  const [computedBranches, setComputedBranches] = useState<ComputedTemplateBranch[] | null>(null);
  const [dateLeadTimeEnabled, setDateLeadTimeEnabled] = useState(false);
  const [suggestFromHistory, setSuggestFromHistory] = useState(false);
  // Ràng buộc mã tham chiếu ngoài (Sếp chốt 30/09/2026 — xem design.md
  // Decision #4/#6 của change add-external-code-lookup-picker): 4 bước —
  // "choose-source" (chọn thẻ nguồn) → "choose-field" (chọn ĐÚNG 1 field của
  // nguồn đó để khớp — thay bản đầu "khớp 1 trong nhiều field" dễ gây nhầm)
  // → "preview" (xem mẫu thật, cột đã chọn tô nổi bật) → "confirmed" (đã xác
  // nhận). `lookupSourceId`/`lookupMatchField` là lựa chọn ĐANG CHỌN (tạm,
  // có thể huỷ); `confirmedSourceId`/`confirmedMatchField` là giá trị ĐÃ XÁC
  // NHẬN (thứ thật sự gửi lên khi lưu field).
  const [lookupEnabled, setLookupEnabled] = useState(false);
  const [lookupStep, setLookupStep] = useState<"choose-source" | "choose-field" | "preview" | "confirmed">(
    "choose-source",
  );
  const [lookupSourceId, setLookupSourceId] = useState<ExternalCodeSourceId | null>(null);
  const [lookupMatchField, setLookupMatchField] = useState<string | null>(null);
  const [confirmedSourceId, setConfirmedSourceId] = useState<ExternalCodeSourceId | null>(null);
  const [confirmedMatchField, setConfirmedMatchField] = useState<string | null>(null);
  const [previewSample, setPreviewSample] = useState<Record<string, string> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Tự động điền từ trường khác (Sếp yêu cầu 30/09/2026) — MÂU THUẪN với
  // ràng buộc mã tham chiếu ngoài trên CÙNG field, UI chỉ cho bật 1 trong 2
  // (xem `lookupEnabled`/`autofillEnabled` không bao giờ cùng true).
  const [autofillEnabled, setAutofillEnabled] = useState(false);
  const [autofillSourceFieldId, setAutofillSourceFieldId] = useState<string | null>(null);
  const [autofillPullField, setAutofillPullField] = useState<string | null>(null);
  // Giữ dạng chuỗi để người dùng xoá trắng ô mà không bị nhảy về 0; validate lúc lưu.
  const [dateLeadTimeBlockDays, setDateLeadTimeBlockDays] = useState(String(DATE_LEAD_TIME_DEFAULT_BLOCK_DAYS));
  const [dateLeadTimeStandardDays, setDateLeadTimeStandardDays] = useState(
    String(DATE_LEAD_TIME_DEFAULT_STANDARD_DAYS),
  );
  const [errors, setErrors] = useState<{
    name?: string;
    options?: string;
    code?: string;
    computed?: string;
    dateLeadTime?: string;
  }>({});

  const conditionFields = useMemo(
    () =>
      group?.fields.filter((f) => f.id !== editingField?.id && f.code && CONDITION_ELIGIBLE_TYPES.has(f.dataType)) ??
      [],
    [group, editingField],
  );

  const existingNames = useMemo(
    () =>
      group?.fields
        .filter((f) => f.id !== editingField?.id)
        .map((f) => f.name.trim().toLowerCase()) ?? [],
    [group, editingField],
  );

  const existingCodes = useMemo(
    () =>
      new Set(
        group?.fields.filter((f) => f.id !== editingField?.id && f.code).map((f) => f.code as string) ?? [],
      ),
    [group, editingField],
  );

  const autofillSourceOptions = useMemo(
    () => group?.fields.filter((f) => f.id !== editingField?.id && resolveExternalCodeLookup(f) !== null) ?? [],
    [group, editingField],
  );

  const autofillPullFieldOptions = useMemo(() => {
    if (!autofillSourceFieldId) return [];
    const sourceField = group?.fields.find((f) => f.id === autofillSourceFieldId);
    const lookup = sourceField ? resolveExternalCodeLookup(sourceField) : null;
    return lookup ? EXTERNAL_CODE_SOURCE_FIELDS[lookup.sourceId] : [];
  }, [autofillSourceFieldId, group]);

  // Admin có thể bấm lại "← Quay lại" rồi chọn field/nguồn KHÁC trong lúc
  // request cũ chưa kịp trả lời — nếu không chặn, response CŨ trả về sau có
  // thể đè preview của lựa chọn MỚI (CodeRabbit PR #58). `previewRequestRef`
  // giữ "vé" của lượt gọi mới nhất; chỉ áp dụng kết quả nếu vé lúc trả lời
  // vẫn còn là vé mới nhất lúc đó.
  const previewRequestRef = useRef(0);

  // Xem trước mã trường SẼ được gán khi tạo mới (Sếp phản hồi 29/09/2026: gõ
  // "Tên trường" xong phải tắt-mở lại (chuyển sang chế độ sửa) mới thấy được
  // mã trường server đã gán — giờ hiện luôn lúc đang gõ). Chỉ dùng ở chế độ
  // TẠO MỚI — chế độ SỬA đã có ô "Mã trường" riêng cho tự tay đổi (xem dưới),
  // không cần tính lại. Đồng bộ ĐÚNG thuật toán server dùng thật
  // (ensureFieldCodes trong lib/print-template.ts): slug từ tên, thêm hậu tố
  // _2/_3... nếu trùng mã trường khác đã có trong nhóm.
  const previewCode = useMemo(() => {
    const base = slugifyFieldName(name) || "truong";
    if (!existingCodes.has(base)) return base;
    let suffix = 2;
    let candidate = `${base}_${suffix}`;
    while (existingCodes.has(candidate)) {
      suffix += 1;
      candidate = `${base}_${suffix}`;
    }
    return candidate;
  }, [name, existingCodes]);

  const resetForm = () => {
    setName("");
    setCode("");
    setDataType("short_text");
    setRequired(false);
    setHelpText("");
    setAfterFieldId("");
    setOptions([""]);
    setTableColumns([""]);
    setTableColumnTypes(["text"]);
    setFormula("");
    setVisibleWhen(undefined);
    setComputedBranches(null);
    setDateLeadTimeEnabled(false);
    setDateLeadTimeBlockDays(String(DATE_LEAD_TIME_DEFAULT_BLOCK_DAYS));
    setDateLeadTimeStandardDays(String(DATE_LEAD_TIME_DEFAULT_STANDARD_DAYS));
    setSuggestFromHistory(false);
    setLookupEnabled(false);
    setLookupStep("choose-source");
    setLookupSourceId(null);
    setLookupMatchField(null);
    setConfirmedSourceId(null);
    setConfirmedMatchField(null);
    setPreviewSample(null);
    setPreviewError(null);
    setAutofillEnabled(false);
    setAutofillSourceFieldId(null);
    setAutofillPullField(null);
    setErrors({});
  };

  useEffect(() => {
    if (!addFieldModalGroupId) return;
    if (editingField) {
      setName(editingField.name);
      setCode(editingField.code ?? "");
      setDataType(editingField.dataType);
      setRequired(editingField.required);
      setHelpText(editingField.helpText ?? "");
      setOptions(editingField.options?.length ? editingField.options : [""]);
      const editingColumns = editingField.tableColumns?.length ? editingField.tableColumns : [""];
      setTableColumns(editingColumns);
      // Cột cũ chưa khai kiểu -> suy ra (văn bản, riêng "Số lượng" là số thập phân).
      setTableColumnTypes(resolveTableColumnTypes(editingColumns, editingField.tableColumnTypes));
      setFormula(editingField.formula ?? "");
      setVisibleWhen(editingField.visibleWhen);
      setComputedBranches(editingField.computedFrom?.branches ?? null);
      setDateLeadTimeEnabled(editingField.dateLeadTimeRule?.enabled ?? false);
      setSuggestFromHistory(editingField.suggestFromHistory ?? false);
      {
        // Field cũ có `contractCodeLookup` (chưa migrate) hoặc field mới có
        // `externalCodeLookup` — cả 2 đều hiện thẳng dạng tóm tắt đã chọn,
        // KHÔNG bắt Admin chọn lại từ đầu (task 4.5).
        const resolved = resolveExternalCodeLookup(editingField);
        setLookupEnabled(resolved !== null);
        setConfirmedSourceId(resolved?.sourceId ?? null);
        setConfirmedMatchField(resolved?.matchField ?? null);
        setLookupStep(resolved !== null ? "confirmed" : "choose-source");
        setLookupSourceId(null);
        setLookupMatchField(null);
        setPreviewSample(null);
        setPreviewError(null);

        const autofill = editingField.autofillFromLookup;
        setAutofillEnabled(!!autofill);
        setAutofillSourceFieldId(autofill?.sourceFieldId ?? null);
        setAutofillPullField(autofill?.pullField ?? null);
      }
      // Trường ngày lưu trước 13/09/2026 chưa có blockDays -> điền mặc định 2.
      const leadTimeNums = resolveDateLeadTimeNumbers(editingField.dateLeadTimeRule);
      setDateLeadTimeBlockDays(String(leadTimeNums.blockDays));
      setDateLeadTimeStandardDays(String(leadTimeNums.standardDays));
      setErrors({});
    } else {
      resetForm();
    }
  }, [addFieldModalGroupId, editingField]);

  if (!addFieldModalGroupId || !group) return null;

  const handleClose = () => {
    closeAddFieldModal();
    resetForm();
  };

  const handleSubmit = () => {
    const nameCheck = validateFieldName(name);
    const cleanedOptions = options.map((o) => o.trim()).filter(Boolean);
    const optionsCheck = validateFieldOptions(dataType, cleanedOptions);

    if (!nameCheck.valid || !optionsCheck.valid) {
      setErrors({ name: nameCheck.error, options: optionsCheck.error });
      return;
    }

    if (existingNames.includes(name.trim().toLowerCase())) {
      setErrors({ name: "Tên trường phải duy nhất trong một nhóm (trùng tên trường đã có)." });
      return;
    }

    let normalizedCode: string | undefined;
    if (isEditMode) {
      normalizedCode = slugifyFieldName(code);
      if (!normalizedCode) {
        setErrors({ code: "Mã trường không được để trống." });
        return;
      }
      if (existingCodes.has(normalizedCode)) {
        setErrors({ code: `Mã trường "${normalizedCode}" đã dùng cho trường khác trong nhóm này.` });
        return;
      }
    }

    // Đang bật "tự động ghép giá trị": mọi nhánh phải có mẫu chuỗi khác rỗng
    // (server còn validate sâu hơn — mã field có thật, không tham chiếu field
    // tự tính khác — nhưng chặn sớm lỗi hiển nhiên ngay tại đây cho dễ hiểu).
    const cleanedBranches =
      computedEligibleTypes.includes(dataType) && computedBranches !== null
        ? computedBranches
            .map((b) => ({ ...b, template: b.template.trim() }))
            .filter((b) => b.template)
        : null;
    if (computedBranches !== null && computedEligibleTypes.includes(dataType) && (!cleanedBranches || cleanedBranches.length === 0)) {
      setErrors({ computed: "Đang bật tự động ghép giá trị — cần ít nhất 1 nhánh có mẫu chuỗi." });
      return;
    }

    const leadTimeNumbers = {
      blockDays: Number(dateLeadTimeBlockDays),
      standardDays: Number(dateLeadTimeStandardDays),
    };
    if (dateLeadTimeEligibleTypes.includes(dataType) && dateLeadTimeEnabled) {
      const leadTimeError = validateDateLeadTimeNumbers(leadTimeNumbers);
      if (leadTimeError) {
        setErrors({ dateLeadTime: leadTimeError });
        return;
      }
    }
    // Bỏ cột không tên, GIỮ ĐÚNG cặp tên–kiểu theo index (lọc rời 2 mảng là lệch).
    const cleanedColumns = tableColumns
      .map((name, i) => ({ name: name.trim(), type: tableColumnTypes[i] ?? "text" }))
      .filter((c) => c.name);

    setErrors({});
    const fieldData = {
      name: name.trim(),
      code: normalizedCode,
      dataType,
      required,
      helpText: helpText.trim() || undefined,
      options: choiceTypes.includes(dataType) ? cleanedOptions : undefined,
      tableColumns: tableTypes.includes(dataType) ? cleanedColumns.map((c) => c.name) : undefined,
      tableColumnTypes: tableTypes.includes(dataType) ? cleanedColumns.map((c) => c.type) : undefined,
      formula: dataType === "formula" ? formula : undefined,
      visibleWhen,
      computedFrom: cleanedBranches && cleanedBranches.length > 0 ? { branches: cleanedBranches } : undefined,
      dateLeadTimeRule:
        dateLeadTimeEligibleTypes.includes(dataType) && dateLeadTimeEnabled
          ? { enabled: true as const, ...leadTimeNumbers }
          : undefined,
      suggestFromHistory:
        suggestFromHistoryEligibleTypes.includes(dataType) && suggestFromHistory ? true : undefined,
      // Field TẠO MỚI/SỬA LẠI qua UI này luôn ghi `externalCodeLookup` (không
      // ghi `contractCodeLookup` nữa) — field cũ trên production giữ nguyên
      // cờ cũ cho tới khi có ai sửa lại (Decision 8 design.md).
      externalCodeLookup:
        externalCodeLookupEligibleTypes.includes(dataType) && lookupEnabled && confirmedSourceId && confirmedMatchField
          ? { sourceId: confirmedSourceId, matchField: confirmedMatchField }
          : undefined,
      contractCodeLookup: undefined,
      // Mâu thuẫn với `externalCodeLookup` trên CÙNG field — UI chỉ cho bật 1
      // trong 2 (checkbox mỗi bên tự tắt bên còn lại), nên không cần chặn lại
      // ở đây. NHƯNG vẫn phải đối chiếu lại 2 giá trị đã chọn với danh sách
      // HIỆN TẠI (CodeRabbit PR #57): field nguồn có thể đã bị xoá/đổi mất
      // ràng buộc mã tham chiếu ngoài, hoặc đổi sang nguồn khác khiến
      // `pullField` cũ không còn hợp lệ — dropdown lúc đó tự hiện placeholder
      // nên Admin không thấy được vấn đề, nếu không chặn ở đây sẽ lưu nhầm 1
      // cấu hình đã lỗi thời (field đích sẽ luôn bị điền rỗng khi gửi thật).
      autofillFromLookup:
        externalCodeLookupEligibleTypes.includes(dataType) &&
        autofillEnabled &&
        autofillSourceFieldId &&
        autofillPullField &&
        autofillSourceOptions.some((f) => f.id === autofillSourceFieldId) &&
        autofillPullFieldOptions.some((f) => f.key === autofillPullField)
          ? { sourceFieldId: autofillSourceFieldId, pullField: autofillPullField }
          : undefined,
    };

    if (isEditMode && editingField) {
      updateField(group.id, editingField.id, fieldData);
    } else {
      addField(group.id, fieldData, afterFieldId || null);
    }
    resetForm();
  };

  // Bước 1→2: bấm 1 thẻ nguồn — sang bước chọn ĐÚNG 1 field để khớp. Danh
  // sách field cho phép chọn HARD-CODE trong EXTERNAL_CODE_SOURCE_FIELDS,
  // không đọc động từ document mẫu (an toàn: không lộ field tài chính nằm
  // chung document, vd `totalAfterTax`).
  const chooseLookupSourceCard = (sourceId: ExternalCodeSourceId) => {
    setLookupSourceId(sourceId);
    setLookupMatchField(null);
    setLookupStep("choose-field");
    setPreviewSample(null);
    setPreviewError(null);
  };

  // Bước 2→3: bấm 1 field cụ thể để khớp — sang bước xem trước, tự tải bản
  // ghi mẫu THẬT của nguồn đó (Decision 6 design.md, change
  // add-external-code-lookup-picker) để Admin thấy field vừa chọn ứng với
  // giá trị thật nào trước khi xác nhận. Ưu tiên chọn 1 bản ghi CÓ giá trị ở
  // đúng field vừa chọn (Sếp phản hồi 01/10/2026: bản ghi đầu danh sách tình
  // cờ trống "Tên viết tắt" khiến tưởng nhầm là lỗi) — không gọi `?sample=1`
  // nữa (chỉ trả đúng 1 bản ghi đầu, không đủ để lọc), lấy nguyên danh sách
  // (đã cache 5 phút phía server) rồi tự tìm ở client.
  const chooseLookupMatchField = async (fieldKey: string) => {
    if (!lookupSourceId || !group) return;
    const requestId = ++previewRequestRef.current;
    setLookupMatchField(fieldKey);
    setLookupStep("preview");
    setPreviewSample(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/groups/${group.id}/external-code-suggestions?sourceId=${lookupSourceId}`);
      if (!res.ok) throw new Error("request failed");
      const data = (await res.json()) as { records?: { fields: Record<string, string> }[] };
      if (previewRequestRef.current !== requestId) return;
      const records = data.records ?? [];
      const sample = records.find((r) => r.fields[fieldKey]) ?? records[0];
      setPreviewSample(sample?.fields ?? null);
    } catch {
      if (previewRequestRef.current !== requestId) return;
      setPreviewError(
        "Không tải được dữ liệu mẫu để xem trước — vẫn có thể xác nhận, hàng rào thật vẫn kiểm tra ở máy chủ lúc gửi đề xuất.",
      );
    } finally {
      if (previewRequestRef.current === requestId) setPreviewLoading(false);
    }
  };

  const confirmLookupSource = () => {
    if (!lookupSourceId || !lookupMatchField) return;
    setConfirmedSourceId(lookupSourceId);
    setConfirmedMatchField(lookupMatchField);
    setLookupStep("confirmed");
  };

  const backToChooseSource = () => {
    setLookupStep("choose-source");
    setLookupSourceId(null);
    setLookupMatchField(null);
    setPreviewSample(null);
    setPreviewError(null);
  };

  const backToChooseField = () => {
    setLookupStep("choose-field");
    setLookupMatchField(null);
    setPreviewSample(null);
    setPreviewError(null);
  };

  // "Đổi lại" ở thẻ đã xác nhận — quay về bước 1, GIỮ NGUYÊN
  // confirmedSourceId/confirmedMatchField cũ cho tới khi Admin xác nhận lựa
  // chọn mới (nếu bấm Hủy bỏ giữa chừng, field vẫn giữ cấu hình cũ).
  const changeLookupSource = () => {
    setLookupStep("choose-source");
    setLookupSourceId(null);
    setLookupMatchField(null);
    setPreviewSample(null);
    setPreviewError(null);
  };


  return (
    <Modal
      title={isEditMode ? "Sửa trường dữ liệu" : "Thêm trường dữ liệu"}
      width={720}
      onClose={handleClose}
      footer={
        <>
          <button type="button" onClick={handleClose} className={cancelButtonClass}>
            Hủy bỏ
          </button>
          <button type="button" onClick={handleSubmit} className={confirmButtonClass}>
            {isEditMode ? "Lưu thay đổi" : "Thêm trường"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Row label="Tên trường" required>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Hiển thị làm nhãn trên mẫu đề xuất"
          />
          {errors.name && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{errors.name}</p>}
        </Row>

        {isEditMode ? (
          <Row label="Mã trường" required>
            <input
              className={`${inputClass} font-mono`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="vd: chi_tiet"
            />
            <p className="mt-1 text-[12px] text-gray-400">
              Dùng làm thẻ <code className="rounded bg-gray-100 px-1 py-0.5">{"${" + (code || "ma_truong") + "}"}</code>{" "}
              trong mẫu in — không đổi khi sửa tên hiển thị ở trên, chỉ đổi khi Sếp tự sửa ở đây.
            </p>
            {errors.code && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{errors.code}</p>}
          </Row>
        ) : (
          <Row label="Mã trường">
            <p className={`${inputClass} flex items-center bg-gray-50 font-mono text-gray-500`}>
              {previewCode}
            </p>
            <p className="mt-1 text-[12px] text-gray-400">
              Tự sinh từ tên trường ở trên — dùng làm thẻ{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5">{"${" + previewCode + "}"}</code> trong mẫu in. Sửa được
              sau khi tạo (vào &quot;Sửa trường&quot;).
            </p>
          </Row>
        )}

        <Row label="Loại dữ liệu" required>
          <select
            className={selectClass}
            value={dataType}
            onChange={(e) => setDataType(e.target.value as FieldDataType)}
          >
            {dataTypes.map((type) => (
              <option key={type} value={type}>
                {fieldDataTypeLabels[type]}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Bắt buộc trả lời">
          <select
            className={selectClass}
            value={required ? "yes" : "no"}
            onChange={(e) => setRequired(e.target.value === "yes")}
          >
            <option value="yes">Có</option>
            <option value="no">Không</option>
          </select>
        </Row>

        <Row label="Giải thích trường dữ liệu">
          <textarea
            className={textareaClass}
            rows={2}
            maxLength={300}
            value={helpText}
            onChange={(e) => setHelpText(e.target.value)}
            placeholder="Ghi chú/hướng dẫn LUÔN hiện dưới ô nhập cho người gửi — khác placeholder (biến mất khi bắt đầu gõ)"
          />
        </Row>

        {!isEditMode && (
          <Row label="Thứ tự đứng sau">
            <select
              className={selectClass}
              value={afterFieldId}
              onChange={(e) => setAfterFieldId(e.target.value)}
            >
              <option value="">Đầu danh sách</option>
              {group.fields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Row>
        )}

        {choiceTypes.includes(dataType) && (
          <Row label="Các phương án">
            <div className="flex flex-col gap-2">
              {options.map((opt, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    value={opt}
                    onChange={(e) =>
                      setOptions((prev) => prev.map((o, i) => (i === index ? e.target.value : o)))
                    }
                    placeholder={`Phương án ${index + 1}`}
                  />
                  <button
                    type="button"
                    aria-label="Xóa phương án"
                    onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                    className="text-gray-400 hover:text-[var(--color-danger-red)]"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setOptions((prev) => [...prev, ""])}
                className="flex items-center gap-1 self-start text-[12px] text-[var(--color-action-blue)]"
              >
                <Plus size={13} /> Thêm phương án
              </button>
              {errors.options && <p className="text-[12px] text-[var(--color-danger-red)]">{errors.options}</p>}
            </div>
          </Row>
        )}

        {dataType === "department_select" && (
          <Row label="Danh sách bộ phận">
            <p className="text-[12px] text-gray-500">
              Không cần nhập tay — khi gửi đề xuất, trường này tự lấy danh sách{" "}
              <span className="font-medium">Nhóm thành viên</span> đang có ở
              account.hpcore.vn/dashboard/member-groups để người dùng chọn.
            </p>
          </Row>
        )}

        {tableTypes.includes(dataType) && (
          <Row label="Cấu hình cột">
            <div className="flex flex-col gap-2">
              {tableColumns.map((col, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    value={col}
                    onChange={(e) =>
                      setTableColumns((prev) => prev.map((c, i) => (i === index ? e.target.value : c)))
                    }
                    placeholder={`Tên cột ${index + 1}`}
                  />
                  <select
                    className={`${selectClass} w-[170px] shrink-0`}
                    value={tableColumnTypes[index] ?? "text"}
                    aria-label={`Kiểu dữ liệu cột ${index + 1}`}
                    onChange={(e) =>
                      setTableColumnTypes((prev) => {
                        const next = [...prev];
                        next[index] = e.target.value as TableColumnType;
                        return next;
                      })
                    }
                  >
                    {TABLE_COLUMN_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TABLE_COLUMN_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Xóa cột"
                    onClick={() => {
                      setTableColumns((prev) => prev.filter((_, i) => i !== index));
                      setTableColumnTypes((prev) => prev.filter((_, i) => i !== index));
                    }}
                    className="text-gray-400 hover:text-[var(--color-danger-red)]"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  setTableColumns((prev) => [...prev, ""]);
                  setTableColumnTypes((prev) => [...prev, "text"]);
                }}
                className="flex items-center gap-1 self-start text-[12px] text-[var(--color-action-blue)]"
              >
                <Plus size={13} /> Thêm cột
              </button>
              <p className="text-[11.5px] leading-relaxed text-gray-500">
                Cột số và tiền tệ: app tự chấm phẩy sau mỗi 3 chữ số khi hiển thị, tiền tệ thêm đuôi
                &quot;VNĐ&quot;. Dữ liệu vẫn lưu số thô để cộng được và đồng bộ được sang app Thu mua.
              </p>
            </div>
          </Row>
        )}

        {dataType === "formula" && (
          <Row label="Biểu thức">
            <textarea
              className={textareaClass}
              rows={3}
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="Ví dụ: SO_LUONG * DON_GIA"
            />
          </Row>
        )}

        {computedEligibleTypes.includes(dataType) && (
          <Row label="Tự động ghép giá trị từ trường khác">
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-[14px] text-gray-700">
                <input
                  type="checkbox"
                  checked={computedBranches !== null}
                  onChange={(e) =>
                    setComputedBranches(e.target.checked ? [{ template: "" }] : null)
                  }
                />
                Bật — trường này KHÔNG cho gõ tay nữa, giá trị tự ghép từ (các) trường khác trong cùng đề xuất
              </label>

              {computedBranches !== null && (
                <>
                  {computedBranches.map((branch, index) => (
                    <div key={index} className="flex flex-col gap-2 rounded-md border border-gray-200 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[12px] font-medium text-gray-500">
                          Nhánh {index + 1}{" "}
                          <span className="font-normal">
                            (xét theo thứ tự — nhánh nào khớp điều kiện trước thì dùng nhánh đó)
                          </span>
                        </p>
                        <button
                          type="button"
                          aria-label="Xóa nhánh"
                          onClick={() =>
                            setComputedBranches((prev) => prev!.filter((_, i) => i !== index))
                          }
                          className="text-gray-400 hover:text-[var(--color-danger-red)]"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <div>
                        <p className="mb-1 text-[12px] text-gray-500">
                          Điều kiện áp dụng nhánh này (để trống = luôn áp dụng):
                        </p>
                        <ConditionEditor
                          condition={branch.condition}
                          fields={conditionFields}
                          onChange={(next) =>
                            setComputedBranches((prev) =>
                              prev!.map((b, i) => (i === index ? { ...b, condition: next } : b)),
                            )
                          }
                        />
                      </div>
                      <div>
                        <p className="mb-1 text-[12px] text-gray-500">
                          Mẫu chuỗi — dùng{" "}
                          <code className="rounded bg-gray-100 px-1 py-0.5">{"${ma_truong}"}</code> để chèn giá trị
                          trường khác:
                        </p>
                        <textarea
                          className={textareaClass}
                          rows={2}
                          value={branch.template}
                          onChange={(e) =>
                            setComputedBranches((prev) =>
                              prev!.map((b, i) => (i === index ? { ...b, template: e.target.value } : b)),
                            )
                          }
                          placeholder={"Ví dụ: ${so_hop_dong}-${ten_cong_trinh}"}
                        />
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => setComputedBranches((prev) => [...(prev ?? []), { template: "" }])}
                    className="flex items-center gap-1 self-start text-[12px] text-[var(--color-action-blue)]"
                  >
                    <Plus size={13} /> Thêm nhánh
                  </button>

                  <div className="rounded-md bg-gray-50 p-2 text-[12px] text-gray-500">
                    Mã trường dùng được trong mẫu chuỗi:{" "}
                    {group.fields
                      .filter((f) => f.id !== editingField?.id && f.code && !f.computedFrom)
                      .map((f) => (
                        <code key={f.id} className="mr-1 rounded bg-gray-100 px-1 py-0.5">
                          {"${" + f.code + "}"}
                        </code>
                      ))}
                  </div>
                </>
              )}
              {errors.computed && (
                <p className="text-[12px] text-[var(--color-danger-red)]">{errors.computed}</p>
              )}
            </div>
          </Row>
        )}

        {dateLeadTimeEligibleTypes.includes(dataType) && (
          <Row label="Ràng buộc ngày cần cấp">
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-[14px] text-gray-700">
                <input
                  type="checkbox"
                  checked={dateLeadTimeEnabled}
                  onChange={(e) => setDateLeadTimeEnabled(e.target.checked)}
                />
                Bật — ràng buộc ngày cần cấp theo 2 mốc bên dưới
              </label>

              {dateLeadTimeEnabled && (
                <>
                  <div className="flex flex-col gap-3">
                    <div>
                      <p className="mb-1 text-[12px] text-gray-500">
                        Mốc chặn — cách dưới hoặc bằng số này thì không cho gửi:
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={DATE_LEAD_TIME_MAX_DAYS}
                          className={`${inputClass} w-24 text-center`}
                          value={dateLeadTimeBlockDays}
                          onChange={(e) => setDateLeadTimeBlockDays(e.target.value)}
                        />
                        <span className="text-[12px] text-gray-500">
                          ngày làm việc — đặt 0 nghĩa là không chặn ai
                        </span>
                      </div>
                    </div>
                    <div>
                      <p className="mb-1 text-[12px] text-gray-500">
                        Ngưỡng chuẩn (đủ thời gian chuẩn bị — từ mốc này trở lên không cảnh báo gì):
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={DATE_LEAD_TIME_MAX_DAYS}
                          className={`${inputClass} w-24 text-center`}
                          value={dateLeadTimeStandardDays}
                          onChange={(e) => setDateLeadTimeStandardDays(e.target.value)}
                        />
                        <span className="text-[12px] text-gray-500">ngày làm việc — phải lớn hơn mốc chặn</span>
                      </div>
                    </div>
                    {errors.dateLeadTime && (
                      <p className="text-[12px] text-[var(--color-danger-red)]">{errors.dateLeadTime}</p>
                    )}
                  </div>
                  {/* Khung tóm tắt TỰ VIẾT LẠI theo 2 số Admin vừa gõ.
                      DÙNG CHUNG component với chỗ hiện dưới ô ngày trên phiếu gửi
                      (DateLeadTimeZonesNote) — Sếp yêu cầu 15/09/2026 là ngoài
                      phiếu đề nghị phải ra ĐÚNG thông báo như trong thiết lập, nên
                      không được để 2 nơi tự vẽ mỗi nơi một kiểu. */}
                  {validateDateLeadTimeNumbers({
                    blockDays: Number(dateLeadTimeBlockDays),
                    standardDays: Number(dateLeadTimeStandardDays),
                  }) ? (
                    <div className="rounded-md bg-amber-50 p-2.5 text-[12px] leading-relaxed text-amber-700">
                      Nhập đủ 2 mốc hợp lệ để xem luật sẽ chạy thế nào.
                    </div>
                  ) : (
                    <DateLeadTimeZonesNote
                      rule={{
                        blockDays: Number(dateLeadTimeBlockDays),
                        standardDays: Number(dateLeadTimeStandardDays),
                      }}
                    />
                  )}
                </>
              )}
            </div>
          </Row>
        )}

        {suggestFromHistoryEligibleTypes.includes(dataType) && (
          <Row label="Gợi ý từ lịch sử">
            <label className="flex items-center gap-2 text-[14px] text-gray-700">
              <input
                type="checkbox"
                checked={suggestFromHistory}
                onChange={(e) => setSuggestFromHistory(e.target.checked)}
              />
              Bật — ô nhập hiện gợi ý các giá trị đã từng nhập cho trường này trong nhóm, vẫn cho gõ mới tự do
            </label>
            <p className="mt-1.5 text-[12px] text-gray-500">
              Hữu ích cho trường như &quot;Tên công trình&quot; — tránh mỗi lần một người gõ một kiểu khác nhau,
              khó đối chiếu về sau.
            </p>
          </Row>
        )}

        {externalCodeLookupEligibleTypes.includes(dataType) && (
          <Row label="Ràng buộc mã tham chiếu ngoài">
            <label className="flex items-center gap-2 text-[14px] text-gray-700">
              <input
                type="checkbox"
                checked={lookupEnabled}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setLookupEnabled(checked);
                  if (checked) {
                    // Mâu thuẫn với "Tự động điền" bên dưới — chỉ bật 1 trong 2.
                    setAutofillEnabled(false);
                    setAutofillSourceFieldId(null);
                    setAutofillPullField(null);
                    setLookupStep(confirmedSourceId && confirmedMatchField ? "confirmed" : "choose-source");
                  } else {
                    setLookupSourceId(null);
                    setLookupMatchField(null);
                    setConfirmedSourceId(null);
                    setConfirmedMatchField(null);
                    setPreviewSample(null);
                    setPreviewError(null);
                    setLookupStep("choose-source");
                  }
                }}
              />
              Bắt buộc khớp 1 mã tham chiếu ngoài
            </label>
            <p className="mt-1.5 text-[12px] text-gray-500">
              Khác với &quot;Gợi ý từ lịch sử&quot; ở trên (chỉ gợi ý mềm, vẫn cho gõ tự do): trường này ÉP BUỘC
              phải khớp đúng 1 mã có thật từ nguồn đã chọn — gửi đề xuất chính thức với giá trị không khớp sẽ
              bị chặn.
            </p>

            {lookupEnabled && lookupStep === "choose-source" && (
              <div className="mt-2 rounded border border-dashed border-gray-300 bg-gray-50 p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Bước 1/3 — Chọn nguồn
                </p>
                <div className="flex flex-col gap-1.5">
                  {EXTERNAL_CODE_SOURCE_ID_LIST.map((sourceId) => (
                    <button
                      key={sourceId}
                      type="button"
                      onClick={() => chooseLookupSourceCard(sourceId)}
                      className="rounded border border-gray-200 bg-white px-3 py-2 text-left text-[13.5px] text-gray-700 hover:border-[var(--color-action-blue)] hover:bg-blue-50"
                    >
                      {EXTERNAL_CODE_SOURCE_LABELS[sourceId]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {lookupEnabled && lookupStep === "choose-field" && lookupSourceId && (
              <div className="mt-2 rounded border border-dashed border-gray-300 bg-gray-50 p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Bước 2/3 — Chọn ĐÚNG 1 trường để khớp/gợi ý ({EXTERNAL_CODE_SOURCE_LABELS[lookupSourceId]})
                </p>
                <div className="flex flex-col gap-1.5">
                  {EXTERNAL_CODE_SOURCE_FIELDS[lookupSourceId].map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => chooseLookupMatchField(f.key)}
                      className="rounded border border-gray-200 bg-white px-3 py-2 text-left text-[13.5px] text-gray-700 hover:border-[var(--color-action-blue)] hover:bg-blue-50"
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={backToChooseSource}
                  className="mt-2 text-[12px] font-medium text-gray-500 hover:underline"
                >
                  ← Quay lại chọn nguồn
                </button>
              </div>
            )}

            {lookupEnabled && lookupStep === "preview" && lookupSourceId && lookupMatchField && (
              <div className="mt-2 rounded border border-dashed border-gray-300 bg-gray-50 p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  Bước 3/3 — Xem trước dữ liệu thật (dòng tô xanh là trường vừa chọn)
                </p>
                {previewLoading && <p className="text-[12px] text-gray-400">Đang tải…</p>}
                {previewError && <p className="text-[12px] text-[var(--color-danger-red)]">{previewError}</p>}
                {!previewLoading && previewSample && (
                  <table className="w-full text-[12.5px]">
                    <tbody>
                      {Object.entries(previewSample).map(([key, value]) => {
                        const label =
                          EXTERNAL_CODE_SOURCE_FIELDS[lookupSourceId].find((f) => f.key === key)?.label ?? key;
                        const isMatch = key === lookupMatchField;
                        return (
                          <tr
                            key={key}
                            className={`border-b border-gray-100 last:border-0 ${isMatch ? "bg-blue-50" : ""}`}
                          >
                            <td className={`py-1 pr-3 ${isMatch ? "font-semibold text-[var(--color-action-blue)]" : "text-gray-400"}`}>
                              {label}
                            </td>
                            <td className={`py-1 ${isMatch ? "font-semibold text-gray-800" : "text-gray-700"}`}>
                              {value || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {!previewLoading && !previewError && !previewSample && (
                  <p className="text-[12px] text-gray-400">Nguồn này chưa có dữ liệu mẫu nào.</p>
                )}
                <div className="mt-3 flex justify-between">
                  <button
                    type="button"
                    onClick={backToChooseField}
                    className="text-[12px] font-medium text-gray-500 hover:underline"
                  >
                    ← Quay lại
                  </button>
                  <button
                    type="button"
                    onClick={confirmLookupSource}
                    className="rounded bg-[var(--color-action-blue)] px-3 py-1.5 text-[12px] font-semibold text-white hover:brightness-95"
                  >
                    Xác nhận
                  </button>
                </div>
              </div>
            )}

            {lookupEnabled && lookupStep === "confirmed" && confirmedSourceId && confirmedMatchField && (
              <div className="mt-2 flex items-center gap-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-[13px] text-green-800">
                <span>
                  ✓ Đã ràng buộc: {EXTERNAL_CODE_SOURCE_LABELS[confirmedSourceId]} — khớp theo{" "}
                  {EXTERNAL_CODE_SOURCE_FIELDS[confirmedSourceId].find((f) => f.key === confirmedMatchField)?.label ??
                    confirmedMatchField}
                </span>
                <button
                  type="button"
                  onClick={changeLookupSource}
                  className="ml-auto text-[12px] font-medium text-green-700 hover:underline"
                >
                  Đổi lại
                </button>
              </div>
            )}
          </Row>
        )}

        {externalCodeLookupEligibleTypes.includes(dataType) && (
          <Row label="Tự động điền từ trường khác">
            <label className="flex items-center gap-2 text-[14px] text-gray-700">
              <input
                type="checkbox"
                checked={autofillEnabled}
                disabled={autofillSourceOptions.length === 0}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setAutofillEnabled(checked);
                  if (checked) {
                    // Mâu thuẫn với "Ràng buộc mã tham chiếu ngoài" ở trên — chỉ bật 1 trong 2.
                    setLookupEnabled(false);
                    setLookupSourceId(null);
                    setLookupMatchField(null);
                    setConfirmedSourceId(null);
                    setConfirmedMatchField(null);
                    setPreviewSample(null);
                    setPreviewError(null);
                    setLookupStep("choose-source");
                  } else {
                    setAutofillSourceFieldId(null);
                    setAutofillPullField(null);
                  }
                }}
              />
              Bật — trường này KHÔNG tự validate, chỉ THỤ ĐỘNG nhận giá trị từ trường khác khi trường đó khớp 1
              bản ghi thật
            </label>
            <p className="mt-1.5 text-[12px] text-gray-500">
              Ví dụ: field &quot;MST Nhà thầu phụ&quot; tự điền theo field &quot;Tên nhà thầu phụ đề xuất&quot; vừa
              chọn — vẫn cho sửa tay đè lên nếu Công nợ thiếu dữ liệu.
              {autofillSourceOptions.length === 0 &&
                ' Cần có ít nhất 1 trường khác trong nhóm đã bật "Ràng buộc mã tham chiếu ngoài" ở trên trước.'}
            </p>

            {autofillEnabled && (
              <div className="mt-2 flex flex-col gap-3 rounded border border-dashed border-gray-300 bg-gray-50 p-3">
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Lấy theo trường
                  </p>
                  <select
                    className={selectClass}
                    value={autofillSourceFieldId ?? ""}
                    onChange={(e) => {
                      setAutofillSourceFieldId(e.target.value || null);
                      setAutofillPullField(null);
                    }}
                  >
                    <option value="">— Chọn trường —</option>
                    {autofillSourceOptions.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
                {autofillSourceFieldId && autofillPullFieldOptions.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                      Điền giá trị
                    </p>
                    <select
                      className={selectClass}
                      value={autofillPullField ?? ""}
                      onChange={(e) => setAutofillPullField(e.target.value || null)}
                    >
                      <option value="">— Chọn trường dữ liệu —</option>
                      {autofillPullFieldOptions.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}
          </Row>
        )}

        <Row label="Hiển thị trường dữ liệu theo điều kiện">
          <ConditionEditor condition={visibleWhen} fields={conditionFields} onChange={setVisibleWhen} />
        </Row>
      </div>
    </Modal>
  );
}

function Row({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="w-[160px] shrink-0 pt-1.5">
        <p className="text-[14px] font-medium text-gray-700">
          {label}
          {required && <span className="ml-0.5 text-[var(--color-danger-red)]">*</span>}
        </p>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
