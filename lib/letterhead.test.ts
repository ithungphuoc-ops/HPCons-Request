import { describe, expect, it } from "vitest";
import { allLetterheadUrls, findLetterheadUrl, letterheadImageUrl, letterheadVersion } from "./letterhead";
import type { CategoryGroup, ProposalGroup } from "./types";

const group = (id: string) => ({ id }) as ProposalGroup;

const categories: CategoryGroup[] = [
  {
    id: "catHp",
    code: "02",
    name: "HPCons",
    groups: [group("g1"), group("g2")],
    letterheadImagePath: "requests/u1/1727700000000-Cty HPCons.jpg",
    letterheadImageName: "Cty HPCons.jpg",
  },
  {
    id: "catEqui",
    code: "03",
    name: "EQUI",
    groups: [group("g3")],
    letterheadImagePath: "requests/u1/1727700000001-Cty Equi VN.jpg",
    letterheadImageName: "Cty Equi VN.jpg",
  },
  { id: "catNone", code: "01", name: "Chưa phân loại", groups: [group("g4")] },
];

describe("letterheadVersion", () => {
  it("ổn định với cùng 1 path (trình duyệt dùng lại ảnh đã nhớ)", () => {
    expect(letterheadVersion("requests/u1/a.jpg")).toBe(letterheadVersion("requests/u1/a.jpg"));
  });

  it("đổi khi path đổi (đổi logo thì trình duyệt tải ảnh mới)", () => {
    expect(letterheadVersion("requests/u1/1-a.jpg")).not.toBe(letterheadVersion("requests/u1/2-a.jpg"));
  });

  it("chỉ gồm ký tự an toàn cho URL", () => {
    expect(letterheadVersion("requests/u1/1727700000000-Cty HPCons.jpg")).toMatch(/^[0-9a-z]+$/);
  });
});

describe("letterheadImageUrl", () => {
  it("cố định theo công ty, kèm v theo path", () => {
    expect(letterheadImageUrl("catHp", "requests/u1/a.jpg")).toBe(
      `/api/categories/catHp/letterhead/image?v=${letterheadVersion("requests/u1/a.jpg")}`,
    );
  });
});

describe("findLetterheadUrl", () => {
  it("nhóm thuộc công ty nào thì ra logo công ty đó", () => {
    expect(findLetterheadUrl(categories, "g2")).toBe(
      letterheadImageUrl("catHp", "requests/u1/1727700000000-Cty HPCons.jpg"),
    );
    expect(findLetterheadUrl(categories, "g3")).toBe(
      letterheadImageUrl("catEqui", "requests/u1/1727700000001-Cty Equi VN.jpg"),
    );
  });

  it("mọi đề xuất cùng công ty dùng chung đúng 1 URL", () => {
    expect(findLetterheadUrl(categories, "g1")).toBe(findLetterheadUrl(categories, "g2"));
  });

  it("null khi công ty chưa cài ảnh, nhóm không tồn tại, thiếu groupId hoặc chưa tải danh sách", () => {
    expect(findLetterheadUrl(categories, "g4")).toBeNull();
    expect(findLetterheadUrl(categories, "khong-co")).toBeNull();
    expect(findLetterheadUrl(categories, null)).toBeNull();
    expect(findLetterheadUrl(categories, undefined)).toBeNull();
    expect(findLetterheadUrl([], "g1")).toBeNull();
  });
});

describe("allLetterheadUrls", () => {
  it("chỉ lấy công ty đã cài ảnh", () => {
    expect(allLetterheadUrls(categories)).toEqual([
      letterheadImageUrl("catHp", "requests/u1/1727700000000-Cty HPCons.jpg"),
      letterheadImageUrl("catEqui", "requests/u1/1727700000001-Cty Equi VN.jpg"),
    ]);
  });
});
