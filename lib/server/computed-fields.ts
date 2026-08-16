import { evaluateConditionGroup } from "@/lib/server/conditions";
import type { ComputedFieldConfig, ProposalField } from "@/lib/types";

/**
 * Thay thế mọi `${code}` trong 1 mẫu chuỗi bằng giá trị field tương ứng
 * (tra theo `field.code` trong CÙNG đề xuất). `code` không khớp field nào
 * thì GIỮ NGUYÊN chuỗi `${code}` không thay thế (không xoá trắng, không
 * throw) — để dễ phát hiện cấu hình sai (gõ nhầm mã field) thay vì âm thầm
 * ra kết quả rỗng/thiếu.
 *
 * Cố ý KHÔNG import "server-only" (giống lib/server/conditions.ts) để dùng
 * được cả từ client component (submit/page.tsx, tính lại theo thời gian
 * thực) lẫn từ server (lib/server/requests.ts, tính lại lúc gửi chính thức).
 */
export function resolveTemplate(
  template: string,
  values: Record<string, unknown>,
  fields: ProposalField[],
): string {
  return template.replace(/\$\{([^}]+)\}/g, (whole, code: string) => {
    const field = fields.find((f) => f.code === code);
    if (!field) return whole;
    const raw = values[field.id];
    return raw === undefined || raw === null ? "" : String(raw);
  });
}

/**
 * Tính giá trị field "tự tính" — lặp `config.branches` theo thứ tự, trả về
 * chuỗi đã ghép (`resolveTemplate`) của nhánh ĐẦU TIÊN có điều kiện thoả mãn
 * (hoặc không có điều kiện — luôn khớp). Trả `null` nếu không nhánh nào khớp
 * (field coi như chưa tính được, nơi gọi tự quyết định cho gõ tay bình thường).
 */
export function resolveComputedValue(
  config: ComputedFieldConfig,
  values: Record<string, unknown>,
  fields: ProposalField[],
): string | null {
  for (const branch of config.branches) {
    if (!branch.condition || evaluateConditionGroup(branch.condition, values, fields)) {
      return resolveTemplate(branch.template, values, fields);
    }
  }
  return null;
}

/**
 * Kiểm tra field `field` (đang được cấu hình `computedFrom`) có tham chiếu
 * `${code}` (ở BẤT KỲ nhánh nào) tới 1 field KHÁC cũng có `computedFrom`
 * không — dùng để chặn tham chiếu vòng/nhiều tầng khi lưu cấu hình nhóm
 * (xem specs/computed-field-values — "Ngăn field computed tham chiếu vòng
 * tròn tới field computed khác"). Trả về `code` của field-computed-khác đầu
 * tiên bị tham chiếu, hoặc `null` nếu không có.
 *
 * Chỉ kiểm tra 1 tầng (field → field khác có computedFrom) — KHÔNG dò cả
 * chuỗi tham chiếu bắc cầu (A → B → C), vì field B có computedFrom là đã đủ
 * điều kiện để bị chặn ngay tại đây, không cần đợi phát hiện qua C.
 */
export function findReferencedComputedFieldCode(
  field: Pick<ProposalField, "computedFrom">,
  allFields: ProposalField[],
): string | null {
  if (!field.computedFrom) return null;

  const referencedCodes = new Set<string>();
  for (const branch of field.computedFrom.branches) {
    for (const match of branch.template.matchAll(/\$\{([^}]+)\}/g)) {
      referencedCodes.add(match[1]);
    }
  }

  for (const code of referencedCodes) {
    const referenced = allFields.find((f) => f.code === code);
    if (referenced?.computedFrom) return code;
  }
  return null;
}
