import { beforeEach, describe, expect, it, vi } from "vitest";

// "server-only" chỉ chặn import nhầm ở bundle client qua webpack — dưới
// vitest (chạy thẳng Node) nó throw ngay, cùng lý do đã mock ở
// lib/server/requests.test.ts.
vi.mock("server-only", () => ({}));

// unstable_cache phụ thuộc runtime Next.js thật (request context) — không
// chạy được dưới vitest thuần Node, mock pass-through (bỏ qua cache trong
// test, không ảnh hưởng hành vi thật lúc build/deploy). revalidateTag cũng
// phụ thuộc runtime thật — mock thành spy để test xác nhận ĐƯỢC GỌI sau khi
// ghi, không cần chạy cache thật.
const revalidateTagMock = vi.fn();
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: revalidateTagMock,
}));

process.env.CONGNO_FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: "test" });

/** Dữ liệu THÔ giả lập — cố ý kèm field KHÔNG được phép lộ ra (financial/nội
 * bộ) để test xác nhận 2 hàm loader không forward chúng. */
const FAKE_DOCS: Record<string, Record<string, unknown>[]> = {
  contracts: [
    {
      code: "01/2026/HĐXD-HPCS",
      group: "KCN Tam Hiệp",
      work: "Thi công phần thô",
      customerName: "CÔNG TY TNHH CÔNG NGHIỆP CHÍNH XÁC CHENKAI",
      totalAfterTax: 999_999_999, // KHÔNG được lộ ra
    },
    // ★ (06/10/2026, "khóa công trình lan truyền") 1 mã đã bị Công nợ khóa — test forward đúng khoaMa.
    {
      code: "02/2026/HĐXD-VT",
      group: "KCN Điện Nam",
      work: "Thi công điện",
      customerName: "CÔNG TY TNHH VIETTEL",
      khoaMa: true,
    },
  ],
  subcontractors: [
    {
      ma: "4001094696",
      mst: "4001094696",
      ten: "CÔNG TY CỔ PHẦN COMIN AN AN HÒA",
      tenVietTat: "AN AN HÒA",
      diaChi: "Đà Nẵng",
      nguon: "goc",
    },
    // Nhà thầu tự thêm lúc Ký kết — chỉ có mst, không có ma (đúng thực tế đã xác nhận).
    { ma: "", mst: "0317927805", ten: "CÔNG TY CỔ PHẦN CƠ KHÍ XÂY DỰNG MINH PHÚC", diaChi: "TP HCM" },
    // Không có ma/mst, nhưng có tên — vẫn phải giữ (Sếp yêu cầu 30/09/2026: khớp
    // được cả theo tên, "ten" luôn bắt buộc bên Công nợ nên không nên loại).
    { ten: "Nhà thầu chưa có mã/MST", diaChi: "" },
    // Không có CẢ 3 field (ma/mst/ten rỗng) — trường hợp lý thuyết, phải lọc bỏ.
    { ma: "", mst: "", ten: "", diaChi: "" },
  ],
};

// Ghi lại mọi document được `.add()` trong test — dùng để assert
// `createSubcontractorInCongNo` gửi đúng field, không đụng `nguon` cũ.
const ADDED_DOCS: Record<string, unknown>[] = [];

vi.mock("firebase-admin/app", () => ({
  cert: (x: unknown) => x,
  getApps: () => [],
  initializeApp: () => ({}),
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    collection: (name: string) => ({
      get: async () => ({
        docs: (FAKE_DOCS[name] ?? []).map((data, i) => ({ id: `${name}-${i}`, data: () => data })),
      }),
      add: async (data: Record<string, unknown>) => {
        ADDED_DOCS.push(data);
        return { id: `${name}-new-${ADDED_DOCS.length}` };
      },
    }),
  }),
}));

const { loadContractCodeSuggestions, loadSubcontractorCodeSuggestions, createSubcontractorInCongNo, docLaiHopDongCongNo } =
  await import("./congno");

