import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as Docx from "docx";
import ExcelJS from "exceljs";
import { buildRequestFormModel, excelNumFmt } from "./model";
import { buildRequestDocx, type FormLogo } from "./docx";
import { buildRequestXlsx } from "./xlsx";
import type { ProposalField, RequestHistoryEntry, RequestInstance } from "@/lib/types";

const field = (id: string, name: string, dataType: ProposalField["dataType"], order: number, extra: Partial<ProposalField> = {}): ProposalField =>
  ({ id, name, dataType, order, required: false, ...extra }) as ProposalField;

// Mô phỏng đề nghị 000000189 (bản in Sếp gửi 01/10/2026).
function sampleRequest(overrides: Partial<RequestInstance> = {}): RequestInstance {
  return {
    id: "Jbgm6Xq5wrUcFpaOp66b",
    code: "000000189",
    groupId: "g1",
    groupNameSnapshot: "1.0. Phiếu đề nghị",
    fieldsSnapshot: [
      field("f1", "Tên đề xuất", "short_text", 1),
      field("f7", "Ngày đề nghị cấp", "date", 7),
      field("f8", "Chi tiết", "table", 8, {
        tableColumns: ["Tên hàng", "Quy cách/chủng loại", "Số lượng", "ĐVT", "Mục đích sử dụng", "Ghi Chú"],
        tableColumnTypes: ["text", "text", "decimal", "text", "text", "text"],
        tableColumnSum: [false, false, true, false, false, false],
      }),
      field("f9", "Tài liệu đính kèm ( nếu có )", "file", 9),
      field("f5", "Bộ phận", "short_text", 5),
    ],
    values: {
      f1: "07/2025/HĐXD-HPCS | CÔNG TRÌNH AID-TEXT",
      f5: "Phòng Kỹ thuật Thi công (HP Cons)",
      f7: "2026-10-09",
      f8: [
        { cells: ["Gạch Block", "390×190×90", "1900", "Viên", "Xây tường hàng rào gạch Block", ""] },
        { cells: ["Xi măng", "PCB 40", "100.5", "Bao", "Xây tường", ""] },
        { cells: ["", "", "", "", "", ""] },
      ],
      f9: [],
    },
    submittedBy: { uid: "u1", name: "Phan Bá Nam" },
    submittedAt: "2026-09-30T03:50:53.000Z",
    updatedAt: "2026-10-01T02:15:20.000Z",
    approvalFlow: "sequential",
    approversSnapshot: [],
    approvers: [],
    followers: [],
    status: "approved",
    deadlineAt: "2026-09-30T11:50:53.000Z",
    history: [],
    comments: [],
    deletedAt: null,
    ...overrides,
  } as unknown as RequestInstance;
}

const adjustmentHistory: RequestHistoryEntry[] = [
  { at: "2026-10-01T02:15:20.000Z", actor: "Phan Bá Nam", action: "Điều chỉnh sau duyệt (lần 1)", note: "Tăng 200 viên gạch Block", attachmentName: "BO SUNG LAN 1.xlsx" },
];

const baseInput = (overrides: Partial<RequestInstance> = {}) => ({
  request: sampleRequest(overrides),
  history: adjustmentHistory,
  attachments: [{ name: "BO SUNG LAN 1.xlsx", path: "requests/u1/1-a.xlsx", size: 1000 }],
  approvalTimeFields: [],
  brand: "HPCons Request",
  now: Date.parse("2026-10-05T00:00:00Z"),
});

// PNG 1×1 hợp lệ — đóng vai logo (kích thước khai báo theo ảnh tiêu đề thật 1033×97).
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const logo: FormLogo = { bytes: Uint8Array.from(Buffer.from(PNG_B64, "base64")), base64: PNG_B64, type: "png", width: 1033, height: 97 };

