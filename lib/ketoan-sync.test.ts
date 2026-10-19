import { describe, expect, it } from "vitest";
import { dungBanChupKeToan, tenFileDinhKem, timFieldKeToan } from "@/lib/ketoan-sync";
import type { ProposalField, RequestInstance } from "@/lib/types";

const f = (id: string, name: string, code?: string, dataType = "text") => ({ id, name, code, dataType }) as unknown as ProposalField;

/** Mẫu "Thanh toán NTP": tên trường như ảnh chụp, mã chỉ có 5 cái đã xác nhận trong script sửa mẫu. */
const FIELDS: ProposalField[] = [
  f("f1", "01. Tên đề xuất", "ten_de_xuat"),
  f("f2", "02. Số hợp đồng CĐT", "so_hop_dong_cdt"),
  f("f3", "03. Tên công trình", "ten_cong_trinh"),
  f("f4", "04. Tên Nhà thầu phụ", "ten_ncc"),
  f("f5", "05. Số hợp đồng NTP", "so_hop_dong_ncc"),
  f("f6", "06. Đợt thanh toán"),
  f("f7", "07. Số tiền", "so_tien", "currency"),
  f("f8", "08. Bộ phận", undefined, "department_select"),
  f("f9", "09. Ngày đề nghị thanh toán", undefined, "date"),
  f("f10", "10. Ghi chú"),
  f("f11", "Trả phiếu"),
  f("f12", "Biên bản nghiệm thu", undefined, "file"),
];

const REQ = {
  id: "rid",
  code: "000000252",
  groupId: "8z2Vw1LcDVSlTrGiMJZY",
  groupNameSnapshot: "5.0. Thanh toán NTP (HPCons)",
  fieldsSnapshot: FIELDS,
  submittedBy: { uid: "u1", name: "Nguyễn Tuấn Huy", email: "h@x.vn" },
  submittedAt: "2026-10-17T03:00:00.000Z",
  values: {
    f1: "36/2025/HĐXD-HPCS | POSAZ | NAM THIÊN LONG | 701-01/HĐ-NTL/2025 | 11 | 20,520,000 VNĐ",
    f2: "36/2025/HĐXD-HPCS",
    f3: "POSAZ",
    f4: "NAM THIÊN LONG",
    f5: "701-01/HĐ-NTL/2025",
    f6: "11",
    f7: "20,520,000 VNĐ",
    f8: "Bộ phận Thi công (HP Cons)",
    f9: "17/10/2026",
    f10: "",
    f12: [{ name: "BBNT-POSAZ.pdf", path: "a/b.pdf" }, { name: "HoaDon.pdf", path: "a/c.pdf" }],
  },
} as unknown as RequestInstance;

const OPTS = {
  trangThaiDeXuat: "da_duyet_ky_thuat" as const,
  nguoiDuyet: "Hồ Văn Thi",
  baseUrl: "https://request.hpcore.vn/",
  bayGioIso: "2026-10-19T03:00:00.000Z",
};

describe("dungBanChupKeToan", () => {
  it("đọc đủ 10 trường mẫu thanh toán NTP, tìm theo mã hoặc tên", () => {
    const p = dungBanChupKeToan(REQ, OPTS)!;
    expect(p.phienBan).toBe(1);
    expect(p.maDeXuat).toBe("000000252");
    expect(p.soHdCdt).toBe("36/2025/HĐXD-HPCS");
    expect(p.congTrinh).toBe("POSAZ");
    expect(p.nhaThauPhu).toBe("NAM THIÊN LONG");
    expect(p.soHdNtp).toBe("701-01/HĐ-NTL/2025");
    expect(p.dot).toBe("11");
    expect(p.soTien).toBe("20,520,000 VNĐ");
    expect(p.boPhan).toBe("Bộ phận Thi công (HP Cons)");
    expect(p.ngayDeNghi).toBe("17/10/2026");
    expect(p.nguoiTao).toBe("Nguyễn Tuấn Huy");
    expect(p.nguoiDuyet.ten).toBe("Hồ Văn Thi");
  });

  it("link đề xuất theo dạng /request/<mã>, nhóm gửi cả tên lẫn id", () => {
    const p = dungBanChupKeToan(REQ, OPTS)!;
    expect(p.linkDeXuat).toBe("https://request.hpcore.vn/request/000000252");
    expect(p.nhomId).toBe("8z2Vw1LcDVSlTrGiMJZY");
    expect(p.nhomDeXuat).toBe("5.0. Thanh toán NTP (HPCons)");
  });

  it("gửi tên các file đính kèm (BBNT…)", () => {
    expect(dungBanChupKeToan(REQ, OPTS)!.fileBBNT).toEqual(["BBNT-POSAZ.pdf", "HoaDon.pdf"]);
    expect(tenFileDinhKem({ fieldsSnapshot: [], values: {} })).toEqual([]);
  });

  it("thiếu ô ngày đề nghị thì lấy ngày gửi đề xuất", () => {
    const req = { ...REQ, values: { ...REQ.values, f9: "" } } as unknown as RequestInstance;
    expect(dungBanChupKeToan(req, OPTS)!.ngayDeNghi).toBe("2026-10-17");
  });

  it("bị trả lại: mang trạng thái và lý do", () => {
    const p = dungBanChupKeToan(REQ, { ...OPTS, trangThaiDeXuat: "bi_tra_lai", lyDoTraLai: "thiếu hoá đơn" })!;
    expect(p.trangThaiDeXuat).toBe("bi_tra_lai");
    expect(p.lyDoTraLai).toBe("thiếu hoá đơn");
  });

  it("đề xuất chưa có mã thì không dựng được", () => {
    expect(dungBanChupKeToan({ ...REQ, code: undefined } as unknown as RequestInstance, OPTS)).toBeNull();
  });
});

describe("timFieldKeToan", () => {
  it("ưu tiên mã, rồi tên khớp đúng, rồi tên chứa cụm", () => {
    expect(timFieldKeToan(FIELDS, ["so_tien"], ["Gì đó"])?.id).toBe("f7");
    expect(timFieldKeToan(FIELDS, [], ["Đợt thanh toán"])?.id).toBe("f6");
    expect(timFieldKeToan(FIELDS, [], ["nghiệm thu"])?.id).toBe("f12");
    expect(timFieldKeToan(FIELDS, [], ["Không có"])).toBeUndefined();
  });
});
