import type { ProposalField } from "@/lib/types";

/**
 * Vài mã trường ỔN ĐỊNH quy ước cho "tên riêng" của 1 đề xuất — dùng chung
 * cho mọi nơi hệ thống cần hiển thị/dùng tên của 1 đề xuất cụ thể (danh
 * sách, trang chi tiết, in file .docx, đặt tên file xuất, webhook đồng bộ).
 * Trước change `add-computed-field-values`, hằng số này bị copy độc lập 3
 * lần (lib/print-template.ts, app/api/requests/[id]/export/route.ts,
 * lib/qlkctr-sync.ts) — gộp về đây để tránh lệch nhau khi sửa.
 */
export const TITLE_FIELD_CODES = new Set(["ten_de_xuat", "ten_de_nghi", "ten_phieu", "ten_dang_ky"]);

/**
 * Tiêu đề hiển thị cho 1 đề xuất — ưu tiên giá trị field có `code` thuộc
 * TITLE_FIELD_CODES (khác rỗng), dự phòng dùng tên nhóm (`groupNameSnapshot`)
 * nếu không tìm thấy field nào khớp hoặc giá trị rỗng. Nhận tham số dạng
 * object tối giản (không phải nguyên `RequestInstance`) để dùng được ở cả
 * nơi chỉ có snapshot rút gọn (VD danh sách) lẫn nơi có đầy đủ.
 */
export function resolveRequestTitle(request: {
  fieldsSnapshot: ProposalField[];
  values: Record<string, unknown>;
  groupNameSnapshot: string;
}): string {
  for (const field of request.fieldsSnapshot) {
    if (field.code && TITLE_FIELD_CODES.has(field.code)) {
      const raw = request.values[field.id];
      const value = raw === undefined || raw === null ? "" : String(raw).trim();
      if (value) return value;
    }
  }
  return request.groupNameSnapshot;
}
