import "server-only";
import {
  docLaiHopDongCongNo,
  docLaiNhaThauPhuCongNo,
  loadContractCodeSuggestions,
  loadSubcontractorCodeSuggestions,
  type ContractCodeSuggestion,
  type SubcontractorCodeSuggestion,
} from "@/lib/congno";
import {
  EXTERNAL_CODE_SOURCE_FIELDS,
  EXTERNAL_CODE_SOURCE_LABELS,
  resolveExternalCodeLookup as resolveExternalCodeLookupClient,
} from "@/lib/external-code-source-labels";
import type { ExternalCodeLookupConfig, ExternalCodeSourceId, ProposalField } from "@/lib/types";

/**
 * Cơ chế tổng quát "ràng buộc mã tham chiếu ngoài" — thay thế
 * `contractCodeLookup` (chỉ hỗ trợ Số Hợp Đồng CĐT), xem
 * openspec/changes/add-external-code-lookup-picker. CHỈ đúng 2 nguồn dưới
 * đây được phép — KHÔNG có đường nào (API/config/biến môi trường) để thêm
 * nguồn thứ 3 lúc runtime mà không sửa file này (Decision 2, 6 design.md).
 */

/**
 * 1 bản ghi thật của 1 nguồn — đã được RÚT GỌN, không phải nguyên document.
 * `fields` chứa TẤT CẢ field server đã duyệt cho nguồn này (đúng danh sách
 * `EXTERNAL_CODE_SOURCE_FIELDS[sourceId]`, cộng thêm field hiện phụ nếu có,
 * vd `diaChi` không dùng để khớp nhưng vẫn hiện phụ được) — Admin chọn ĐÚNG 1
 * key trong đây làm `matchField` (Decision 4, 30/09/2026 — thay bản đầu
 * "khớp 1 trong nhiều field" dễ gây nhầm), field khác trong `fields` dùng làm
 * cột phụ hiển thị hoặc để TỰ ĐỘNG ĐIỀN sang field khác (`autofillFromLookup`).
 */
export interface ExternalCodeRecord {
  fields: Record<string, string>;
}

export interface ExternalCodeSourceDef {
  id: ExternalCodeSourceId;
  label: string;
  loadRecords(): Promise<ExternalCodeRecord[]>;
  /** Đọc thẳng nguồn (bỏ qua nhớ tạm, có giới hạn tần suất) — chỉ dùng khi validate thấy mã không khớp,
   * để mã vừa thêm bên Công nợ mà báo thay đổi bị trượt không bị chặn oan (xem docLaiHopDongCongNo). */
  loadRecordsFresh(): Promise<ExternalCodeRecord[]>;
}

const banGhiHopDong = (contracts: ContractCodeSuggestion[]): ExternalCodeRecord[] =>
  contracts.map((c) => ({
    fields: { code: c.code, project: c.project, work: c.work, customerNameShort: c.customerNameShort },
  }));

const banGhiNhaThau = (subcontractors: SubcontractorCodeSuggestion[]): ExternalCodeRecord[] =>
  subcontractors.map((s) => ({
    fields: { ma: s.ma, ten: s.ten, tenVietTat: s.tenVietTat, mst: s.mst, diaChi: s.diaChi },
  }));

const congnoContracts: ExternalCodeSourceDef = {
  id: "congno_contracts",
  label: EXTERNAL_CODE_SOURCE_LABELS.congno_contracts,
  async loadRecords() {
    return banGhiHopDong(await loadContractCodeSuggestions());
  },
  async loadRecordsFresh() {
    return banGhiHopDong(await docLaiHopDongCongNo());
  },
};

const congnoSubcontractors: ExternalCodeSourceDef = {
  id: "congno_subcontractors",
  label: EXTERNAL_CODE_SOURCE_LABELS.congno_subcontractors,
  async loadRecords() {
    return banGhiNhaThau(await loadSubcontractorCodeSuggestions());
  },
  async loadRecordsFresh() {
    return banGhiNhaThau(await docLaiNhaThauPhuCongNo());
  },
};

export const EXTERNAL_CODE_SOURCES: Record<ExternalCodeSourceId, ExternalCodeSourceDef> = {
  congno_contracts: congnoContracts,
  congno_subcontractors: congnoSubcontractors,
};

/** Danh sách nguồn theo đúng thứ tự hiển thị trong UI (2 thẻ chọn nguồn). */
export const EXTERNAL_CODE_SOURCE_LIST: ExternalCodeSourceDef[] = [congnoContracts, congnoSubcontractors];

export { EXTERNAL_CODE_SOURCE_FIELDS };

/**
 * Đọc cấu hình ràng buộc mã tham chiếu của 1 field — TƯƠNG THÍCH NGƯỢC với
 * cờ cũ `contractCodeLookup: boolean` (field trên production chưa được sửa
 * lại qua UI mới). MỌI nơi cần biết field có ràng buộc gì PHẢI gọi qua hàm
 * này, không đọc trực tiếp `field.externalCodeLookup`/`field.contractCodeLookup`
 * ở nơi khác (Decision 8 design.md — tránh 2 nơi tự đọc rồi xử lý khác nhau).
 * Chỉ re-export lại bản client-safe — giữ 1 hàm DUY NHẤT xử lý logic tương
 * thích ngược (matchField mặc định khi chưa có), không lặp lại ở đây.
 */
export function resolveExternalCodeLookup(field: ProposalField): ExternalCodeLookupConfig | undefined {
  return resolveExternalCodeLookupClient(field) ?? undefined;
}
