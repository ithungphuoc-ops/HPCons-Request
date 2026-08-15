import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateConditionGroup, filterApplicableSteps, mergeFollowers, validateConditionGroupFieldCodes } from "./conditions";
import type { ApproverStepDef, ConditionGroup, ProposalField, TaggedUser } from "@/lib/types";

const tinhTrang: ProposalField = {
  id: "f1",
  name: "Tình trạng",
  code: "tinh_trang",
  dataType: "single_choice",
  required: true,
  order: 1,
  options: ["Khẩn cấp", "Bình thường"],
};

const thietBi: ProposalField = {
  id: "f2",
  name: "Thiết bị văn phòng",
  code: "thiet_bi_van_phong",
  dataType: "multiple_choice",
  required: false,
  order: 2,
  options: ["Máy in", "Bàn ghế"],
};

const soTien: ProposalField = {
  id: "f3",
  name: "Số tiền đề nghị",
  code: "so_tien",
  dataType: "currency",
  required: false,
  order: 3,
};

const ngayApDung: ProposalField = {
  id: "f4",
  name: "Ngày áp dụng",
  code: "ngay_ap_dung",
  dataType: "date",
  required: false,
  order: 4,
};

const fields = [tinhTrang, thietBi, soTien, ngayApDung];

/** Bọc 1 rule đơn thành ConditionGroup 1 phần tử — tiện viết test ngắn gọn cho case cũ. */
function single(rule: ConditionGroup["rules"][number]): ConditionGroup {
  return { conjunction: "all", rules: [rule] };
}

describe("evaluateConditionGroup — rule đơn (tương thích hành vi cũ)", () => {
  it("equals đúng khi giá trị field khớp", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" }),
      { f1: "Khẩn cấp" },
      fields,
    );
    expect(result).toBe(true);
  });

  it("equals sai khi giá trị field khác", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" }),
      { f1: "Bình thường" },
      fields,
    );
    expect(result).toBe(false);
  });

  it("equals sai khi field chưa có giá trị", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" }),
      {},
      fields,
    );
    expect(result).toBe(false);
  });

  it("not_equals đúng khi giá trị field khác", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "tinh_trang", operator: "not_equals", value: "Khẩn cấp" }),
      { f1: "Bình thường" },
      fields,
    );
    expect(result).toBe(true);
  });

  it("not_equals sai khi giá trị field khớp", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "tinh_trang", operator: "not_equals", value: "Khẩn cấp" }),
      { f1: "Khẩn cấp" },
      fields,
    );
    expect(result).toBe(false);
  });

  it("includes đúng khi giá trị nằm trong mảng multiple_choice", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "thiet_bi_van_phong", operator: "includes", value: "Máy in" }),
      { f2: ["Máy in", "Bàn ghế"] },
      fields,
    );
    expect(result).toBe(true);
  });

  it("includes sai khi giá trị không nằm trong mảng", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "thiet_bi_van_phong", operator: "includes", value: "Máy chiếu" }),
      { f2: ["Máy in"] },
      fields,
    );
    expect(result).toBe(false);
  });

  it("includes sai khi giá trị field không phải mảng", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "thiet_bi_van_phong", operator: "includes", value: "Máy in" }),
      { f2: "Máy in" },
      fields,
    );
    expect(result).toBe(false);
  });

  it("trả false, không throw, khi field không tồn tại trong nhóm", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "khong_ton_tai", operator: "equals", value: "x" }),
      { f1: "Khẩn cấp" },
      fields,
    );
    expect(result).toBe(false);
  });
});

describe("evaluateConditionGroup — not_includes / is_empty / is_not_empty", () => {
  it("not_includes đúng khi giá trị không nằm trong mảng multiple_choice", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "thiet_bi_van_phong", operator: "not_includes", value: "Máy chiếu" }),
      { f2: ["Máy in", "Bàn ghế"] },
      fields,
    );
    expect(result).toBe(true);
  });

  it("not_includes sai khi giá trị nằm trong mảng", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "thiet_bi_van_phong", operator: "not_includes", value: "Máy in" }),
      { f2: ["Máy in"] },
      fields,
    );
    expect(result).toBe(false);
  });

  it("not_includes đúng khi field chưa chọn gì (không phải mảng)", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "thiet_bi_van_phong", operator: "not_includes", value: "Máy in" }),
      {},
      fields,
    );
    expect(result).toBe(true);
  });

  it("is_empty đúng khi field chưa có giá trị", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "tinh_trang", operator: "is_empty", value: "" }),
      {},
      fields,
    );
    expect(result).toBe(true);
  });

  it("is_empty đúng khi field multiple_choice là mảng rỗng", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "thiet_bi_van_phong", operator: "is_empty", value: "" }),
      { f2: [] },
      fields,
    );
    expect(result).toBe(true);
  });

  it("is_empty sai khi field đã có giá trị", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "tinh_trang", operator: "is_empty", value: "" }),
      { f1: "Khẩn cấp" },
      fields,
    );
    expect(result).toBe(false);
  });

  it("is_not_empty đúng khi field đã có giá trị", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "tinh_trang", operator: "is_not_empty", value: "" }),
      { f1: "Khẩn cấp" },
      fields,
    );
    expect(result).toBe(true);
  });

  it("is_not_empty sai khi field chưa có giá trị", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "tinh_trang", operator: "is_not_empty", value: "" }),
      {},
      fields,
    );
    expect(result).toBe(false);
  });
});