describe("buildRequestFormModel", () => {
  it("đúng thứ tự trường, KHÔNG kèm kiểu dữ liệu, định dạng ngày như trên web", () => {
    const m = buildRequestFormModel(baseInput());
    expect(m.fields.map((f) => f.label)).toEqual(["01. Tên đề xuất", "02. Bộ phận", "03. Ngày đề nghị cấp", "04. Chi tiết", "05. Tài liệu đính kèm ( nếu có )"]);
    expect(JSON.stringify(m)).not.toMatch(/Văn bản ngắn|Một lựa chọn|Tệp tin|"Bảng"|"Ngày"/);
    expect(m.fields[2].value).toBe("09/10/2026");
    expect(m.fields[4].value).toBe("Chưa có tệp nào");
  });

  it("bảng: bỏ dòng trống, số là số thật kèm định dạng, dòng Tổng cộng theo tick", () => {
    const table = buildRequestFormModel(baseInput()).fields[3].table!;
    expect(table.columns[0]).toBe("#");
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][3]).toMatchObject({ text: "1,900", num: 1900, numFmt: "#,##0", align: "right" });
    expect(table.rows[1][3]).toMatchObject({ text: "100.5", num: 100.5, numFmt: "#,##0.###" });
    expect(table.sumRow![1].text).toBe("Tổng cộng");
    expect(table.sumRow![3]).toMatchObject({ num: 2000.5, text: "2,000.5" });
  });

  it("tên file + chân trang theo Tên hiển thị; để trống thì chỉ còn mã", () => {
    expect(buildRequestFormModel(baseInput())).toMatchObject({ fileBaseName: "HPCons Request-000000189", footerLabel: "HPCons Request-000000189" });
    expect(buildRequestFormModel({ ...baseInput(), brand: "" })).toMatchObject({ fileBaseName: "000000189", footerLabel: "" });
  });

  it("điều chỉnh sau duyệt: chỉ khi đã chấp thuận, có lần điều chỉnh + tệp + nhãn đính sau duyệt", () => {
    const m = buildRequestFormModel(baseInput());
    expect(m.adjustment?.entries).toEqual([expect.objectContaining({ note: "Tăng 200 viên gạch Block", file: "BO SUNG LAN 1.xlsx" })]);
    expect(m.adjustment?.entries[0].meta).toMatch(/^Phan Bá Nam · .+ · lần 1$/);
    expect(m.adjustment?.attachments).toEqual([{ name: "BO SUNG LAN 1.xlsx", meta: undefined }]);
    expect(buildRequestFormModel(baseInput({ status: "pending" })).adjustment).toBeNull();
  });

  it("thông tin đề xuất: thời gian còn lại chỉ đếm khi đang chờ duyệt", () => {
    const approved = buildRequestFormModel(baseInput());
    expect(approved.info.map((i) => i.label)).toEqual(["Người tạo", "Nhóm đề xuất", "Thời gian tạo", "Cập nhật gần nhất", "Thời hạn của đề xuất", "Thời gian còn lại"]);
    expect(approved.info[5].value).toBe("—");
    expect(approved.status).toBe("Đã chấp thuận");
  });
});

describe("excelNumFmt", () => {
  it("số nguyên không có dấu chấm thừa, tiền tệ có VNĐ", () => {
    expect(excelNumFmt("decimal", 1900)).toBe("#,##0");
    expect(excelNumFmt("decimal", 2.5)).toBe("#,##0.###");
    expect(excelNumFmt("money", 1500000)).toBe('#,##0" VNĐ"');
    expect(excelNumFmt("percent", 12.5)).toBe('#,##0.##"%"');
    // Phần lẻ bị làm tròn mất khi hiển thị → định dạng số nguyên (không "0.")
    expect(excelNumFmt("decimal", 0.0004)).toBe("#,##0");
    expect(excelNumFmt("percent", 3.001)).toBe('#,##0"%"');
  });
});

describe("tạo file thật", () => {
  it("Word: có logo, chân trang theo Tên hiển thị, không có chữ kiểu dữ liệu", async () => {
    const model = buildRequestFormModel(baseInput());
    const buf = await Docx.Packer.toBuffer(buildRequestDocx(Docx, model, logo));
    const zip = await JSZip.loadAsync(buf);
    const files = Object.keys(zip.files);
    expect(files.some((f) => /^word\/media\//.test(f))).toBe(true);
    const body = await zip.file("word/document.xml")!.async("string");
    expect(body).toContain("07/2025/HĐXD-HPCS | CÔNG TRÌNH AID-TEXT");
    expect(body).toContain("ĐIỀU CHỈNH ĐỀ NGHỊ SAU DUYỆT");
    expect(body).not.toContain("Văn bản ngắn");
    const footer = await zip.file(files.find((f) => /^word\/footer\d*\.xml$/.test(f))!)!.async("string");
    expect(footer).toContain("HPCons Request-000000189");
  });

  it("Excel: logo neo 2 góc trong vùng in, số là số, dòng tổng là công thức SUM", async () => {
    const model = buildRequestFormModel(baseInput());
    const wb = await buildRequestXlsx(ExcelJS, model, logo);
    const ws = wb.worksheets[0];
    expect(ws.headerFooter.oddFooter).toContain("HPCons Request-000000189");
    const images = ws.getImages();
    expect(images).toHaveLength(1);
    const range = images[0].range as unknown as { tl: { nativeCol: number }; br: { nativeCol: number } };
    expect(range.tl.nativeCol).toBe(0);
    expect(range.br.nativeCol).toBe(ws.columnCount); // mép phải = mép phải cột cuối vùng in
    const printArea = String(ws.pageSetup.printArea);
    expect(printArea.startsWith("A1:")).toBe(true);
    let qty: number | null = null;
    let formula: string | null = null;
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.value === 1900) qty = cell.value;
        const v = cell.value as { formula?: string } | null;
        if (v && typeof v === "object" && v.formula) formula = v.formula;
      }),
    );
    expect(qty).toBe(1900);
    expect(formula).toMatch(/^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/);
    const buffer = await wb.xlsx.writeBuffer();
    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files).some((f) => /^xl\/media\//.test(f))).toBe(true);
  });

  it("Tên hiển thị trống: chân trang chỉ còn số trang", async () => {
    const model = buildRequestFormModel({ ...baseInput(), brand: "" });
    const wb = await buildRequestXlsx(ExcelJS, model, null);
    expect(wb.worksheets[0].headerFooter.oddFooter).toBe('&C&8&"Arial,Regular"Trang &P / &N');
    const zip = await JSZip.loadAsync(await Docx.Packer.toBuffer(buildRequestDocx(Docx, model, null)));
    const footerFile = Object.keys(zip.files).find((f) => /^word\/footer\d*\.xml$/.test(f))!;
    const footer = await zip.file(footerFile)!.async("string");
    expect(footer).not.toContain("Request");
    expect(footer).toContain("Trang ");
  });
});

