import type { CategoryGroup } from "@/lib/types";

/**
 * Ảnh "tiêu đề công văn" (logo + tên công ty) in ở đầu bản "In đề xuất" —
 * RIÊNG cho từng công ty (category), admin đặt ở trang "Tất cả nhóm đề xuất"
 * (app/api/categories/[id]/letterhead). Dùng chung cho cả client (tải sẵn ở
 * RequestContext, hiện trong RequestDetailView) lẫn server (route ảnh kiểm
 * `v` khớp ảnh hiện tại) — không import gì của server ở đây.
 *
 * Sếp chốt 02/10/2026: bấm In là phải có logo LIỀN. Nên URL ảnh cố định theo
 * CÔNG TY (không theo từng đề xuất — mọi đề xuất cùng công ty dùng lại đúng 1
 * ảnh trình duyệt đã nhớ) và có `v` đổi theo path R2: đổi logo → path mới →
 * URL mới → trình duyệt tự tải ảnh mới, còn cùng logo thì không tải lại.
 */

/** Mã phiên bản ngắn của 1 path R2 — chỉ để đổi URL khi đổi ảnh, không phải
 * bảo mật (djb2, base36). */
export function letterheadVersion(imagePath: string): string {
  let hash = 5381;
  for (let i = 0; i < imagePath.length; i++) {
    hash = ((hash << 5) + hash + imagePath.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

export function letterheadImageUrl(categoryId: string, imagePath: string): string {
  return `/api/categories/${encodeURIComponent(categoryId)}/letterhead/image?v=${letterheadVersion(imagePath)}`;
}

/** Công ty (category) chứa nhóm `groupId` — theo `CategoryGroup.groups` mà
 * GET /api/groups đã ghép sẵn (theo TÊN category). null nếu không tìm thấy. */
export function findCategoryForGroup(
  categoryGroups: CategoryGroup[],
  groupId: string | null | undefined,
): CategoryGroup | null {
  if (!groupId) return null;
  return categoryGroups.find((c) => c.groups.some((g) => g.id === groupId)) ?? null;
}

/** URL ảnh logo của công ty chứa nhóm `groupId` — null nếu không tìm thấy
 * nhóm hoặc công ty đó chưa cài ảnh. */
export function findLetterheadUrl(
  categoryGroups: CategoryGroup[],
  groupId: string | null | undefined,
): string | null {
  const category = findCategoryForGroup(categoryGroups, groupId);
  if (!category?.letterheadImagePath) return null;
  return letterheadImageUrl(category.id, category.letterheadImagePath);
}

/** Tên app gốc — dùng khi đề xuất không thuộc công ty nào. */
export const DEFAULT_PRINT_BRAND = "Base Request";
/** Category mặc định của nhóm chưa xếp công ty (app/api/groups POST). */
const UNCATEGORIZED_NAME = "Chưa phân loại";
/** Giới hạn độ dài "Tên hiển thị khi in / tải file" — đủ cho "HPCons Request". */
export const PRINT_BRAND_MAX_LENGTH = 60;
/** Ký tự Windows cấm trong tên tệp — chặn khi lưu, lọc bỏ khi đặt tên tệp. */
export const FILE_NAME_FORBIDDEN_CHARS = /[\\/:*?"<>|]/;

/**
 * "Tên hiển thị khi in / tải file" của công ty — Sếp chốt 05/10/2026, Admin tự sửa
 * ở "⚙ Cài đặt thông tin" (app/api/categories/[id]/print-brand). Dùng cho tên tệp
 * PDF/Word/Excel và chân trang Word/Excel.
 *  - Chưa từng sửa (undefined) → "<tên công ty> Request" (vd "HPCons Request").
 *  - Admin để TRỐNG → "" = ẩn: tên tệp chỉ còn mã, chân trang chỉ còn số trang.
 *  - Không thuộc công ty nào / "Chưa phân loại" → "Base Request" như trước đây.
 */
export function resolvePrintBrand(category: CategoryGroup | null): string {
  if (!category) return DEFAULT_PRINT_BRAND;
  if (typeof category.printBrandName === "string") return category.printBrandName.trim();
  if (!category.name || category.name === UNCATEGORIZED_NAME) return DEFAULT_PRINT_BRAND;
  return `${category.name} Request`;
}

/** Tên tệp (không đuôi) khi in/tải đề xuất: "<tên hiển thị>-<mã>", hoặc chỉ "<mã>"
 * khi tên hiển thị trống. Bỏ ký tự cấm trong tên tệp. */
export function printFileBaseName(brand: string, code: string): string {
  const clean = (s: string) => s.replace(new RegExp(FILE_NAME_FORBIDDEN_CHARS.source, "g"), " ").replace(/\s+/g, " ").trim();
  const b = clean(brand);
  const c = clean(code) || "de-xuat";
  return b ? `${b}-${c}` : c;
}

/** Mọi URL logo đang có — để tải sẵn ngay khi vào app. */
export function allLetterheadUrls(categoryGroups: CategoryGroup[]): string[] {
  return categoryGroups
    .filter((c) => c.letterheadImagePath)
    .map((c) => letterheadImageUrl(c.id, c.letterheadImagePath as string));
}