describe("evaluateConditionGroup — nhiều rule con (AND/OR)", () => {
  it("conjunction 'all' chỉ thoả khi MỌI rule con thoả", () => {
    const group: ConditionGroup = {
      conjunction: "all",
      rules: [
        { fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" },
        { fieldCode: "thiet_bi_van_phong", operator: "includes", value: "Máy in" },
      ],
    };
    expect(evaluateConditionGroup(group, { f1: "Khẩn cấp", f2: ["Máy in"] }, fields)).toBe(true);
    expect(evaluateConditionGroup(group, { f1: "Khẩn cấp", f2: ["Bàn ghế"] }, fields)).toBe(false);
  });

  it("conjunction 'any' thoả khi ÍT NHẤT MỘT rule con thoả", () => {
    const group: ConditionGroup = {
      conjunction: "any",
      rules: [
        { fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" },
        { fieldCode: "thiet_bi_van_phong", operator: "includes", value: "Máy in" },
      ],
    };
    expect(evaluateConditionGroup(group, { f1: "Bình thường", f2: ["Máy in"] }, fields)).toBe(true);
    expect(evaluateConditionGroup(group, { f1: "Bình thường", f2: ["Bàn ghế"] }, fields)).toBe(false);
  });

  it("nhóm điều kiện rỗng luôn thoả mãn", () => {
    expect(evaluateConditionGroup({ conjunction: "all", rules: [] }, {}, fields)).toBe(true);
    expect(evaluateConditionGroup({ conjunction: "any", rules: [] }, {}, fields)).toBe(true);
  });
});

describe("evaluateConditionGroup — so sánh số/ngày", () => {
  it("greater_than đúng khi giá trị số lớn hơn ngưỡng", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "so_tien", operator: "greater_than", value: "20000000" }),
      { f3: 25000000 },
      fields,
    );
    expect(result).toBe(true);
  });

  it("less_than đúng khi giá trị số nhỏ hơn ngưỡng", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "so_tien", operator: "less_than", value: "20000000" }),
      { f3: 5000000 },
      fields,
    );
    expect(result).toBe(true);
  });

  it("between đúng khi giá trị nằm trong khoảng (đóng 2 đầu)", () => {
    const group = single({ fieldCode: "so_tien", operator: "between", value: "5000000", valueTo: "20000000" });
    expect(evaluateConditionGroup(group, { f3: 5000000 }, fields)).toBe(true); // biên dưới
    expect(evaluateConditionGroup(group, { f3: 20000000 }, fields)).toBe(true); // biên trên
    expect(evaluateConditionGroup(group, { f3: 10000000 }, fields)).toBe(true); // giữa
    expect(evaluateConditionGroup(group, { f3: 4999999 }, fields)).toBe(false); // ngoài khoảng
  });

  it("greater_than hoạt động với field kiểu date (so sánh theo thời điểm)", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "ngay_ap_dung", operator: "greater_than", value: "2026-01-01" }),
      { f4: "2026-06-15" },
      fields,
    );
    expect(result).toBe(true);
  });

  it("trả false, không throw, khi giá trị không ép kiểu số/ngày được", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "so_tien", operator: "greater_than", value: "20000000" }),
      { f3: "không phải số" },
      fields,
    );
    expect(result).toBe(false);
  });

  it("trả false khi field chưa có giá trị", () => {
    const result = evaluateConditionGroup(
      single({ fieldCode: "so_tien", operator: "greater_than", value: "20000000" }),
      {},
      fields,
    );
    expect(result).toBe(false);
  });
});

