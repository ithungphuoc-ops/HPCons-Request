/**
 * Xếp nhóm đề xuất theo SỐ ĐẦU TÊN ("0." → "1.0." → "1.1." → "1.2." → "2.2." → "3.0." …)
 * thay vì theo ngày tạo — Sếp chốt 05/10/2026: muốn đổi thứ tự thì chỉ cần sửa số trong
 * tên nhóm. Nhóm không có số đầu tên xếp cuối theo chữ cái; trùng số thì xếp theo tên.
 * CHỈ dùng để HIỂN THỊ ở cột trái (FuncBar, mục "Nhóm đề xuất") và trang "Tất cả nhóm
 * đề xuất" (GroupCategoryCard) — không đổi thứ tự dữ liệu ở nơi khác.
 */

/** "1.0. Phiếu đề nghị" → [1, 0]; "0. Đề xuất trực tiếp" → [0]; không có số → null. */
export function leadingNumber(name: string): number[] | null {
  const m = /^\s*(\d+(?:\.\d+)*)\.?(?=\s|$)/.exec(name ?? "");
  return m ? m[1].split(".").map(Number) : null;
}

const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });

export function compareGroupNames(a: string, b: string): number {
  const na = leadingNumber(a);
  const nb = leadingNumber(b);
  if (na && !nb) return -1;
  if (!na && nb) return 1;
  if (na && nb) {
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      // "1" đứng trước "1.0"/"1.1" (thiếu phần sau = nhỏ hơn).
      const x = na[i] ?? -1;
      const y = nb[i] ?? -1;
      if (x !== y) return x - y;
    }
  }
  return collator.compare(a ?? "", b ?? "");
}

/** Bản sao đã xếp — không sửa mảng gốc (mảng nằm trong state của RequestContext). */
export function sortGroupsByNumber<T extends { name: string }>(groups: T[]): T[] {
  return groups.slice().sort((a, b) => compareGroupNames(a.name, b.name));
}