// ★ (03/10/2026, QA đợt 2) Lưới tự lành khi nhớ tạm 12 giờ — đọc thẳng có giới hạn 1 lần/60 giây.
describe("docLaiHopDongCongNo", () => {
  it("lần đầu: đọc thẳng + xoá nhớ tạm hợp đồng; gọi lại ngay trong 60 giây: không xoá nhớ tạm thêm", async () => {
    revalidateTagMock.mockClear();
    const lan1 = await docLaiHopDongCongNo();
    expect(lan1.map((c) => c.code).sort()).toEqual(["01/2026/HĐXD-HPCS", "02/2026/HĐXD-VT"]);
    expect(revalidateTagMock).toHaveBeenCalledWith("contract-code-suggestions");
    revalidateTagMock.mockClear();
    const lan2 = await docLaiHopDongCongNo();
    expect(lan2.map((c) => c.code).sort()).toEqual(["01/2026/HĐXD-HPCS", "02/2026/HĐXD-VT"]);
    expect(revalidateTagMock).not.toHaveBeenCalled();
  });
});

describe("loadContractCodeSuggestions", () => {
  it("chỉ forward đúng code/project/work/customerName(Short)/khoaMa — không có totalAfterTax", async () => {
    const result = await loadContractCodeSuggestions();
    expect(result).toHaveLength(2);
    const r = result[0] as unknown as Record<string, unknown>;
    expect(r.code).toBe("01/2026/HĐXD-HPCS");
    expect(r.project).toBe("KCN Tam Hiệp");
    expect(r.work).toBe("Thi công phần thô");
    expect(r.customerName).toContain("CHENKAI");
    expect(r.khoaMa).toBe(false);
    expect("totalAfterTax" in r).toBe(false);
    expect(Object.keys(r).sort()).toEqual(["code", "customerName", "customerNameShort", "khoaMa", "project", "work"].sort());
  });

  // ★ (06/10/2026, "khóa công trình lan truyền")
  it("khoaMa = true khi Công nợ đã khóa mã hợp đồng này", async () => {
    const result = await loadContractCodeSuggestions();
    const locked = result.find((c) => c.code === "02/2026/HĐXD-VT");
    expect(locked?.khoaMa).toBe(true);
  });
});

describe("loadSubcontractorCodeSuggestions", () => {
  it("chỉ forward đúng ma/mst/ten/tenVietTat/diaChi — không có nguon/hopDong", async () => {
    const result = await loadSubcontractorCodeSuggestions();
    // Bản ghi rỗng cả ma/mst/ten phải bị lọc bỏ — còn lại 3.
    expect(result).toHaveLength(3);
    const r = result[0] as unknown as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(["diaChi", "ma", "mst", "ten", "tenVietTat"].sort());
    expect("nguon" in r).toBe(false);
    expect("hopDong" in r).toBe(false);
  });

  it("giữ lại bản ghi chỉ có mst, không có ma (nhà thầu tự thêm lúc Ký kết)", async () => {
    const result = await loadSubcontractorCodeSuggestions();
    const noMa = result.find((s) => s.mst === "0317927805");
    expect(noMa).toBeDefined();
    expect(noMa?.ma).toBe("");
  });

  it("giữ lại bản ghi không có ma/mst nhưng có tên (khớp được theo tên)", async () => {
    const result = await loadSubcontractorCodeSuggestions();
    const onlyTen = result.find((s) => s.ten === "Nhà thầu chưa có mã/MST");
    expect(onlyTen).toBeDefined();
    expect(onlyTen?.ma).toBe("");
    expect(onlyTen?.mst).toBe("");
  });

  // Sếp phát hiện 01/10/2026: nhà thầu phụ CŨ chưa ai nhập tay "Tên viết tắt"
  // hiện RỖNG bên app Đề xuất trong khi Công nợ tự hiển thị đủ (họ tự bù
  // ntpVietTat lúc hiển thị) — phải bù Y HỆT ở đây lúc ĐỌC, không chỉ lúc GHI.
  it("tenVietTat rỗng trong Firestore (nhà thầu CŨ) -> tự tính bằng ntpVietTat lúc đọc", async () => {
    const result = await loadSubcontractorCodeSuggestions();
    const noVietTat = result.find((s) => s.mst === "0317927805");
    expect(noVietTat?.tenVietTat).toBe("MINH PHÚC");
  });

  it("tenVietTat đã có sẵn trong Firestore (nhà thầu đã nhập tay) -> giữ nguyên, không tính lại", async () => {
    const result = await loadSubcontractorCodeSuggestions();
    const hasVietTat = result.find((s) => s.mst === "4001094696");
    expect(hasVietTat?.tenVietTat).toBe("AN AN HÒA");
  });
});