describe("evaluateConditionGroup — log cảnh báo khi field không tồn tại", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("ghi đúng 1 log cảnh báo khi rule tham chiếu field không tồn tại", () => {
    evaluateConditionGroup(
      single({ fieldCode: "khong_ton_tai", operator: "equals", value: "x" }),
      { f1: "Khẩn cấp" },
      fields,
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("khong_ton_tai");
  });

  it("không log khi mọi field trong rule đều tồn tại", () => {
    evaluateConditionGroup(
      single({ fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" }),
      { f1: "Khẩn cấp" },
      fields,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("validateConditionGroupFieldCodes", () => {
  const knownCodes = new Set(["tinh_trang", "thiet_bi_van_phong", "so_tien", "ngay_ap_dung"]);

  it("trả null khi group là undefined", () => {
    expect(validateConditionGroupFieldCodes(undefined, knownCodes)).toBeNull();
  });

  it("trả null khi mọi rule con đều tham chiếu field hợp lệ", () => {
    const group: ConditionGroup = {
      conjunction: "all",
      rules: [
        { fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" },
        { fieldCode: "so_tien", operator: "greater_than", value: "0" },
      ],
    };
    expect(validateConditionGroupFieldCodes(group, knownCodes)).toBeNull();
  });

  it("trả về fieldCode đầu tiên không hợp lệ", () => {
    const group: ConditionGroup = {
      conjunction: "all",
      rules: [
        { fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" },
        { fieldCode: "khong_ton_tai", operator: "equals", value: "x" },
      ],
    };
    expect(validateConditionGroupFieldCodes(group, knownCodes)).toBe("khong_ton_tai");
  });
});

const truongPhong: TaggedUser = {
  id: "u1",
  name: "Trưởng phòng Kỹ thuật Thi công Khối 2",
  username: "truongphongkythuat",
  avatarInitial: "T",
};

describe("filterApplicableSteps", () => {
  it("giữ nguyên bước duyệt không có điều kiện", () => {
    const steps: ApproverStepDef[] = [{ kind: "submitter_manager", code: "quan_ly_truc_tiep" }];
    expect(filterApplicableSteps(steps, {}, fields)).toEqual(steps);
  });

  it("giữ bước duyệt có điều kiện khi điều kiện thoả mãn", () => {
    const steps: ApproverStepDef[] = [
      {
        kind: "fixed",
        user: truongPhong,
        code: "truong_phong",
        condition: single({ fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" }),
      },
    ];
    expect(filterApplicableSteps(steps, { f1: "Khẩn cấp" }, fields)).toEqual(steps);
  });

  it("loại bỏ bước duyệt có điều kiện khi điều kiện không thoả mãn", () => {
    const steps: ApproverStepDef[] = [
      {
        kind: "fixed",
        user: truongPhong,
        code: "truong_phong",
        condition: single({ fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" }),
      },
    ];
    expect(filterApplicableSteps(steps, { f1: "Bình thường" }, fields)).toEqual([]);
  });

  it("giữ bước không điều kiện, loại bước có điều kiện không thoả, trong cùng danh sách", () => {
    const steps: ApproverStepDef[] = [
      { kind: "submitter_manager", code: "quan_ly_truc_tiep" },
      {
        kind: "fixed",
        user: truongPhong,
        code: "truong_phong",
        condition: single({ fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" }),
      },
    ];
    const result = filterApplicableSteps(steps, { f1: "Bình thường" }, fields);
    expect(result).toEqual([steps[0]]);
  });

  it("bước duyệt có điều kiện OR nhiều rule vẫn được lọc đúng", () => {
    const steps: ApproverStepDef[] = [
      {
        kind: "fixed",
        user: truongPhong,
        code: "truong_phong",
        condition: {
          conjunction: "any",
          rules: [
            { fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" },
            { fieldCode: "so_tien", operator: "greater_than", value: "20000000" },
          ],
        },
      },
    ];
    expect(filterApplicableSteps(steps, { f1: "Bình thường", f3: 25000000 }, fields)).toEqual(steps);
    expect(filterApplicableSteps(steps, { f1: "Bình thường", f3: 1000 }, fields)).toEqual([]);
  });
});

const userA: TaggedUser = { id: "a", name: "A", username: "a", avatarInitial: "A" };
const userB: TaggedUser = { id: "b", name: "B", username: "b", avatarInitial: "B" };
const userC: TaggedUser = { id: "c", name: "C", username: "c", avatarInitial: "C" };

describe("mergeFollowers", () => {
  it("hợp 3 nguồn, loại trùng theo id", () => {
    const result = mergeFollowers([userA], [userA, userB], [], {}, fields);
    expect(result.map((u) => u.id)).toEqual(["a", "b"]);
  });

  it("thêm người theo dõi theo điều kiện khi điều kiện thoả mãn", () => {
    const result = mergeFollowers(
      [userA],
      [userA],
      [{ condition: single({ fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" }), users: [userC] }],
      { f1: "Khẩn cấp" },
      fields,
    );
    expect(result.map((u) => u.id)).toEqual(["a", "c"]);
  });

  it("không thêm người theo dõi theo điều kiện khi điều kiện không thoả mãn", () => {
    const result = mergeFollowers(
      [userA],
      [userA],
      [{ condition: single({ fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" }), users: [userC] }],
      { f1: "Bình thường" },
      fields,
    );
    expect(result.map((u) => u.id)).toEqual(["a"]);
  });

  it("không trùng lặp khi cùng 1 người xuất hiện ở nhiều nguồn", () => {
    const result = mergeFollowers(
      [userA],
      [userA, userB],
      [{ condition: single({ fieldCode: "tinh_trang", operator: "equals", value: "Khẩn cấp" }), users: [userB] }],
      { f1: "Khẩn cấp" },
      fields,
    );
    expect(result.map((u) => u.id)).toEqual(["a", "b"]);
  });
});
