import type { ExternalCodeLookupConfig, ExternalCodeSourceId, ProposalField } from "@/lib/types";

/**
 * Phần DÙNG CHUNG được cả client lẫn server của cơ chế "ràng buộc mã tham
 * chiếu ngoài" (xem lib/external-code-sources.ts, phần đọc/ghi Firestore
 * thật) — file này KHÔNG import "server-only"/Firestore, an toàn dùng trong
 * component client (`components/request/modals/AddFieldModal.tsx`).
 */

export const EXTERNAL_CODE_SOURCE_LABELS: Record<ExternalCodeSourceId, string> = {
  congno_contracts: "Số Hợp Đồng CĐT (Công nợ)",
  congno_subcontractors: "Mã nhà thầu phụ (Công nợ)",
};

/** Đúng thứ tự hiển thị 2 thẻ chọn nguồn trong UI. */
export const EXTERNAL_CODE_SOURCE_ID_LIST: ExternalCodeSourceId[] = [
  "congno_contracts",
  "congno_subcontractors",
];

export interface ExternalCodeFieldMeta {
  key: string;
  label: string;
}

/**
 * Danh sách field mỗi nguồn CHO PHÉP chọn — dùng CHUNG cho 2 việc (Sếp chốt
 * 30/09/2026): (1) Admin chọn ĐÚNG 1 field để khớp/gợi ý (thay "khớp 1 trong
 * nhiều field" ban đầu — dễ nhầm không biết đang khớp theo gì); (2) chọn field
 * nào của bản ghi đã khớp để TỰ ĐỘNG ĐIỀN sang 1 field khác (vd "MST Nhà thầu
 * phụ" tự điền theo "Tên nhà thầu phụ đề xuất" vừa chọn). Phải khớp CHÍNH XÁC
 * key trong `fields` trả về từ `ExternalCodeSourceDef.loadRecords()`
 * (lib/external-code-sources.ts, phía server) — 2 nơi cố ý lặp lại danh sách
 * NÀY (không phải dữ liệu Firestore) vì phía server cần thêm phần đọc DB,
 * phía client chỉ cần tên+nhãn để vẽ UI chọn.
 */
export const EXTERNAL_CODE_SOURCE_FIELDS: Record<ExternalCodeSourceId, ExternalCodeFieldMeta[]> = {
  congno_contracts: [
    { key: "code", label: "Mã hợp đồng" },
    { key: "project", label: "Dự án" },
    { key: "work", label: "Hạng mục" },
    { key: "customerNameShort", label: "Tên CĐT (rút gọn)" },
  ],
  congno_subcontractors: [
    { key: "ma", label: "Mã NCC" },
    { key: "ten", label: "Tên nhà cung cấp" },
    { key: "tenVietTat", label: "Tên viết tắt" },
    { key: "mst", label: "MST/CCCD" },
    { key: "diaChi", label: "Địa chỉ" },
  ],
};

/** Field mặc định dùng để khớp khi chưa Admin chưa tự chọn (tương thích
 * ngược — xem `resolveExternalCodeLookup` bên dưới). */
const DEFAULT_MATCH_FIELD: Record<ExternalCodeSourceId, string> = {
  congno_contracts: "code",
  congno_subcontractors: "ten",
};

/**
 * Tương thích ngược với cờ cũ `contractCodeLookup: boolean` VÀ với field mới
 * tạo TRƯỚC KHI có bước "chọn field" (30/09/2026, chỉ 1-2 field thật đang ở
 * tình trạng này) — bản CLIENT-SAFE của `resolveExternalCodeLookup`
 * (lib/external-code-sources.ts), chỉ đọc field object, không đụng
 * Firestore. Dùng ở AddFieldModal để biết field đang sửa đã có ràng buộc gì
 * (hiện tóm tắt sẵn thay vì bắt chọn lại) và ở submit/page.tsx để biết field
 * nào đang bật.
 */
export function resolveExternalCodeLookup(
  field: Pick<ProposalField, "externalCodeLookup" | "contractCodeLookup">,
): ExternalCodeLookupConfig | null {
  if (field.externalCodeLookup) {
    return {
      sourceId: field.externalCodeLookup.sourceId,
      matchField: field.externalCodeLookup.matchField || DEFAULT_MATCH_FIELD[field.externalCodeLookup.sourceId],
    };
  }
  if (field.contractCodeLookup) return { sourceId: "congno_contracts", matchField: "code" };
  return null;
}
