"use client";

import { useEffect, useMemo, useState } from "react";
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
  computedFieldEligibleTypes,
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

const dataTypes = Object.keys(fieldDataTypeLabels) as FieldDataType[];
const choiceTypes: FieldDataType[] = ["single_choice", "multiple_choice"];
const tableTypes: FieldDataType[] = ["table", "base_table"];
// Định nghĩa dùng chung ở lib/types.ts (cả trang cấu hình nhóm cũng cần biết
// loại field nào được phép, để quyết định có hiện banner nhắc hay không).
const computedEligibleTypes = computedFieldEligibleTypes;
/** Chỉ field ngày mới cấu hình được ràng buộc "ngày cần cấp" (dateLeadTimeRule). */
const dateLeadTimeEligibleTypes: FieldDataType[] = ["date", "datetime"];
/** Chỉ field văn bản ngắn mới bật được "gợi ý từ lịch sử" (paragraph để văn
 * bản dài, gợi ý cả đoạn văn không hợp lý — Sếp chốt 17/09/2026). */
const suggestFromHistoryEligibleTypes: FieldDataType[] = ["short_text"];
/** Chỉ field văn bản ngắn mới bật được ràng buộc Số Hợp Đồng CĐT (cùng lý do
 * suggestFromHistoryEligibleTypes) — xem openspec/changes/add-contract-code-lookup. */
