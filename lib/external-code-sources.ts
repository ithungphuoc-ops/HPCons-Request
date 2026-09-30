import "server-only";
import {
  loadContractCodeSuggestions,
  loadSubcontractorCodeSuggestions,
} from "@/lib/congno";
import { EXTERNAL_CODE_SOURCE_LABELS, resolveExternalCodeSourceId } from "@/lib/external-code-source-labels";
import type { ExternalCodeLookupConfig, ExternalCodeSourceId, ProposalField } from "@/lib/types";

/**
 * Cơ chế tổng quát "ràng buộc mã tham chiếu ngoài" — thay thế
 * `contractCodeLookup` (chỉ hỗ trợ Số Hợp Đồng CĐT), xem
 * openspec/changes/add-external-code-lookup-picker. CHỈ đúng 2 nguồn dưới
 * đây được phép — KHÔNG có đường nào (API/config/biến môi trường) để thêm
 * nguồn thứ 3 lúc runtime mà không sửa file này (Decision 2, 6 design.md).
 */

/** 1 bản ghi thật của 1 nguồn — đã được RÚT GỌN, không phải nguyên document. */
export interface ExternalCodeRecord {
  /** Mọi giá trị được coi là "mã" hợp lệ của bản ghi này — khớp ĐÚNG 1 trong
   *  các giá trị này (không rỗng) là đủ để qua validate (Decision 4). */
  codeValues: string[];
  /** Cột phụ hiển thị trong gợi ý/xem trước — CỐ ĐỊNH theo nguồn, Admin
   *  không tự chọn field nào khác. */
  display: Record<string, string>;
}

export interface ExternalCodeSourceDef {
  id: ExternalCodeSourceId;
  label: string;
  loadRecords(): Promise<ExternalCodeRecord[]>;
}

const congnoContracts: ExternalCodeSourceDef = {
  id: "congno_contracts",
  label: EXTERNAL_CODE_SOURCE_LABELS.congno_contracts,
  async loadRecords() {
    const contracts = await loadContractCodeSuggestions();
    return contracts.map((c) => ({
      codeValues: c.code ? [c.code] : [],
      display: { project: c.project, work: c.work, customerNameShort: c.customerNameShort },
    }));
  },
};

const congnoSubcontractors: ExternalCodeSourceDef = {
  id: "congno_subcontractors",
  label: EXTERNAL_CODE_SOURCE_LABELS.congno_subcontractors,
  async loadRecords() {
    const subcontractors = await loadSubcontractorCodeSuggestions();
    return subcontractors.map((s) => ({
      codeValues: [s.ma, s.mst].filter(Boolean),
      display: { ten: s.ten, mst: s.mst, diaChi: s.diaChi },
    }));
  },
};

export const EXTERNAL_CODE_SOURCES: Record<ExternalCodeSourceId, ExternalCodeSourceDef> = {
  congno_contracts: congnoContracts,
  congno_subcontractors: congnoSubcontractors,
};

/** Danh sách nguồn theo đúng thứ tự hiển thị trong UI (2 thẻ chọn nguồn). */
export const EXTERNAL_CODE_SOURCE_LIST: ExternalCodeSourceDef[] = [congnoContracts, congnoSubcontractors];

/**
 * Đọc cấu hình ràng buộc mã tham chiếu của 1 field — TƯƠNG THÍCH NGƯỢC với
 * cờ cũ `contractCodeLookup: boolean` (field trên production chưa được sửa
 * lại qua UI mới). MỌI nơi cần biết field có ràng buộc gì PHẢI gọi qua hàm
 * này, không đọc trực tiếp `field.externalCodeLookup`/`field.contractCodeLookup`
 * ở nơi khác (Decision 8 design.md — tránh 2 nơi tự đọc rồi xử lý khác nhau).
 */
export function resolveExternalCodeLookup(field: ProposalField): ExternalCodeLookupConfig | undefined {
  const sourceId = resolveExternalCodeSourceId(field);
  return sourceId ? { sourceId } : undefined;
}
