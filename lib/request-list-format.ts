import type { ProposalField, RequestInstance } from "@/lib/types";
import { TITLE_FIELD_CODES } from "@/lib/request-title";
import { deserializeTableRows } from "@/lib/table-field";

/**
 * Tách ra từ app/request/list/page.tsx (14/09/2026, change
 * add-request-home-base-layout) — dùng chung cho cả trang danh sách
 * (/request/list) LẪN Trang chủ (/request) để tránh 2 bộ logic hiển thị
 * độc lập cùng đọc `RequestInstance` theo 2 cách khác nhau. Sửa ở đây là
 * sửa cho cả hai nơi.
 */

/** Chữ cái đầu của tên người gửi làm avatar tròn — RequestSubmitter không có
 * sẵn avatarInitial (khác TaggedUser), lấy từ ký tự đầu của name. */
export function submitterInitial(r: RequestInstance): string {
  return (r.submittedBy.name?.trim().charAt(0) || "?").toUpperCase();
}

/** Field "nổi bật" đáng hiện trên dòng danh sách: kiểu lựa chọn/bộ phận/ngày/
 * số — giá trị ngắn, đọc phát hiểu ngay (giống chuỗi phụ của Base.vn thật). */
export const NOTABLE_FIELD_TYPES = new Set([
  "single_choice",
  "department_select",
  "date",
  "datetime",
  "integer",
  "decimal",
  "currency",
]);

export function formatListValue(field: ProposalField, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "";
  const s = String(value);
  if (field.dataType === "date") {
    // Field kiểu "date" (không giờ) thường lưu "YYYY-MM-DD" thuần. Dùng
    // Date.parse() cho chuỗi này sẽ parse theo UTC 00:00 (đúng ISO 8601), rồi
    // toLocaleDateString() lại đổi sang GIỜ ĐỊA PHƯƠNG trình duyệt — với múi
    // giờ ÂM (vd Mỹ) sẽ LÙI MẤT 1 NGÀY dù app chỉ dùng nội bộ VN (múi dương),
    // rủi ro thực tế thấp nhưng vẫn là lỗi kỹ thuật thật (review CodeRabbit
    // PR #33, 17/09/2026). Tách thẳng năm/tháng/ngày từ chuỗi, không qua Date/
    // múi giờ nào cả — an toàn tuyệt đối bất kể máy người xem ở đâu.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  if (field.dataType === "date" || field.dataType === "datetime") {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return new Date(t).toLocaleDateString("vi-VN");
  }
  return s;
}

/** Tối đa 3 cặp {tên field, giá trị} nổi bật của 1 đề xuất — dùng chung cho
 * chuỗi hiển thị lẫn phạm vi tìm kiếm (chỉ tìm trên GIÁ TRỊ, không tìm trên
 * tên field để khỏi khớp nhầm mọi dòng có cùng field). */
export function notableFields(r: RequestInstance): { name: string; value: string }[] {
  return r.fieldsSnapshot
    .filter((f) => NOTABLE_FIELD_TYPES.has(f.dataType) && !(f.code && TITLE_FIELD_CODES.has(f.code)))
    .sort((a, b) => a.order - b.order)
    .map((f) => ({ name: f.name, value: formatListValue(f, r.values[f.id]) }))
    .filter((x) => x.value)
    .slice(0, 3);
}

export function notableFieldParts(r: RequestInstance): string[] {
  return notableFields(r).map((x) => `${x.name}: ${x.value}`);
}

/** Mọi Ô (cell) không rỗng trong các field kiểu bảng ("table"/"base_table")
 * của 1 đề xuất — dùng để mở rộng phạm vi tìm kiếm Trang chủ/Danh sách đề
 * xuất vào tận nội dung bảng "Chi tiết" (Sếp yêu cầu 30/09/2026, theo mẫu
 * Base.vn: gõ "sơn" phải ra được đề xuất có dòng vật tư "Sơn ..." dù tên đề
 * xuất không có chữ đó). KHÔNG phân biệt cột — người dùng không cần nhớ vật
 * tư nằm ở cột nào trong bảng mới tìm ra được. */
export function tableFieldCellValues(r: RequestInstance): string[] {
  return r.fieldsSnapshot
    .filter((f) => f.dataType === "table" || f.dataType === "base_table")
    .flatMap((f) => deserializeTableRows(r.values[f.id]).flat())
    .filter((cell) => cell.trim());
}

/** Ô bảng ĐẦU TIÊN khớp từ khoá tìm kiếm (không phân biệt dấu) — dùng để
 * hiện 1 dòng trích đoạn cho người dùng biết khớp ở đâu trong bảng "Chi
 * tiết", giống cách Base.vn tô sáng đoạn khớp. `null` nếu không có từ khoá
 * hoặc không khớp ô bảng nào (đã khớp ở field khác thì không cần trích đoạn
 * này nữa). */
export function matchedTableCell(r: RequestInstance, query: string): string | null {
  const q = chuanHoaTimKiem(query);
  if (!q) return null;
  return tableFieldCellValues(r).find((cell) => chuanHoaTimKiem(cell).includes(q)) ?? null;
}

export function draftLinkFor(r: RequestInstance): string {
  return r.groupId
    ? `/request/groups/${r.groupId}/submit?draftId=${r.id}`
    : `/request/direct/new?draftId=${r.id}`;
}

/** Bỏ dấu tiếng Việt + hạ chữ thường để tìm kiếm không phụ thuộc dấu ("de nghi" khớp "Đề nghị"). */
export function chuanHoaTimKiem(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim();
}
