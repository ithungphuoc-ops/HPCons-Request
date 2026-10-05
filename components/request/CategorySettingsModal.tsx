"use client";

import { useRef, useState } from "react";
import { ImageUp } from "lucide-react";
import Modal from "@/components/shared/Modal";
import { useRequestContext } from "@/context/RequestContext";
import {
  FILE_NAME_FORBIDDEN_CHARS,
  PRINT_BRAND_MAX_LENGTH,
  printFileBaseName,
  resolvePrintBrand,
} from "@/lib/letterhead";
import type { CategoryGroup } from "@/lib/types";

// Khớp đúng danh sách máy chủ nhận ở app/api/categories/[id]/letterhead (không SVG).
const LETTERHEAD_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const SAMPLE_CODE = "000000189";

/**
 * "⚙ Cài đặt thông tin" của 1 công ty (category) ở trang Tất cả nhóm đề xuất:
 *  1. Logo + tên công ty (ảnh tiêu đề công văn) in ở đầu bản in đề xuất / file
 *     Word / Excel — Sếp chốt 01/10/2026. Chọn ảnh là lưu luôn như trước.
 *  2. "Tên hiển thị khi in / tải file" (vd "HPCons Request") — tên tệp PDF/Word/
 *     Excel + chân trang Word/Excel; để trống = ẩn. Sếp chốt 05/10/2026.
 * Lưu xong ghi thẳng vào categoryGroups của RequestContext để bản in/tệp tải về
 * dùng giá trị mới ngay, không phải tải lại trang.
 */
export default function CategorySettingsModal({
  category,
  onClose,
}: {
  category: CategoryGroup;
  onClose: () => void;
}) {
  const { setCategoryLetterhead, setCategoryPrintBrand } = useRequestContext();

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentBrand = resolvePrintBrand(category);
  const [brand, setBrand] = useState(currentBrand);
  const [savingBrand, setSavingBrand] = useState(false);
  const [brandError, setBrandError] = useState<string | null>(null);
  const [brandSaved, setBrandSaved] = useState(false);
  const trimmedBrand = brand.replace(/\s+/g, " ").trim();
  const brandInvalid = FILE_NAME_FORBIDDEN_CHARS.test(trimmedBrand)
    ? 'Không được chứa các ký tự \\ / : * ? " < > |'
    : null;

  const handleLetterheadFile = async (file: File) => {
    // Chặn sớm phía trình duyệt — máy chủ vẫn kiểm lại đúng loại file thật
    // trên R2 (app/api/categories/[id]/letterhead), đây chỉ để khỏi tải lên
    // 1 file rồi mới bị từ chối.
    if (!LETTERHEAD_IMAGE_TYPES.includes(file.type)) {
      setUploadError("Chỉ nhận ảnh PNG, JPG, WEBP hoặc GIF.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("files", file);
      const uploadRes = await fetch("/api/uploads", { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const body = (await uploadRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Không thể tải ảnh lên.");
      }
      const uploadData = (await uploadRes.json()) as {
        attachments: { path: string; name: string; size: number }[];
      };
      const uploaded = uploadData.attachments[0];
      if (!uploaded) throw new Error("Không thể tải ảnh lên.");

      const patchRes = await fetch(`/api/categories/${category.id}/letterhead`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: uploaded.path, name: uploaded.name }),
      });
      if (!patchRes.ok) {
        const body = (await patchRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Không thể lưu ảnh cho công ty này.");
      }
      setCategoryLetterhead(category.id, uploaded.path, uploaded.name);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const saveBrand = async () => {
    if (brandInvalid) return;
    setSavingBrand(true);
    setBrandError(null);
    setBrandSaved(false);
    try {
      const res = await fetch(`/api/categories/${category.id}/print-brand`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printBrandName: trimmedBrand }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; printBrandName?: string };
      if (!res.ok) throw new Error(body.error ?? "Không lưu được tên hiển thị.");
      const saved = body.printBrandName ?? trimmedBrand;
      setCategoryPrintBrand(category.id, saved);
      setBrand(saved);
      setBrandSaved(true);
    } catch (err) {
      setBrandError(err instanceof Error ? err.message : "Có lỗi xảy ra.");
    } finally {
      setSavingBrand(false);
    }
  };

  const previewName = printFileBaseName(trimmedBrand, SAMPLE_CODE);
  const previewFooter = trimmedBrand ? `${previewName} · Trang 1 / 2` : "Trang 1 / 2";

  return (
    <Modal title={`Cài đặt thông tin – ${category.code} - ${category.name}`} width={560} onClose={onClose}>
      <div className="flex flex-col gap-6 text-[14px]">
        <section>
          <h3 className="mb-1 font-semibold text-gray-800">Logo và tên công ty</h3>
          <p className="mb-2 text-[12px] text-gray-500">
            Ảnh in ở đầu bản in đề xuất và file Word / Excel tải về, cho mọi nhóm của công ty này.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 truncate text-[13px] text-gray-700" title={category.letterheadImageName}>
              {category.letterheadImageName ?? "Chưa có ảnh"}
            </span>
            <label className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded border border-[var(--color-border)] px-3 text-[13px] font-medium text-gray-700 hover:bg-gray-50">
              <ImageUp size={14} />
              {uploading ? "Đang tải lên..." : category.letterheadImageName ? "Đổi ảnh" : "Chọn ảnh"}
              <input
                ref={fileInputRef}
                type="file"
                accept={LETTERHEAD_IMAGE_TYPES.join(",")}
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleLetterheadFile(file);
                }}
              />
            </label>
          </div>
          {uploadError && <p className="mt-1.5 text-[12px] text-[var(--color-danger-red)]">{uploadError}</p>}
        </section>

        <section className="border-t border-[var(--color-border)] pt-5">
          <label htmlFor={`print-brand-${category.id}`} className="mb-1 block font-semibold text-gray-800">
            Tên hiển thị khi in / tải file
          </label>
          <p className="mb-2 text-[12px] text-gray-500">
            Dùng cho tên file PDF / Word / Excel và chân trang. Để trống để ẩn.
          </p>
          <div className="flex gap-2">
            <input
              id={`print-brand-${category.id}`}
              type="text"
              value={brand}
              maxLength={PRINT_BRAND_MAX_LENGTH}
              onChange={(e) => {
                setBrand(e.target.value);
                setBrandSaved(false);
              }}
              placeholder="Để trống để ẩn"
              className="h-9 min-w-0 flex-1 rounded border border-[var(--color-border)] px-3 text-[14px] text-gray-800 outline-none focus:border-[var(--color-action-blue)]"
            />
            <button
              type="button"
              onClick={saveBrand}
              disabled={savingBrand || !!brandInvalid || trimmedBrand === currentBrand}
              className="h-9 shrink-0 rounded bg-[var(--color-action-blue)] px-4 text-[14px] font-medium text-white hover:brightness-95 disabled:opacity-50"
            >
              {savingBrand ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
          {(brandInvalid || brandError) && (
            <p className="mt-1.5 text-[12px] text-[var(--color-danger-red)]">{brandInvalid ?? brandError}</p>
          )}
          {brandSaved && !brandError && <p className="mt-1.5 text-[12px] text-emerald-600">Đã lưu.</p>}
          <div className="mt-3 rounded border border-[var(--color-border)] bg-gray-50 px-3 py-2 text-[12px] leading-relaxed text-gray-600">
            <div>
              Tên file: <b className="text-gray-800">{previewName}.pdf</b> / .docx / .xlsx
            </div>
            <div>
              Chân trang: <b className="text-gray-800">{previewFooter}</b>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
