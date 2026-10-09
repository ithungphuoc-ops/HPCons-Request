import { describe, expect, it } from "vitest";
import { contractSecondLine, externalCodeRowMatches, filterExternalCodeRows } from "./external-code-search";

const contract = (code: string, cdt: string, work: string, project: string) => ({
  code,
  displayText: cdt,
  rawFields: { code, customerNameShort: cdt, work, project, khoaMa: "false" },
});

const CONTRACTS = [
  contract("01/2026/HĐXD-HPCS", "HOWELL TECHNOLOGY", "Thi công nhà xưởng chính", "Nhà máy Howell (KCN Châu Đức)"),
  contract("01-02/2026/PLHĐXD-HPCS", "HOWELL TECHNOLOGY", "Phụ lục 02 — hệ thống PCCC", "Nhà máy Howell (KCN Châu Đức)"),
  contract("01-04/2026/PLHĐXD-HPCS", "HOWELL TECHNOLOGY", "Phụ lục 04 — nhà văn phòng 3 tầng", "Nhà máy Howell (KCN Châu Đức)"),
  contract("02/2026/HĐXD-HPCS", "CHENKAI", "", "Nhà máy Chenkai"),
];

describe("Số Hợp Đồng CĐT — tìm theo hạng mục/công trình", () => {
  it("khớp theo hạng mục, không dấu", () => {
    const r = filterExternalCodeRows("congno_contracts", CONTRACTS, "phu luc 04");
    expect(r.map((x) => x.code)).toEqual(["01-04/2026/PLHĐXD-HPCS"]);
  });
  it("khớp theo hạng mục, không phân biệt hoa thường", () => {
    expect(filterExternalCodeRows("congno_contracts", CONTRACTS, "pccc").map((x) => x.code)).toEqual([
      "01-02/2026/PLHĐXD-HPCS",
    ]);
  });
  it("khớp theo công trình", () => {
    expect(filterExternalCodeRows("congno_contracts", CONTRACTS, "chau duc")).toHaveLength(3);
    expect(filterExternalCodeRows("congno_contracts", CONTRACTS, "Nhà máy Chenkai").map((x) => x.code)).toEqual([
      "02/2026/HĐXD-HPCS",
    ]);
  });
  it("vẫn khớp theo mã + CĐT như cũ, mã bắt đầu bằng chuỗi gõ lên trước", () => {
    expect(filterExternalCodeRows("congno_contracts", CONTRACTS, "02/2026").map((x) => x.code)).toEqual([
      "02/2026/HĐXD-HPCS",
      "01-02/2026/PLHĐXD-HPCS",
    ]);
    expect(filterExternalCodeRows("congno_contracts", CONTRACTS, "hdxd")).toHaveLength(4);
    expect(filterExternalCodeRows("congno_contracts", CONTRACTS, "chenkai")).toHaveLength(1);
  });
  it("hạng mục rỗng không làm lỗi; ô trống → mọi dòng", () => {
    expect(filterExternalCodeRows("congno_contracts", CONTRACTS, "")).toHaveLength(4);
    expect(filterExternalCodeRows("congno_contracts", CONTRACTS, "   ")).toHaveLength(4);
  });
  it("giới hạn 30 dòng", () => {
    const many = Array.from({ length: 40 }, (_, i) => contract(`HD-${String(i).padStart(2, "0")}`, "X", "", ""));
    expect(filterExternalCodeRows("congno_contracts", many, "hd")).toHaveLength(30);
  });
});

describe("Nguồn khác giữ nguyên cách lọc cũ", () => {
  const ntp = { code: "Công ty Xây dựng Ánh Dương", displayText: "0312345678 · Q1", rawFields: { ten: "x", work: "pccc" } };
  it("không tìm theo field work/project dù có", () => {
    expect(externalCodeRowMatches("congno_subcontractors", ntp, "pccc")).toBe(false);
  });
  it("vẫn phân biệt dấu như cũ", () => {
    expect(externalCodeRowMatches("congno_subcontractors", ntp, "ánh dương")).toBe(true);
    expect(externalCodeRowMatches("congno_subcontractors", ntp, "anh duong")).toBe(false);
  });
  it("khớp theo cột phụ", () => {
    expect(filterExternalCodeRows("congno_subcontractors", [ntp], "031234")).toHaveLength(1);
  });
});

describe("contractSecondLine — dòng 2 Hạng mục · Công trình", () => {
  const f = { code: "01/2026", work: "Phụ lục 02", project: "Nhà máy A", customerNameShort: "A" };
  it("khớp theo mã: hiện cả hạng mục và công trình", () => {
    expect(contractSecondLine(f, "code")).toEqual({ work: "Phụ lục 02", missingWork: false, project: "Nhà máy A" });
  });
  it("chưa có hạng mục → missingWork", () => {
    expect(contractSecondLine({ ...f, work: "" }, "code")).toEqual({ work: null, missingWork: true, project: "Nhà máy A" });
  });
  it("matchField = work → không lặp hạng mục (kể cả 'Chưa có hạng mục')", () => {
    expect(contractSecondLine(f, "work")).toEqual({ work: null, missingWork: false, project: "Nhà máy A" });
  });
  it("matchField = project → không lặp công trình", () => {
    expect(contractSecondLine(f, "project")).toEqual({ work: "Phụ lục 02", missingWork: false, project: null });
  });
  it("không còn gì để hiện → null", () => {
    expect(contractSecondLine({ ...f, project: "" }, "work")).toBeNull();
  });
});
