import { describe, expect, it, vi } from "vitest";

// Các hàm cần test là hàm thuần, nhưng file chứa chúng kéo theo Firebase Admin
// — mock rỗng như find-invalid-table-rows.test.ts.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({ adminDb: {} }));
vi.mock("@/lib/hpcore", () => ({ getHpcoreDb: vi.fn() }));

const { findInvalidTableRows } = await import("./requests");
const { planTableSupplement } = await import("./request-supplement");
import { buildFormTable } from "@/lib/request-form-export/model";
import { tableFieldCellValues } from "@/lib/request-list-format";
import { buildPrintTemplateData } from "@/lib/print-template";
import type { ProposalField, RequestInstance } from "@/lib/types";

// 4 kiểu cột bảng mới (Sếp duyệt demo 07/10/2026) — kiểm các nơi đọc/ghi ô bảng.

const staffField: ProposalField = {
  id: "f1",
  code: "nhan_su",
  name: "Danh sách nhân sự",
  dataType: "table",
  required: false,
  order: 1,
  tableColumns: ["Họ và tên", "Ngày sinh", "Bắt đầu dùng", "Có dùng NAS không?", "Phần mềm cần cấp"],
  tableColumnTypes: ["text", "date", "datetime", "single_choice", "multiple_choice"],
  tableColumnRequired: [true, true, false, true, false],
  tableColumnOptions: ["", "", "", "Có,Không", "Base,Email công ty,NAS"],
};

const rows = (r: string[][]) => r.map((cells) => ({ cells }));

function makeRequest(values: Record<string, unknown>, overrides: Partial<RequestInstance> = {}): RequestInstance {
  return {
    id: "r1",
    code: "000200",
    groupId: "g1",
    groupNameSnapshot: "Nhân sự",
    fieldsSnapshot: [staffField],
    values,
    submittedBy: { uid: "u1", email: "a@b.com", name: "Nguyễn Văn A" },
    submittedAt: "2026-10-07T01:00:00.000Z",
    updatedAt: "2026-10-07T01:00:00.000Z",
    approvalFlow: "sequential",
    approversSnapshot: [],
    approvers: [],
    followers: [],
    status: "approved",
    deadlineAt: null,
    history: [],
    comments: [],
    deletedAt: null,
    ...overrides,
  } as unknown as RequestInstance;
}

describe("findInvalidTableRows — cột Ngày/Danh sách", () => {
  it("dữ liệu đúng → không lỗi; multi rỗng ở cột không bắt buộc vẫn được", () => {
    const issues = findInvalidTableRows([staffField], {
      f1: rows([["Nguyễn Văn A", "1995-04-12", "2026-10-07T08:30", "Có", "Base, NAS"], ["A2", "1990-01-01", "", "Không", ""]]),
    });
    expect(issues).toEqual([]);
  });

  it("ngày sai định dạng, phương án lạ → lỗi đúng câu", () => {
    const issues = findInvalidTableRows([staffField], {
      f1: rows([["Nguyễn Văn A", "12/04/1995", "2026-10-07 8h", "Có lẽ", "Base, Zalo"]]),
    });
    expect(issues.map((i) => i.message)).toEqual([
      'Dòng 1 của "Danh sách nhân sự": "Ngày sinh" phải là ngày hợp lệ (dd/mm/yyyy) (đang nhập "12/04/1995").',
      'Dòng 1 của "Danh sách nhân sự": "Bắt đầu dùng" phải là ngày giờ hợp lệ (dd/mm/yyyy hh:mm) (đang nhập "2026-10-07 8h").',
      'Dòng 1 của "Danh sách nhân sự": "Có dùng NAS không?" phải là một phương án trong danh sách (đang nhập "Có lẽ").',
      'Dòng 1 của "Danh sách nhân sự": "Phần mềm cần cấp" chỉ được chọn các phương án trong danh sách (đang nhập "Base, Zalo").',
    ]);
  });

  it("cột danh sách bắt buộc để trống → lỗi chưa nhập", () => {
    const issues = findInvalidTableRows([staffField], {
      f1: rows([["Nguyễn Văn A", "1995-04-12", "", "", ""]]),
    });
    expect(issues.map((i) => i.message)).toEqual(['Dòng 1 của "Danh sách nhân sự": "Có dùng NAS không?" chưa nhập.']);
  });

  it('ô nhiều lựa chọn chỉ có "," ở cột bắt buộc → coi là chưa nhập', () => {
    const field: ProposalField = {
      ...staffField,
      tableColumnRequired: [true, true, false, true, true],
    };
    const issues = findInvalidTableRows([field], {
      f1: rows([["Nguyễn Văn A", "1995-04-12", "", "Có", " , "]]),
    });
    expect(issues.map((i) => i.message)).toEqual(['Dòng 1 của "Danh sách nhân sự": "Phần mềm cần cấp" chưa nhập.']);
  });

  it("nhóm cũ (không có cột kiểu mới) → câu lỗi số y như trước", () => {
    const oldField: ProposalField = {
      id: "f2",
      name: "Chi tiết",
      dataType: "table",
      required: false,
      order: 1,
      tableColumns: ["Tên hàng", "Số lượng"],
    };
    const issues = findInvalidTableRows([oldField], { f2: rows([["Xi măng", "abc"]]) });
    expect(issues.map((i) => i.message)).toEqual(['Dòng 1 của "Chi tiết": "Số lượng" phải là số (đang nhập "abc").']);
  });
});

