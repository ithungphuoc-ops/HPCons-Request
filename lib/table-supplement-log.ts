import { TABLE_SUPPLEMENT_HISTORY_PREFIX } from "@/lib/request-history-labels";
import type { RequestHistoryEntry } from "@/lib/types";

/**
 * Các dòng ĐÃ bổ sung sau duyệt bằng khối bảng cũ (trước 15/09/2026) của 1 field
 * bảng, kèm giờ từng lần — suy hoàn toàn từ dữ liệu server (`history` + dòng hiện
 * có). Bổ sung CHỈ NỐI VÀO CUỐI (không chèn/sửa/xoá dòng cũ, xem route
 * table-supplement), nên đếm tổng số dòng đã bổ sung qua `history` rồi cắt đúng
 * số đó ở cuối bảng hiện tại là khớp đúng thứ tự. Dùng chung cho trang chi tiết
 * (TableSupplementControl) và file Word/Excel tải về (lib/request-form-export).
 */
export function loggedSupplementRows(
  fieldName: string,
  columnCount: number,
  allRows: string[][],
  history: RequestHistoryEntry[],
): { row: string[]; at: string }[] {
  const emptyRow = () => Array.from({ length: columnCount }, () => "");
  const batchRe = /\(lần \d+\): thêm (\d+) dòng vào "(.+)"$/;
  const batches: { count: number; at: string }[] = [];
  for (const h of history) {
    if (!h.action.startsWith(TABLE_SUPPLEMENT_HISTORY_PREFIX)) continue;
    const m = h.action.match(batchRe);
    if (!m || m[2] !== fieldName) continue;
    const count = Number(m[1]);
    if (Number.isFinite(count) && count > 0) batches.push({ count, at: h.at });
  }
  const totalSupplementRows = batches.reduce((sum, b) => sum + b.count, 0);
  const splitIndex = Math.max(0, allRows.length - totalSupplementRows);
  const supplementTailRows = allRows.slice(splitIndex);
  const loggedRows: { row: string[]; at: string }[] = [];
  let cursor = 0;
  for (const b of batches) {
    for (let i = 0; i < b.count; i++) {
      loggedRows.push({ row: supplementTailRows[cursor] ?? emptyRow(), at: b.at });
      cursor++;
    }
  }
  return loggedRows;
}
