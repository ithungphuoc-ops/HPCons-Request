import type { FormLogo } from "@/lib/request-form-export/docx";
import type { RequestFormModel } from "@/lib/request-form-export/model";

/**
 * Tải đề xuất ra Word/Excel ngay trên trình duyệt (menu "··· Thêm" của trang chi tiết).
 * Thư viện docx/exceljs tải lười lúc bấm — không cộng vào bundle khi mở trang.
 */

/** Đọc ảnh logo (route ảnh của công ty, trình duyệt đã nhớ sẵn) → bytes + kích thước.
 * Ảnh WEBP/GIF… đổi sang PNG (Word/Excel chỉ chắc chắn nhận PNG/JPEG). Lỗi → null
 * (file vẫn tải được, chỉ thiếu logo — giống bản in). */
export async function loadFormLogo(url: string | null): Promise<FormLogo | null> {
  if (!url) return null;
  let bitmap: ImageBitmap | null = null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    if (!width || !height) return null;
    let bytes: Uint8Array;
    let type: FormLogo["type"];
    if (blob.type === "image/png" || blob.type === "image/jpeg") {
      bytes = new Uint8Array(await blob.arrayBuffer());
      type = blob.type === "image/png" ? "png" : "jpg";
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!png) return null;
      bytes = new Uint8Array(await png.arrayBuffer());
      type = "png";
    }
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { bytes, base64: btoa(binary), type, width, height };
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function downloadRequestWord(model: RequestFormModel, logo: FormLogo | null): Promise<void> {
  const [docx, { buildRequestDocx }] = await Promise.all([import("docx"), import("@/lib/request-form-export/docx")]);
  const blob = await docx.Packer.toBlob(buildRequestDocx(docx, model, logo));
  saveBlob(blob, `${model.fileBaseName}.docx`);
}

export async function downloadRequestExcel(model: RequestFormModel, logo: FormLogo | null): Promise<void> {
  const [excelModule, { buildRequestXlsx }] = await Promise.all([import("exceljs"), import("@/lib/request-form-export/xlsx")]);
  const ExcelJS = ((excelModule as unknown as { default?: typeof excelModule }).default ?? excelModule) as typeof excelModule;
  const wb = await buildRequestXlsx(ExcelJS, model, logo);
  const buffer = await wb.xlsx.writeBuffer();
  saveBlob(
    new Blob([buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${model.fileBaseName}.xlsx`,
  );
}
