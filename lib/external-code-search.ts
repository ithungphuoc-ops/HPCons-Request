import { normalizeSearch } from "@/components/shared/HighlightMatch";
import type { ExternalCodeSourceId } from "./types";

/**
 * Lọc + sắp xếp dòng gợi ý của ô "mã tham chiếu ngoài" (submit/page.tsx,
 * ShortTextWithExternalCodeLookup) — tách ra đây để test được.
 *
 * - `congno_contracts` (Số Hợp Đồng CĐT): từ 09/10/2026 (demo
 *   tre-han-va-hang-muc, Sếp duyệt) tìm KHÔNG DẤU theo mã + CĐT + HẠNG MỤC
 *   (`work`) + CÔNG TRÌNH (`project`) — vì 1 công trình có nhiều số hợp đồng
 *   gần giống nhau (hợp đồng chính, phụ lục 01-02, 01-04…), gõ theo hạng mục
 *   giúp chọn đúng. Dùng `normalizeSearch` — cùng bộ chuẩn hoá với
 *   HighlightMatch nên phần lọc và phần tô màu khớp nhau.
 * - Nguồn khác (nhà thầu phụ…): GIỮ NGUYÊN cách cũ (chữ thường, có dấu, theo
 *   mã + cột phụ).
 *
 * Sắp xếp như cũ: mã BẮT ĐẦU bằng chuỗi đang gõ lên trước, rồi theo mã.
 */
export interface ExternalCodeSearchRow {
  code: string;
  displayText: string;
  rawFields: Record<string, string>;
}

export const EXTERNAL_CODE_SUGGESTION_LIMIT = 30;

function contractHaystack(row: ExternalCodeSearchRow): string[] {
  return [row.code, row.displayText, row.rawFields.work ?? "", row.rawFields.project ?? ""];
}

export function externalCodeRowMatches(
  sourceId: ExternalCodeSourceId,
  row: ExternalCodeSearchRow,
  rawQuery: string,
): boolean {
  if (sourceId === "congno_contracts") {
    const q = normalizeSearch(rawQuery.trim());
    if (!q) return true;
    return contractHaystack(row).some((s) => normalizeSearch(s).includes(q));
  }
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  return row.code.toLowerCase().includes(q) || row.displayText.toLowerCase().includes(q);
}

export function filterExternalCodeRows<T extends ExternalCodeSearchRow>(
  sourceId: ExternalCodeSourceId,
  rows: T[],
  rawQuery: string,
  limit = EXTERNAL_CODE_SUGGESTION_LIMIT,
): T[] {
  const fold = sourceId === "congno_contracts" ? normalizeSearch : (s: string) => s.toLowerCase();
  const q = fold(rawQuery.trim());
  return rows
    .filter((r) => externalCodeRowMatches(sourceId, r, rawQuery))
    .slice()
    .sort((a, b) => {
      const aStarts = fold(a.code).startsWith(q) ? 0 : 1;
      const bStarts = fold(b.code).startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.code.localeCompare(b.code);
    })
    .slice(0, limit);
}
