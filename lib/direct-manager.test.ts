import { describe, expect, it } from "vitest";
import {
  prioritizeDirectManagers,
  resolveDirectManagerIdWith,
  type DirectManagerDepartmentDoc,
  type DirectManagerSource,
  type DirectManagerUserDoc,
} from "./direct-manager";

function source(
  users: Record<string, DirectManagerUserDoc>,
  departments: Record<string, DirectManagerDepartmentDoc> = {},
): DirectManagerSource & { deptReads: number } {
  const s = {
    deptReads: 0,
    getUser: async (uid: string) => users[uid] ?? null,
    getDepartment: async (id: string) => {
      s.deptReads++;
      return departments[id] ?? null;
    },
  };
  return s;
}

describe("resolveDirectManagerIdWith — luật Quản lý trực tiếp (hợp đồng 03/10/2026)", () => {
  it("có directManagerIds → lấy phần tử [0]", async () => {
    const src = source(
      { u: { directManagerIds: ["m1", "m2"], departmentId: "d1" }, m1: {}, m2: {}, lead: {} },
      { d1: { leaderId: "lead" } },
    );
    expect(await resolveDirectManagerIdWith("u", src)).toBe("m1");
  });

  it("[0] là chính mình → lấy [1]", async () => {
    const src = source({ u: { directManagerIds: ["u", "m2"] }, m2: {} });
    expect(await resolveDirectManagerIdWith("u", src)).toBe("m2");
  });

  it("[0] không còn tồn tại trong users → lấy [1]", async () => {
    const src = source({ u: { directManagerIds: ["ghost", "m2"] }, m2: {} });
    expect(await resolveDirectManagerIdWith("u", src)).toBe("m2");
  });

  it("directManagerIds trống/không có → trưởng đơn vị chính (hành vi cũ)", async () => {
    const src = source({ u: { directManagerIds: [], departmentId: "d1" } }, { d1: { leaderId: "lead" } });
    expect(await resolveDirectManagerIdWith("u", src)).toBe("lead");
    const src2 = source({ u: { departmentId: "d1" } }, { d1: { leaderId: "lead" } });
    expect(await resolveDirectManagerIdWith("u", src2)).toBe("lead");
  });

  it("đơn vị không có trưởng → trưởng nhóm cha", async () => {
    const src = source(
      { u: { departmentId: "child" } },
      { child: { leaderId: null, parentId: "parent" }, parent: { leaderId: "boss" } },
    );
    expect(await resolveDirectManagerIdWith("u", src)).toBe("boss");
  });

  it("chính mình là trưởng đơn vị → lên nhóm cha", async () => {
    const src = source(
      { u: { departmentId: "child" } },
      { child: { leaderId: "u", parentId: "parent" }, parent: { leaderId: "boss" } },
    );
    expect(await resolveDirectManagerIdWith("u", src)).toBe("boss");
  });

  it("vòng lặp parentId không treo, trả null sau tối đa 10 bậc", async () => {
    const src = source(
      { u: { departmentId: "a" } },
      { a: { leaderId: "u", parentId: "b" }, b: { leaderId: null, parentId: "a" } },
    );
    expect(await resolveDirectManagerIdWith("u", src)).toBeNull();
    expect(src.deptReads).toBeLessThanOrEqual(10);
  });

  it("không có gì → null", async () => {
    expect(await resolveDirectManagerIdWith("u", source({ u: {} }))).toBeNull();
    expect(await resolveDirectManagerIdWith("missing", source({}))).toBeNull();
  });
});

describe("prioritizeDirectManagers", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };
  it("đưa directManagerIds lên đầu đúng thứ tự, giữ phần còn lại", () => {
    expect(prioritizeDirectManagers([a, b, c], ["c", "a"]).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
  it("chèn người ngoài danh sách gốc (extra), bỏ id không có hồ sơ", () => {
    const x = { id: "x" };
    expect(prioritizeDirectManagers([a, b], ["x", "ghost", "b"], [x]).map((i) => i.id)).toEqual(["x", "b", "a"]);
  });
});
