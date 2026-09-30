import type { ExternalCodeSourceId, ProposalField } from "@/lib/types";

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

/**
 * Tương thích ngược với cờ cũ `contractCodeLookup: boolean` — bản CLIENT-SAFE
 * của `resolveExternalCodeLookup` (lib/external-code-sources.ts), chỉ đọc
 * field object, không đụng Firestore. Dùng ở AddFieldModal để biết field
 * đang sửa đã có ràng buộc gì (hiện tóm tắt sẵn thay vì bắt chọn lại).
 */
export function resolveExternalCodeSourceId(
  field: Pick<ProposalField, "externalCodeLookup" | "contractCodeLookup">,
): ExternalCodeSourceId | null {
  if (field.externalCodeLookup) return field.externalCodeLookup.sourceId;
  if (field.contractCodeLookup) return "congno_contracts";
  return null;
}
