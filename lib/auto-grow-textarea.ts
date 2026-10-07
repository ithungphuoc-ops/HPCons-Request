/**
 * Tính chiều cao cho ô nhập văn bản TỰ GIÃN trong bảng (Sếp duyệt demo
 * 07/10/2026 "o-bang-tu-xuong-dong"): ô cao dần theo số dòng chữ, tối đa
 * `maxRows` dòng khi đang nhập — vượt quá thì đứng yên ở mức tối đa và cuộn
 * bên trong ô. Tách thành hàm thuần để test được, component chỉ việc đo
 * `scrollHeight` rồi gọi hàm này.
 */
export interface AutoGrowMetrics {
  /** `el.scrollHeight` sau khi đặt `height: auto` (đã gồm padding, CHƯA gồm viền). */
  scrollHeight: number;
  /** Chiều cao 1 dòng chữ (px) — khớp `line-height` của ô. */
  lineHeight: number;
  /** Tổng padding trên + dưới (px). */
  paddingY: number;
  /** Tổng viền trên + dưới (px) — ô dùng `box-sizing: border-box`. */
  borderY: number;
  /** Số dòng tối đa trước khi chuyển sang cuộn trong ô. */
  maxRows: number;
}

export function computeAutoGrowHeight({
  scrollHeight,
  lineHeight,
  paddingY,
  borderY,
  maxRows,
}: AutoGrowMetrics): { height: number; scroll: boolean } {
  const minHeight = lineHeight + paddingY + borderY;
  const maxHeight = lineHeight * Math.max(1, maxRows) + paddingY + borderY;
  const wanted = Math.max(minHeight, Math.ceil(scrollHeight) + borderY);
  if (wanted > maxHeight) return { height: maxHeight, scroll: true };
  return { height: wanted, scroll: false };
}

