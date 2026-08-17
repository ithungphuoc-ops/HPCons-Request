import sanitizeHtml from "sanitize-html";
import type { FieldDataType } from "./types";

/**
 * Làm sạch HTML mô tả nhóm (soạn bằng RichTextEditor/Tiptap) trước khi lưu —
 * chỉ giữ đúng bộ thẻ toolbar hỗ trợ, chặn <script>/onerror=/javascript:...
 * Không tin nội dung client gửi lên dù chỉ hiển thị lại cho người trong công ty.
 */
/**
 * Phần tính toán THUẦN của mã đề xuất (9 chữ số tăng dần — Sếp chốt
 * 17/08/2026, trước đó 6 chữ số; mã cũ đã cấp giữ nguyên trong đề xuất đã
 * gửi, chỉ mã cấp MỚI theo định dạng 9 số) — tách khỏi transaction Firestore
 * thật (lib/server/requests.ts, "server-only" nên không test trực tiếp được)
 * để test được logic định dạng/tăng số bằng vitest, theo đúng cách các hàm
 * khác trong file này đã làm.
 */
export function nextCounterCode(current: number | undefined): { next: number; code: string } {
  const value = current ?? 1;
  return { next: value + 1, code: String(value).padStart(9, "0") };
}

export function sanitizeDescriptionHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "b", "strong", "i", "em", "u", "s", "strike",
      "blockquote", "code", "pre", "h1", "h2", "h3", "ul", "ol", "li", "a", "img",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
  });
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const ok: ValidationResult = { valid: true };

export function validateGroupName(name: string): ValidationResult {
  if (!name.trim()) {
    return { valid: false, error: "Tên nhóm đề xuất không được để trống." };
  }
  return ok;
}

export function validateSlaHours(value: number | null): ValidationResult {
  if (value === null) return ok;
  if (!Number.isFinite(value) || value < 0) {
    return { valid: false, error: "Thời hạn chỉ nhận số không âm." };
  }
  return ok;
}

export function validateFieldName(name: string): ValidationResult {
  if (!name.trim()) {
    return { valid: false, error: "Tên trường không được để trống." };
  }
  return ok;
}

const choiceTypes: FieldDataType[] = ["single_choice", "multiple_choice"];

export function validateFieldOptions(
  dataType: FieldDataType,
  options: string[] | undefined,
): ValidationResult {
  if (!choiceTypes.includes(dataType)) return ok;
  if (!options || options.filter((o) => o.trim()).length === 0) {
    return {
      valid: false,
      error: "Danh sách một lựa chọn hoặc nhiều lựa chọn phải có ít nhất một phương án.",
    };
  }
  return ok;
}

export function validateFieldCodeUnique(
  existingCodes: string[],
  code: string,
): ValidationResult {
  if (existingCodes.includes(code)) {
    return { valid: false, error: "Mã trường phải duy nhất trong một nhóm." };
  }
  return ok;
}

export function validatePermissionSelection(
  selectedCodes: string[],
): ValidationResult {
  if (selectedCodes.length === 0) {
    return { valid: false, error: "Vui lòng chọn ít nhất một quyền quản trị ứng dụng." };
  }
  return ok;
}
