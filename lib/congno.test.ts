import { describe, expect, it, vi } from "vitest";

// "server-only" chỉ chặn import nhầm ở bundle client qua webpack — dưới
// vitest (chạy thẳng Node) nó throw ngay, cùng lý do đã mock ở
// lib/server/requests.test.ts.
vi.mock("server-only", () => ({}));

// unstable_cache phụ thuộc runtime Next.js thật (request context) — không
// chạy được dưới vitest thuần Node, mock pass-through (bỏ qua cache trong
// test, không ảnh hưởng hành vi thật lúc build/deploy).
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
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
  ],
  subcontractors: [
    { ma: "4001094696", mst: "4001094696", ten: "CÔNG TY CỔ PHẦN COMIN AN AN HÒA", diaChi: "Đà Nẵng", nguon: "goc" },
    // Nhà thầu tự thêm lúc Ký kết — chỉ có mst, không có ma (đúng thực tế đã xác nhận).
    { ma: "", mst: "0317927805", ten: "CÔNG TY CỔ PHẦN CƠ KHÍ XÂY DỰNG MINH PHÚC", diaChi: "TP HCM" },
    // Không có cả 2 field mã — phải bị lọc bỏ hoàn toàn.
    { ten: "Nhà thầu chưa xác định mã", diaChi: "" },
  ],
};

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
    }),
  }),
}));

const { loadContractCodeSuggestions, loadSubcontractorCodeSuggestions } = await import("./congno");

describe("loadContractCodeSuggestions", () => {
  it("chỉ forward đúng code/project/work/customerName(Short) — không có totalAfterTax", async () => {
    const result = await loadContractCodeSuggestions();
    expect(result).toHaveLength(1);
    const r = result[0] as unknown as Record<string, unknown>;
    expect(r.code).toBe("01/2026/HĐXD-HPCS");
    expect(r.project).toBe("KCN Tam Hiệp");
    expect(r.work).toBe("Thi công phần thô");
    expect(r.customerName).toContain("CHENKAI");
    expect("totalAfterTax" in r).toBe(false);
    expect(Object.keys(r).sort()).toEqual(["code", "customerName", "customerNameShort", "project", "work"].sort());
  });
});

describe("loadSubcontractorCodeSuggestions", () => {
  it("chỉ forward đúng ma/mst/ten/diaChi — không có nguon/hopDong", async () => {
    const result = await loadSubcontractorCodeSuggestions();
    // Bản ghi thiếu cả ma lẫn mst phải bị lọc bỏ.
    expect(result).toHaveLength(2);
    const r = result[0] as unknown as Record<string, unknown>;
    expect(Object.keys(r).sort()).toEqual(["diaChi", "ma", "mst", "ten"].sort());
    expect("nguon" in r).toBe(false);
    expect("hopDong" in r).toBe(false);
  });

  it("giữ lại bản ghi chỉ có mst, không có ma (nhà thầu tự thêm lúc Ký kết)", async () => {
    const result = await loadSubcontractorCodeSuggestions();
    const noMa = result.find((s) => s.mst === "0317927805");
    expect(noMa).toBeDefined();
    expect(noMa?.ma).toBe("");
  });
});
