import { describe, expect, it } from "vitest";
import { findReferencedComputedFieldCode, resolveComputedValue, resolveTemplate } from "./computed-fields";
import type { ComputedFieldConfig, ProposalField } from "@/lib/types";

const luaChonDeNghi: ProposalField = {
  id: "f1",
  name: "Lựa chọn đề nghị",
  code: "lua_chon_de_nghi",
  dataType: "single_choice",
  required: true,
  order: 1,
  options: ["Đề nghị công trình", "Đề nghị phòng ban"],
};

const soHopDong: ProposalField = {
  id: "f2",
  name: "Số hợp đồng",
  code: "so_hop_dong",
  dataType: "short_text",
  required: false,
  order: 2,
};

const tenCongTrinh: ProposalField = {
  id: "f3",
  name: "Tên công trình",
  code: "ten_cong_trinh",
  dataType: "short_text",
  required: false,
  order: 3,
};

const boPhan: ProposalField = {
  id: "f4",
  name: "Bộ phận",
  code: "bo_phan",
  dataType: "department_select",
  required: false,
  order: 4,
};

const tenDeXuat: ProposalField = {
  id: "f5",
  name: "Tên đề xuất",
  code: "ten_de_xuat",
  dataType: "short_text",
  required: false,
  order: 5,
  computedFrom: {
    branches: [
      {
        condition: { conjunction: "all", rules: [{ fieldCode: "lua_chon_de_nghi", operator: "equals", value: "Đề nghị công trình" }] },
        template: "${so_hop_dong}-${ten_cong_trinh}",
      },
      {
        condition: { conjunction: "all", rules: [{ fieldCode: "lua_chon_de_nghi", operator: "equals", value: "Đề nghị phòng ban" }] },
        template: "Đề nghị ${bo_phan}",
      },
    ],
  },
};

const fields = [luaChonDeNghi, soHopDong, tenCongTrinh, boPhan, tenDeXuat];

describe("resolveTemplate", () => {
  it("thay thế đúng nhiều ${code} trong 1 chuỗi", () => {
    const values = { f2: "123", f3: "ctr1" };
    expect(resolveTemplate("${so_hop_dong}-${ten_cong_trinh}", values, fields)).toBe("123-ctr1");
  });

  it("giữ nguyên ${code} không khớp field nào", () => {
    const values = { f2: "123" };
    expect(resolveTemplate("${so_hop_dong}-${khong_ton_tai}", values, fields)).toBe("123-${khong_ton_tai}");
  });
});

describe("resolveComputedValue", () => {
  const config: ComputedFieldConfig = tenDeXuat.computedFrom!;

  it("dùng nhánh đầu tiên khớp — ví dụ Đề nghị công trình", () => {
    const values = { f1: "Đề nghị công trình", f2: "123", f3: "ctr1" };
    expect(resolveComputedValue(config, values, fields)).toBe("123-ctr1");
  });

  it("dùng nhánh đầu tiên khớp — ví dụ Đề nghị phòng ban", () => {
    const values = { f1: "Đề nghị phòng ban", f4: "Phòng IT" };
    expect(resolveComputedValue(config, values, fields)).toBe("Đề nghị Phòng IT");
  });

  it("nhánh sau bị bỏ qua dù cũng khớp", () => {
    const configLuonKhop: ComputedFieldConfig = {
      branches: [
        { template: "nhánh 1" },
        { template: "nhánh 2" },
      ],
    };
    expect(resolveComputedValue(configLuonKhop, {}, fields)).toBe("nhánh 1");
  });

  it("không nhánh nào khớp thì trả null", () => {
    const values = { f1: "Giá trị khác" };
    expect(resolveComputedValue(config, values, fields)).toBeNull();
  });

  it("nhánh không có condition luôn khớp — dùng làm fallback cuối danh sách", () => {
    const configCoFallback: ComputedFieldConfig = {
      branches: [
        {
          condition: { conjunction: "all", rules: [{ fieldCode: "lua_chon_de_nghi", operator: "equals", value: "Không tồn tại" }] },
          template: "không bao giờ tới đây",
        },
        { template: "fallback mặc định" },
      ],
    };
    expect(resolveComputedValue(configCoFallback, {}, fields)).toBe("fallback mặc định");
  });
});

describe("findReferencedComputedFieldCode", () => {
  it("phát hiện đúng khi field tham chiếu field khác có computedFrom", () => {
    const fieldA: ProposalField = {
      id: "fa",
      name: "A",
      code: "field_a",
      dataType: "short_text",
      required: false,
      order: 10,
      computedFrom: { branches: [{ template: "${ten_de_xuat}" }] },
    };
    expect(findReferencedComputedFieldCode(fieldA, [...fields, fieldA])).toBe("ten_de_xuat");
  });

  it("không báo sai khi field chỉ tham chiếu field thường", () => {
    const fieldB: ProposalField = {
      id: "fb",
      name: "B",
      code: "field_b",
      dataType: "short_text",
      required: false,
      order: 11,
      computedFrom: { branches: [{ template: "${so_hop_dong}-${ten_cong_trinh}" }] },
    };
    expect(findReferencedComputedFieldCode(fieldB, [...fields, fieldB])).toBeNull();
  });

  it("trả null khi field không có computedFrom", () => {
    expect(findReferencedComputedFieldCode(soHopDong, fields)).toBeNull();
  });
});