describe("sửa theo QA 05/10/2026", () => {
  it("chân trang Excel: tên bắt đầu bằng chữ số không dính vào mã cỡ chữ", async () => {
    const model = buildRequestFormModel({ ...baseInput(), brand: "2026 HP & Co Request" });
    const wb = await buildRequestXlsx(ExcelJS, model, null);
    expect(wb.worksheets[0].headerFooter.oddFooter).toBe('&C&8&"Arial,Regular"2026 HP && Co Request-000000189  ·  Trang &P / &N');
  });

  it("ký tự điều khiển bị loại khỏi nội dung → file Word vẫn đúng cấu trúc XML", async () => {
    const req = sampleRequest();
    req.values.f1 = "Tên\u000Bcó\u0001ký tự lạ\tvà tab";
    const model = buildRequestFormModel({ ...baseInput(), request: req });
    // U+000B (ngắt dòng mềm của Word) thành xuống dòng, U+0001 bị bỏ, tab giữ nguyên.
    expect(model.fields[0].value).toBe("Tên\ncóký tự lạ\tvà tab");
    const zip = await JSZip.loadAsync(await Docx.Packer.toBuffer(buildRequestDocx(Docx, model, null)));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)).toBe(false);
    expect(new DOMParser().parseFromString(xml, "application/xml").getElementsByTagName("parsererror")).toHaveLength(0);
  });

  it("Word không dùng keepNext (tránh dồn cả khung sang trang sau)", async () => {
    const zip = await JSZip.loadAsync(await Docx.Packer.toBuffer(buildRequestDocx(Docx, buildRequestFormModel(baseInput()), null)));
    expect(await zip.file("word/document.xml")!.async("string")).not.toContain("<w:keepNext");
  });

  it("trường số đứng riêng → số thật trong Excel", async () => {
    const req = sampleRequest();
    req.fieldsSnapshot.push(field("f10", "Giá trị", "currency", 10));
    req.values.f10 = "1500000";
    const model = buildRequestFormModel({ ...baseInput(), request: req });
    expect(model.fields.at(-1)).toMatchObject({ value: "1,500,000 VNĐ", num: 1500000, numFmt: '#,##0" VNĐ"' });
    const wb = await buildRequestXlsx(ExcelJS, model, null);
    let found = false;
    wb.worksheets[0].eachRow((row) => row.eachCell((c) => { if (c.value === 1500000) found = true; }));
    expect(found).toBe(true);
  });

  it("tiêu đề dài: chiều cao hàng đủ cho nhiều dòng chữ cỡ 15", async () => {
    // Tiêu đề lấy theo tên nhóm khi không có trường mã tiêu đề (resolveRequestTitle).
    const req = sampleRequest({ groupNameSnapshot: "Đề nghị cấp vật tư ".repeat(10).trim() });
    const model = buildRequestFormModel({ ...baseInput(), request: req });
    const wb = await buildRequestXlsx(ExcelJS, model, null);
    const ws = wb.worksheets[0];
    let titleRow = 0;
    ws.eachRow((row, n) => { if (!titleRow && String(row.getCell(1).value).startsWith(model.title.slice(0, 10))) titleRow = n; });
    expect(titleRow).toBeGreaterThan(0);
    expect(ws.getRow(titleRow).height).toBeGreaterThanOrEqual(15 * 1.3 * 2);
  });
});
