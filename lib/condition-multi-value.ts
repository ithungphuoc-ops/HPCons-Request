/**
 * Mã hoá/giải mã danh sách nhiều giá trị cho `ConditionRule.value` khi dùng
 * toán tử "includes"/"not_includes" trên field 1-giá-trị (single_choice,
 * department_select) — cho phép 1 điều kiện con khớp "1 trong N giá trị"
 * (vd nhiều Bộ phận) cùng lúc, thay vì phải tạo N điều kiện con nối "Hoặc"
 * (Sếp yêu cầu 05/10/2026, xem demo dieu-kien-chon-nhieu-gia-tri-2026-10-05).
 *
 * Lưu dạng JSON mảng chuỗi trong field `value` sẵn có — KHÔNG đổi cấu trúc
 * `ConditionRule`. Dữ liệu CŨ (chuỗi thường — từ thời toán tử "chứa" chưa
 * hoạt động cho field 1-giá-trị, luôn bị coi là không thoả) tự rơi về mảng 1
 * phần tử khi giải mã, không mất dữ liệu và không throw.
 *
 * Dùng CHUNG cho cả client (`ConditionValueInput`) và server
 * (`lib/server/conditions.ts` evaluateRule) — cố ý KHÔNG import "server-only"
 * để cả 2 phía import được.
 */
export function encodeMultiValue(values: string[]): string {
  return JSON.stringify(values);
}

export function decodeMultiValue(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed;
  } catch {
    // Chuỗi thường (dữ liệu cũ, hoặc chưa từng được mã hoá) — coi như 1 giá trị duy nhất.
  }
  return [raw];
}