const contractCodeLookupEligibleTypes: FieldDataType[] = ["short_text"];
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
  // Sếp hay quên bật "Tự động ghép giá trị" cho trường "Tên đề xuất" ở nhóm
  // mới (phát hiện 06/09/2026) — tự gợi ý bật sẵn (1 nhánh rỗng, chưa điền
  // mẫu chuỗi) khi ĐANG TẠO MỚI (không áp dụng lúc sửa field có sẵn) và tên
  // gõ đúng "Tên đề xuất". Chỉ gợi ý 1 lần; nếu Admin tự tay bỏ tích sau đó
  // thì tôn trọng lựa chọn đó, không tự bật lại (cờ `computedTouched`).
  const [computedTouched, setComputedTouched] = useState(false);
  const [dateLeadTimeEnabled, setDateLeadTimeEnabled] = useState(false);
  const [suggestFromHistory, setSuggestFromHistory] = useState(false);
  const [contractCodeLookup, setContractCodeLookup] = useState(false);
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
    setComputedTouched(false);
    setDateLeadTimeEnabled(false);
    setDateLeadTimeBlockDays(String(DATE_LEAD_TIME_DEFAULT_BLOCK_DAYS));
    setDateLeadTimeStandardDays(String(DATE_LEAD_TIME_DEFAULT_STANDARD_DAYS));
    setSuggestFromHistory(false);
    setContractCodeLookup(false);
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
      // Đang sửa field CÓ SẴN — coi như đã "chạm" rồi, không gợi ý tự bật nữa
      // dù tên trùng "Tên đề xuất" (tránh ghi đè lựa chọn Admin đã cố ý tắt).
      setComputedTouched(true);
      setDateLeadTimeEnabled(editingField.dateLeadTimeRule?.enabled ?? false);
      setSuggestFromHistory(editingField.suggestFromHistory ?? false);
      setContractCodeLookup(editingField.contractCodeLookup ?? false);
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
      contractCodeLookup:
        contractCodeLookupEligibleTypes.includes(dataType) && contractCodeLookup ? true : undefined,
    };

    if (isEditMode && editingField) {
      updateField(group.id, editingField.id, fieldData);
    } else {
      addField(group.id, fieldData, afterFieldId || null);
    }
    resetForm();
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
            onChange={(e) => {
              const next = e.target.value;
              setName(next);
              // Chỉ tự động bật/tắt khi ĐANG TẠO MỚI và Admin CHƯA từng tự tay
              // đụng vào phần "Tự động ghép" (computedTouched) — tôn trọng
              // hoàn toàn nếu Admin đã tự cấu hình, dù tên có đổi qua lại.
              if (isEditMode || computedTouched) return;
              const isTenDeXuat = next.trim().toLowerCase() === "tên đề xuất";
              if (isTenDeXuat && computedBranches === null && computedEligibleTypes.includes(dataType)) {
                setComputedBranches([{ template: "" }]);
              } else if (!isTenDeXuat && computedBranches !== null) {
                // Đã lỡ gợi ý (do gõ đúng "Tên đề xuất" trước đó) nhưng giờ
                // Admin sửa tên sang chữ khác — dọn lại nhánh rỗng vừa tự
                // thêm, tránh còn sót 1 ô "đã tích sẵn" cho field không còn
                // tên là "Tên đề xuất" nữa (CodeRabbit phát hiện).
                setComputedBranches(null);
              }
            }}
            placeholder="Hiển thị làm nhãn trên mẫu đề xuất"
          />
          {errors.name && <p className="mt-1 text-[12px] text-[var(--color-danger-red)]">{errors.name}</p>}
        </Row>

        {isEditMode && (
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
        )}

        <Row label="Loại dữ liệu" required>
          <select
            className={selectClass}
            value={dataType}
            onChange={(e) => {
              const nextType = e.target.value as FieldDataType;
              setDataType(nextType);
              // Chỉ tự đổi khi ĐANG TẠO MỚI + Admin CHƯA từng tự tay đụng vào
              // phần "Tự động ghép" (computedTouched) — không can thiệp gì nếu
              // Admin đã tự cấu hình.
              if (isEditMode || computedTouched) return;
              const isTenDeXuat = name.trim().toLowerCase() === "tên đề xuất";
              if (!computedEligibleTypes.includes(nextType)) {
                // Đổi sang loại KHÔNG hợp lệ — dọn luôn nhánh vừa được TỰ ĐỘNG
                // gợi ý, tránh trạng thái "đã tích sẵn" ẩn trong state, lỡ đổi
                // qua lại có thể hiện lại ô tích dù Admin chưa từng cố ý bật
                // (submit vẫn tự bỏ qua computedFrom cho loại không hợp lệ,
                // xem cleanedBranches ở handleSubmit, nhưng dọn sớm ở đây cho
                // rõ ràng, không để UI hiện sai trạng thái).
                setComputedBranches(null);
              } else if (isTenDeXuat && computedBranches === null) {
                // Đổi NGƯỢC LẠI về loại hợp lệ trong khi tên vẫn đúng "Tên đề
                // xuất" (ví dụ Admin lỡ tay đổi loại rồi đổi lại) — gợi ý lại
                // đúng như lúc gõ tên lần đầu, không để Admin phải tự tích lại
                // (CodeRabbit phát hiện thiếu chiều ngược này).
                setComputedBranches([{ template: "" }]);
              }
            }}
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
                  onChange={(e) => {
                    setComputedTouched(true);
                    setComputedBranches(e.target.checked ? [{ template: "" }] : null);
                  }}
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
                          onClick={() => {
                            setComputedTouched(true);
                            setComputedBranches((prev) => prev!.filter((_, i) => i !== index));
                          }}
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
                          onChange={(next) => {
                            setComputedTouched(true);
                            setComputedBranches((prev) =>
                              prev!.map((b, i) => (i === index ? { ...b, condition: next } : b)),
                            );
                          }}
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
                          onChange={(e) => {
                            setComputedTouched(true);
                            setComputedBranches((prev) =>
                              prev!.map((b, i) => (i === index ? { ...b, template: e.target.value } : b)),
                            );
                          }}
                          placeholder={"Ví dụ: ${so_hop_dong}-${ten_cong_trinh}"}
                        />
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => {
                      setComputedTouched(true);
                      setComputedBranches((prev) => [...(prev ?? []), { template: "" }]);
                    }}
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

        {contractCodeLookupEligibleTypes.includes(dataType) && (
          <Row label="Ràng buộc Số Hợp Đồng CĐT">
            <label className="flex items-center gap-2 text-[14px] text-gray-700">
              <input
                type="checkbox"
                checked={contractCodeLookup}
                onChange={(e) => setContractCodeLookup(e.target.checked)}
              />
              Bắt buộc khớp Số Hợp Đồng CĐT (app Công nợ)
            </label>
            <p className="mt-1.5 text-[12px] text-gray-500">
              Khác với &quot;Gợi ý từ lịch sử&quot; ở trên (chỉ gợi ý mềm, vẫn cho gõ tự do): trường này ÉP BUỘC
              phải chọn đúng 1 số hợp đồng có thật trong app Công nợ — gửi đề xuất chính thức với giá trị không
              khớp sẽ bị chặn.
            </p>
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
