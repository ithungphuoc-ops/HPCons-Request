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

/** URL ảnh logo của công ty chứa nhóm `groupId` — null nếu không tìm thấy
 * nhóm hoặc công ty đó chưa cài ảnh. Nhóm thuộc công ty theo
 * `CategoryGroup.groups` mà GET /api/groups đã ghép sẵn (theo TÊN category). */
export function findLetterheadUrl(
  categoryGroups: CategoryGroup[],
  groupId: string | null | undefined,
): string | null {
  if (!groupId) return null;
  const category = categoryGroups.find((c) => c.groups.some((g) => g.id === groupId));
  if (!category?.letterheadImagePath) return null;
  return letterheadImageUrl(category.id, category.letterheadImagePath);
}

/** Mọi URL logo đang có — để tải sẵn ngay khi vào app. */
export function allLetterheadUrls(categoryGroups: CategoryGroup[]): string[] {
  return categoryGroups
    .filter((c) => c.letterheadImagePath)
    .map((c) => letterheadImageUrl(c.id, c.letterheadImagePath as string));
}
