"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, FileText, Pencil, Plus, RefreshCw, Star, Trash2, Upload } from "lucide-react";
import RequireAdminRole from "@/components/request/RequireAdminRole";
import { useRequestContext } from "@/context/RequestContext";
import { cancelButtonClass, confirmButtonClass, inputClass, selectClass, textareaClass } from "@/components/shared/form-styles";
import { DEFAULT_GROUP_PRINT_OPTIONS, fieldDataTypeLabels, type FieldDataType, type GroupPrintOptions } from "@/lib/types";
import type { PrintTemplate } from "@/lib/types";
import { COMPANY_NAME } from "@/lib/constants";
import { SYSTEM_TEMPLATE_KEYS, fieldTemplateKeys, isKnownSystemKey } from "@/lib/print-template";

const CREATABLE_DATA_TYPES: FieldDataType[] = [
  "short_text",
  "paragraph",
  "date",
  "datetime",
  "integer",
  "decimal",
];

export default function PrintSettingsPage() {
  return (
    <RequireAdminRole>
      <PrintSettingsPageInner />
    </RequireAdminRole>
  );
}

function PrintSettingsPageInner() {
  const params = useParams<{ groupId: string }>();
  const { getGroupById, updateGroup, addField } = useRequestContext();
  const group = getGroupById(params.groupId);
  const [footerNote, setFooterNote] = useState(group?.printFooterNote ?? "");
  const [saved, setSaved] = useState(false);
  const [requireApproved, setRequireApproved] = useState(group?.printRequireFullyApproved ?? false);

  const [templates, setTemplates] = useState<PrintTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const [creatingCode, setCreatingCode] = useState<string | null>(null);
  const [creatingName, setCreatingName] = useState("");
  const [creatingType, setCreatingType] = useState<FieldDataType>("short_text");

  const refetchTemplates = () => {
    if (!group) return;
    setLoadingTemplates(true);
    fetch(`/api/groups/${group.id}/print-templates`)
      .then((res) => (res.ok ? res.json() : { templates: [] }))
      .then((data: { templates: PrintTemplate[] }) => setTemplates(data.templates ?? []))
      .catch(() => setTemplates([]))
      .finally(() => setLoadingTemplates(false));
  };

  useEffect(() => {
    refetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id]);

  if (!group) return null;

  const printOptions: GroupPrintOptions = { ...DEFAULT_GROUP_PRINT_OPTIONS, ...group.printOptions };
  const setPrintOption = <K extends keyof GroupPrintOptions>(key: K, value: GroupPrintOptions[K]) => {
    updateGroup(group.id, { printOptions: { ...printOptions, [key]: value } });
  };

  const save = () => {
    updateGroup(group.id, { printFooterNote: footerNote });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const toggleRequireApproved = (value: boolean) => {
    setRequireApproved(value);
    updateGroup(group.id, { printRequireFullyApproved: value });
  };

  const uploadNewTemplate = async (file: File) => {
    setBusyId("new");
    setTemplateError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/groups/${group.id}/print-templates`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể tải mẫu in lên.");
      }
      refetchTemplates();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setBusyId(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const replaceTemplateFile = async (templateId: string, file: File) => {
    setBusyId(templateId);
    setTemplateError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/groups/${group.id}/print-templates/${templateId}`, {
        method: "PUT",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? "Không thể thay tệp mẫu in.");
      }
      refetchTemplates();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setBusyId(null);
      if (replaceInputRef.current) replaceInputRef.current.value = "";
      setReplaceTargetId(null);
    }
  };

  const saveRename = async (templateId: string) => {
    const name = renameValue.trim();
    if (!name) return;
    setBusyId(templateId);
    try {
      const res = await fetch(`/api/groups/${group.id}/print-templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Không thể đổi tên mẫu.");
      refetchTemplates();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setBusyId(null);
      setRenamingId(null);
    }
  };

  const setDefault = async (templateId: string) => {
    setBusyId(templateId);
    try {
      const res = await fetch(`/api/groups/${group.id}/print-templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setDefault: true }),
      });
      if (!res.ok) throw new Error("Không thể đặt làm mặc định.");
      refetchTemplates();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setBusyId(null);
    }
  };

  const rescanTemplate = async (templateId: string) => {
    setBusyId(templateId);
    try {
      const res = await fetch(`/api/groups/${group.id}/print-templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rescan: true }),
      });
      if (!res.ok) throw new Error("Không thể quét lại mẫu in.");
      refetchTemplates();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setBusyId(null);
    }
  };

  const removeTemplate = async (templateId: string, name: string) => {
    if (!window.confirm(`Xoá mẫu in "${name}"? Lịch sử xuất file trước đó vẫn được giữ lại.`)) return;
    setBusyId(templateId);
    try {
      const res = await fetch(`/api/groups/${group.id}/print-templates/${templateId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Không thể xoá mẫu in.");
      refetchTemplates();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setBusyId(null);
    }
  };

  const sortedFields = [...group.fields].sort((a, b) => a.order - b.order);

  // Mã trường được nhắc tới trong (các) mẫu đã tải lên nhưng CHƯA có field
  // nào khớp — không tính thẻ hệ thống hay thẻ column.* (thuộc trường Bảng,
  // xử lý riêng, không phải "trường thiếu").
  const existingCodes = new Set(sortedFields.map((f) => f.code).filter(Boolean) as string[]);
  const missingFieldCodes = Array.from(
    new Set(templates.flatMap((t) => t.detectedVariables)),
  ).filter((v) => !isKnownSystemKey(v) && !v.startsWith("column.") && !existingCodes.has(v));

  const createMissingField = (code: string) => {
    const name = creatingName.trim() || code;
    setCreatingCode(null);
    setCreatingName("");
    // Thêm vào CUỐI danh sách (sau field cuối cùng hiện có) — không chèn lên
    // đầu, tránh xáo trộn thứ tự các field Sếp đã sắp xếp sẵn trên form.
    const lastFieldId = sortedFields.length > 0 ? sortedFields[sortedFields.length - 1].id : null;
    addField(group.id, { name, code, dataType: creatingType, required: false }, lastFieldId);
  };

  return (
    <div>
      <h2 className="mb-4 text-[15px] font-semibold text-gray-800">In đề xuất</h2>

      <div className="mb-6 rounded-[3px] border border-[var(--color-border)] bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold text-gray-800">Mẫu in tự động (.docx)</h3>
            <p className="mt-1 text-[12px] text-gray-500">
              Nhóm có thể có nhiều mẫu — gõ thẻ giữ chỗ dạng{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5">${"{ma_truong}"}</code> vào đúng vị
              trí trong file Word, hệ thống tự thay bằng dữ liệu thật khi &quot;In theo mẫu&quot;.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busyId === "new"}
            className={`${confirmButtonClass} flex shrink-0 items-center gap-1.5 px-3 disabled:opacity-60`}
          >
            <Upload size={14} /> {busyId === "new" ? "Đang tải lên..." : "Thêm mẫu"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadNewTemplate(file);
            }}
          />
        </div>

        {templateError && (
          <p className="mt-2 text-[12px] text-[var(--color-danger-red)]">{templateError}</p>
        )}

        <div className="mt-3 flex flex-col gap-2">
          {loadingTemplates ? (
            <p className="text-[12px] text-gray-400">Đang tải danh sách mẫu...</p>
          ) : templates.length === 0 ? (
            <p className="text-[12px] text-gray-400">Chưa có mẫu in nào — bấm &quot;Thêm mẫu&quot; để bắt đầu.</p>
          ) : (
            templates.map((t) => (
              <div key={t.id} className="rounded border border-[var(--color-border)] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 text-[13px] text-gray-700">
                    <FileText size={16} className="shrink-0 text-[var(--color-action-blue)]" />
                    {renamingId === t.id ? (
                      <input
                        autoFocus
                        className={`${inputClass} h-7 w-[220px] text-[12px]`}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename(t.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                      />
                    ) : (
                      <span className="truncate font-medium">{t.name}</span>
                    )}
                    {t.isDefault && (
                      <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700">
                        <Star size={10} fill="currentColor" /> Mặc định
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {renamingId === t.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => saveRename(t.id)}
                          className="rounded px-2 py-1 text-[11px] text-[var(--color-action-blue)] hover:bg-blue-50"
                        >
                          Lưu
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className={`${cancelButtonClass} h-7 px-2 text-[11px]`}
                        >
                          Huỷ
                        </button>
                      </>
                    ) : (
                      <>
                        {!t.isDefault && (
                          <button
                            type="button"
                            onClick={() => setDefault(t.id)}
                            disabled={busyId === t.id}
                            title="Đặt làm mặc định"
                            className="rounded p-1.5 text-gray-400 hover:text-yellow-600 disabled:opacity-60"
                          >
                            <Star size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(t.id);
                            setRenameValue(t.name);
                          }}
                          title="Đổi tên"
                          className="rounded p-1.5 text-gray-400 hover:text-[var(--color-action-blue)]"
                        >
                          <Pencil size={14} />
                        </button>
                        <a
                          href={`/api/groups/${group.id}/print-templates/${t.id}/download`}
                          title="Tải mẫu gốc xuống"
                          className="rounded p-1.5 text-gray-400 hover:text-[var(--color-action-blue)]"
                        >
                          <Download size={14} />
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            setReplaceTargetId(t.id);
                            replaceInputRef.current?.click();
                          }}
                          disabled={busyId === t.id}
                          title="Thay tệp mẫu"
                          className="rounded p-1.5 text-gray-400 hover:text-[var(--color-action-blue)] disabled:opacity-60"
                        >
                          <Upload size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => rescanTemplate(t.id)}
                          disabled={busyId === t.id}
                          title="Quét lại (sau khi sửa/xoá trường dữ liệu của nhóm)"
                          className="rounded p-1.5 text-gray-400 hover:text-[var(--color-action-blue)] disabled:opacity-60"
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeTemplate(t.id, t.name)}
                          disabled={busyId === t.id}
                          title="Xoá mẫu"
                          className="rounded p-1.5 text-gray-400 hover:text-[var(--color-danger-red)] disabled:opacity-60"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-gray-400">
                  {t.fileName} · phiên bản {t.version} · tạo bởi {t.createdBy.name} · cập nhật{" "}
                  {new Date(t.updatedAt).toLocaleString("vi-VN")}
                </p>
                {(t.validation.errors.length > 0 || t.validation.warnings.length > 0) && (
                  <div className="mt-1.5 flex flex-col gap-1">
                    {t.validation.errors.map((e, i) => (
                      <p key={i} className="flex items-start gap-1 text-[11px] text-[var(--color-danger-red)]">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {e}
                      </p>
                    ))}
                    {t.validation.warnings.map((w, i) => (
                      <p key={i} className="flex items-start gap-1 text-[11px] text-orange-500">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}
                      </p>
                    ))}
                  </div>
                )}
                {t.detectedVariables.length > 0 && (
                  <p className="mt-1.5 flex items-center gap-1 text-[11px] text-green-600">
                    <CheckCircle2 size={12} /> Phát hiện {t.detectedVariables.length} biến trong mẫu.
                  </p>
                )}
              </div>
            ))
          )}
        </div>
        <input
          ref={replaceInputRef}
          type="file"
          accept=".docx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && replaceTargetId) replaceTemplateFile(replaceTargetId, file);
          }}
        />

        {missingFieldCodes.length > 0 && (
          <div className="mt-4 rounded border border-orange-200 bg-orange-50 px-3 py-2.5">
            <p className="mb-1.5 flex items-center gap-1 text-[12px] font-medium text-orange-700">
              <AlertTriangle size={13} /> Mẫu có dùng {missingFieldCodes.length} mã trường chưa tồn
              tại — in ra sẽ để trống, bấm &quot;Tạo trường&quot; để thêm ngay:
            </p>
            <div className="flex flex-col gap-1.5">
              {missingFieldCodes.map((code) =>
                creatingCode === code ? (
                  <div key={code} className="flex flex-wrap items-center gap-1.5">
                    <input
                      autoFocus
                      className={`${inputClass} h-7 w-[200px] text-[12px]`}
                      value={creatingName}
                      onChange={(e) => setCreatingName(e.target.value)}
                      placeholder={code}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") createMissingField(code);
                        if (e.key === "Escape") setCreatingCode(null);
                      }}
                    />
                    <select
                      className={`${selectClass} h-7 w-[140px] text-[12px]`}
                      value={creatingType}
                      onChange={(e) => setCreatingType(e.target.value as FieldDataType)}
                    >
                      {CREATABLE_DATA_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {fieldDataTypeLabels[t]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => createMissingField(code)}
                      className="rounded bg-[var(--color-action-blue)] px-2 py-1 text-[11px] font-medium text-white hover:brightness-95"
                    >
                      Tạo
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreatingCode(null)}
                      className={`${cancelButtonClass} h-7 px-2 text-[11px]`}
                    >
                      Huỷ
                    </button>
                  </div>
                ) : (
                  <div key={code} className="flex items-center gap-2 text-[12px]">
                    <code className="rounded bg-white px-1.5 py-0.5 font-mono text-orange-700">
                      ${"{" + code + "}"}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingCode(code);
                        setCreatingName(code);
                        setCreatingType("short_text");
                      }}
                      className="flex items-center gap-0.5 text-[11px] font-medium text-[var(--color-action-blue)] hover:underline"
                    >
                      <Plus size={12} /> Tạo trường
                    </button>
                  </div>
                ),
              )}
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="mb-1.5 text-[12px] font-medium text-gray-600">
            Danh sách mã trường khả dụng (bấm để sao chép)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...SYSTEM_TEMPLATE_KEYS, ...fieldTemplateKeys(sortedFields)].map((k) => (
              <button
                key={k.key}
                type="button"
                title={k.label}
                onClick={() => navigator.clipboard.writeText(`\${${k.key}}`)}
                className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600 hover:bg-gray-200"
              >
                ${"{" + k.key + "}"}
              </button>
            ))}
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-[12px] text-gray-600">
          <input
            type="checkbox"
            checked={requireApproved}
            onChange={(e) => toggleRequireApproved(e.target.checked)}
          />
          Chỉ cho phép &quot;In theo mẫu&quot; khi đề xuất đã được duyệt hoàn toàn
        </label>
      </div>

      <div className="mb-6 rounded-[3px] border border-[var(--color-border)] bg-white p-4">
        <h3 className="text-[13px] font-semibold text-gray-800">
          Tuỳ chỉnh in đề xuất <span className="ml-1 rounded-full bg-[var(--color-cat-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-cat-text)]">MỚI</span>
        </h3>
        <p className="mt-1 text-[12px] text-gray-500">
          Chỉ lưu cấu hình / ẩn-hiện nút ở trang chi tiết đề xuất, chưa tự sinh file thật.
        </p>

        <div className="mt-3 flex flex-col gap-1">
          <label className="flex items-center gap-2 text-[13px] text-gray-700">
            <input type="checkbox" checked={printOptions.allowPrintProposal} onChange={(e) => setPrintOption("allowPrintProposal", e.target.checked)} />
            In đề xuất
          </label>
          <label className="flex items-center gap-2 text-[13px] text-gray-700">
            <input type="checkbox" checked={printOptions.allowPrintProposalWithDiscussion} onChange={(e) => setPrintOption("allowPrintProposalWithDiscussion", e.target.checked)} />
            In đề xuất và thảo luận
          </label>
          <label className="flex items-center gap-2 text-[13px] text-gray-700">
            <input type="checkbox" checked={printOptions.allowPrintToWord} onChange={(e) => setPrintOption("allowPrintToWord", e.target.checked)} />
            In đề xuất theo mẫu ra file word
          </label>
          <label className="flex items-center gap-2 text-[13px] text-gray-700">
            <input type="checkbox" checked={printOptions.allowPrintToPdf} onChange={(e) => setPrintOption("allowPrintToPdf", e.target.checked)} />
            In đề xuất theo mẫu ra file pdf{" "}
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">⏳ chờ tính năng xuất PDF</span>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-gray-700">
            <input type="checkbox" checked={printOptions.allowPrintWithQrCode} onChange={(e) => setPrintOption("allowPrintWithQrCode", e.target.checked)} />
            In đề xuất theo mẫu với qrcode{" "}
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">⏳ chưa sinh QR thật</span>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-gray-700">
            <input type="checkbox" checked={printOptions.allowPrintAttachmentWithQrCode} onChange={(e) => setPrintOption("allowPrintAttachmentWithQrCode", e.target.checked)} />
            In file đính kèm với qrcode{" "}
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">⏳ chưa sinh QR thật</span>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-gray-700">
            <input type="checkbox" checked={printOptions.allowPrintCustomFieldFileWithQrCode} onChange={(e) => setPrintOption("allowPrintCustomFieldFileWithQrCode", e.target.checked)} />
            In trường tùy chỉnh dạng file với qrcode{" "}
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">⏳ chưa sinh QR thật</span>
          </label>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-600">
              Vị trí mã QR (file trường tuỳ chỉnh)
            </label>
            <select
              className={selectClass}
              value={printOptions.customFieldQrPosition ?? "top_left"}
              onChange={(e) => setPrintOption("customFieldQrPosition", e.target.value)}
            >
              <option value="top_left">Trên - Trái</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-gray-600">
              Vị trí mã QR (file đính kèm)
            </label>
            <select
              className={selectClass}
              value={printOptions.attachmentQrPosition ?? "top_left"}
              onChange={(e) => setPrintOption("attachmentQrPosition", e.target.value)}
            >
              <option value="top_left">Trên - Trái</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        <div className="w-[320px] shrink-0">
          <label className="mb-1 block text-[13px] font-medium text-gray-700">
            Ghi chú chân trang mẫu in
          </label>
          <textarea
            className={textareaClass}
            rows={3}
            value={footerNote}
            onChange={(e) => setFooterNote(e.target.value)}
            placeholder="Ví dụ: Người lập phiếu&#10;&#10;&#10;Người duyệt"
          />
          <p className="mt-1 text-[12px] text-gray-400">
            Hiện ở cuối trang khi in đề xuất thuộc nhóm này (bản in HTML đơn giản, khác với mẫu
            .docx ở trên). Để trống dùng ghi chú mặc định.
          </p>
          <button type="button" onClick={save} className={`${confirmButtonClass} mt-3 px-4`}>
            {saved ? "Đã lưu" : "Lưu thay đổi"}
          </button>
        </div>

        <div className="min-w-0 flex-1 rounded-[3px] border border-[var(--color-border)] bg-white p-6">
          <div className="mx-auto max-w-[560px] border border-gray-200 p-6 text-[13px]">
            <p className="text-center text-[15px] font-bold uppercase">{COMPANY_NAME}</p>
            <p className="mt-1 text-center text-[13px] font-semibold uppercase text-gray-600">
              {group.name}
            </p>
            <div className="mt-4 flex flex-col gap-1 text-[12px] text-gray-600">
              <p>Người tạo: Nguyễn Văn A</p>
              <p>Thời gian tạo: 01/01/2026 08:00</p>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {sortedFields.length === 0 ? (
                <p className="text-[12px] text-gray-400">Nhóm chưa có trường dữ liệu.</p>
              ) : (
                sortedFields.map((f) => (
                  <div key={f.id} className="text-[12px]">
                    <span className="text-gray-400">
                      {f.name} ({fieldDataTypeLabels[f.dataType]}):
                    </span>{" "}
                    <span className="text-gray-700">—</span>
                  </div>
                ))
              )}
            </div>
            <div className="mt-6 whitespace-pre-line text-center text-[12px] text-gray-600">
              {footerNote || "Người lập phiếu\n\n\nNgười duyệt"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