describe("planTableSupplement — dòng nối thêm phải đúng kiểu mới", () => {
  const latest = makeRequest({ f1: rows([["A", "1995-04-12", "", "Có", ""]]) });

  it("ngày sai → 400", () => {
    const plan = planTableSupplement(
      latest,
      { fieldId: "f1", newColumns: [], newRows: [["B", "31/02/2026", "", "Có", ""]] },
      { uid: "u1", name: "A" },
      "2026-10-07T02:00:00.000Z",
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.status).toBe(400);
  });

  it("đúng kiểu → nối được", () => {
    const plan = planTableSupplement(
      latest,
      { fieldId: "f1", newColumns: [], newRows: [["B", "2000-02-29", "", "Không", "NAS"]] },
      { uid: "u1", name: "A" },
      "2026-10-07T02:00:00.000Z",
    );
    expect(plan.ok).toBe(true);
  });
});

describe("hiển thị / in / xuất ô kiểu mới", () => {
  const value = rows([["Nguyễn Văn A", "1995-04-12", "2026-10-07T08:30", "Có", "Base,NAS"]]);

  it("buildFormTable (xuất Word/Excel): ngày dd/MM/yyyy, nhiều lựa chọn 'A, B', không phải ô số", () => {
    const table = buildFormTable(staffField, [["Nguyễn Văn A", "1995-04-12", "2026-10-07T08:30", "Có", "Base,NAS"]]);
    expect(table?.rows[0].map((c) => c.text)).toEqual([
      "1",
      "Nguyễn Văn A",
      "12/04/1995",
      "07/10/2026 08:30",
      "Có",
      "Base, NAS",
    ]);
    expect(table?.rows[0].slice(1).every((c) => c.num === undefined)).toBe(true);
    expect(table?.sumRow).toBeNull();
  });

  it("tableFieldCellValues (tìm kiếm danh sách): ô ngày theo dd/MM/yyyy", () => {
    expect(tableFieldCellValues(makeRequest({ f1: value }))).toEqual([
      "Nguyễn Văn A",
      "12/04/1995",
      "07/10/2026 08:30",
      "Có",
      "Base,NAS",
    ]);
  });

  it("buildPrintTemplateData: thẻ phẳng của bảng định dạng ngày + nhiều lựa chọn", () => {
    const data = buildPrintTemplateData(makeRequest({ f1: value }));
    expect(data.nhan_su).toBe("Nguyễn Văn A / 12/04/1995 / 07/10/2026 08:30 / Có / Base, NAS");
  });
});