describe("createSubcontractorInCongNo", () => {
  beforeEach(() => {
    ADDED_DOCS.length = 0;
    revalidateTagMock.mockClear();
  });

  it("ghi đúng field, giữ nguyên nguon='goc' (không đụng ý nghĩa cũ), có ghiChuNguon", async () => {
    const { id } = await createSubcontractorInCongNo({
      ten: "Công Ty TNHH Thử Nghiệm",
      mst: "0123456789",
      nhom: "THẦU PHỤ",
      diaChi: "Đà Nẵng",
      nguoiThem: "Nguyễn Tấn Hậu",
    });
    expect(id).toBeTruthy();
    expect(ADDED_DOCS).toHaveLength(1);
    const doc = ADDED_DOCS[0];
    expect(doc.ten).toBe("Công Ty TNHH Thử Nghiệm");
    expect(doc.mst).toBe("0123456789");
    expect(doc.nhom).toBe("THẦU PHỤ");
    expect(doc.diaChi).toBe("Đà Nẵng");
    expect(doc.nguon).toBe("goc");
    expect(doc.ghiChuNguon).toContain("Nguyễn Tấn Hậu");
  });

  it("để trống tenVietTat thì tự tính bằng ntpVietTat", async () => {
    await createSubcontractorInCongNo({
      ten: "CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN MÔI TRƯỜNG ĐẠI VIỆT",
      mst: "0310256675",
      nhom: "THẦU PHỤ",
      nguoiThem: "Test User",
    });
    expect(ADDED_DOCS[0].tenVietTat).toBe("ĐẠI VIỆT");
  });

  it("giữ nguyên tenVietTat nếu người dùng tự gõ, không tự tính đè lên", async () => {
    await createSubcontractorInCongNo({
      ten: "CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN MÔI TRƯỜNG ĐẠI VIỆT",
      tenVietTat: "ĐV TỰ GÕ",
      mst: "0310256675",
      nhom: "THẦU PHỤ",
      nguoiThem: "Test User",
    });
    expect(ADDED_DOCS[0].tenVietTat).toBe("ĐV TỰ GÕ");
  });

  it("thiếu tên nhà cung cấp thì từ chối ghi", async () => {
    await expect(
      createSubcontractorInCongNo({ ten: "  ", mst: "0123456789", nhom: "THẦU PHỤ", nguoiThem: "Test" }),
    ).rejects.toThrow();
    expect(ADDED_DOCS).toHaveLength(0);
  });

  it("thiếu MST/CCCD thì từ chối ghi", async () => {
    await expect(
      createSubcontractorInCongNo({ ten: "Công ty X", mst: "  ", nhom: "THẦU PHỤ", nguoiThem: "Test" }),
    ).rejects.toThrow();
    expect(ADDED_DOCS).toHaveLength(0);
  });

  it("làm mới cache ngay sau khi ghi thành công (không đợi hết 5 phút)", async () => {
    await createSubcontractorInCongNo({
      ten: "Công Ty TNHH Thử Nghiệm",
      mst: "0123456789",
      nhom: "THẦU PHỤ",
      nguoiThem: "Test User",
    });
    expect(revalidateTagMock).toHaveBeenCalledWith("subcontractor-code-suggestions");
  });
});
