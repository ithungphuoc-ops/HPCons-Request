import { formatCellForDisplay, numericTypeForFieldDataType } from "@/lib/table-field";
import type { FieldDataType } from "@/lib/types";

/**
 * Định dạng giá trị trường đề xuất để HIỂN THỊ — dùng chung cho trang chi tiết
 * (RequestDetailView.tsx) và file Word/Excel tải về (lib/request-form-export), để
 * 2 nơi không lệch nhau. Tách ra từ RequestDetailView.tsx 05/10/2026.
 */

export function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

/**
 * Giống `formatValue` nhưng BIẾT kiểu field: field ngày/ngày giờ lưu dạng ISO
 * ("2026-09-14") — hiện nguyên si ra màn hình thì lệch hẳn với ngày tạo/cập
 * nhật ở ngay phía trên (đang dd/MM/yyyy). Sếp yêu cầu thống nhất 13/09/2026.
 *
 * Cắt chuỗi bằng regex thay vì `new Date(...)` — chuỗi "YYYY-MM-DD" trần được
 * JS hiểu là mốc UTC, đổi qua giờ địa phương ở múi giờ âm sẽ LÙI 1 ngày.
 */
export function formatFieldValue(value: unknown, dataType?: FieldDataType): string {
  // Trường số (Số nguyên / Số thập phân / Tiền tệ): dùng CHUNG bộ định dạng
  // với cột bảng, xem numericTypeForFieldDataType() ở lib/table-field.ts.
  const numericType = dataType ? numericTypeForFieldDataType(dataType) : null;
  if (numericType) {
    if (value === undefined || value === null || value === "") return "—";
    return formatCellForDisplay(String(value), numericType) || "—";
  }
  if (dataType === "date" || dataType === "datetime") {
    if (value === undefined || value === null || value === "") return "—";
    const matched = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(value).trim());
    if (matched) {
      const [, y, m, d, hh, mm] = matched;
      return hh ? `${d}/${m}/${y} ${hh}:${mm}` : `${d}/${m}/${y}`;
    }
  }
  return formatValue(value);
}
