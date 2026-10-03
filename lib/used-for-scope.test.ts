import { describe, expect, it } from "vitest";
import {
  buildScopeMembership,
  collectDescendantIds,
  collectGroupAndAncestors,
  flattenDepartmentTree,
  isInUsedForScope,
  usedForNeedsMembership,
} from "./used-for-scope";
import type { TaggedUser } from "./types";

// Cây giả: Phòng Thi công (tc) ← Bộ phận Thi công (btc), Bộ phận Bảo trì (bt);
// Phòng Đấu thầu (dt) ← Bộ phận Đấu thầu 1 (dt1).
const PARENT: Record<string, string | null> = { tc: null, btc: "tc", bt: "tc", dt: null, dt1: "dt" };
const parentOf = (id: string) => PARENT[id];
const DEPTS = Object.entries(PARENT).map(([id, parentId]) => ({ id, name: id.toUpperCase(), parentId }));

const person = (id: string): TaggedUser => ({ id, name: id, username: id, avatarInitial: id[0] });
const team = (id: string): TaggedUser => ({ id, name: id, username: id, avatarInitial: id[0], kind: "group" });

const member = (uid: string, departmentId: string | null, secondary: string[] = []) =>
  buildScopeMembership(uid, { departmentId, secondaryDepartmentIds: secondary }, parentOf);

describe("isInUsedForScope", () => {
  it("usedFor rỗng = toàn công ty", () => {
    expect(isInUsedForScope({ usedFor: [] }, "ai-cung-duoc", null)).toBe(true);
  });

  it("người lẻ: chỉ đúng uid được chọn", () => {
    const g = { usedFor: [person("u1")] };
    expect(isInUsedForScope(g, "u1", null)).toBe(true);
    expect(isInUsedForScope(g, "u2", member("u2", "tc"))).toBe(false);
  });

  it("dữ liệu cũ chỉ có người (không có kind) chạy y như trước, không cần hồ sơ App Tổng", () => {
    const g = { usedFor: [person("u1"), person("u2")] };
    expect(usedForNeedsMembership(g.usedFor)).toBe(false);
    expect(isInUsedForScope(g, "u2", undefined)).toBe(true);
    expect(isInUsedForScope(g, "u3", undefined)).toBe(false);
  });

  it("nhóm chính: đơn vị chính đúng nhóm đã chọn", () => {
    const g = { usedFor: [team("dt")] };
    expect(isInUsedForScope(g, "u1", member("u1", "dt"))).toBe(true);
    expect(isInUsedForScope(g, "u2", member("u2", "tc"))).toBe(false);
  });

  it("chọn nhóm cha = gồm nhóm con", () => {
    const g = { usedFor: [team("tc")] };
    expect(isInUsedForScope(g, "u1", member("u1", "btc"))).toBe(true);
    expect(isInUsedForScope(g, "u2", member("u2", "bt"))).toBe(true);
    expect(isInUsedForScope(g, "u3", member("u3", "dt1"))).toBe(false);
  });

  it("chọn nhóm con KHÔNG gồm nhóm cha/anh em", () => {
    const g = { usedFor: [team("btc")] };
    expect(isInUsedForScope(g, "u1", member("u1", "tc"))).toBe(false);
    expect(isInUsedForScope(g, "u2", member("u2", "bt"))).toBe(false);
  });

  it("kiêm nhiệm: mặc định tính, tắt được theo từng loại đề xuất", () => {
    const m = member("u1", "dt1", ["btc"]);
    expect(isInUsedForScope({ usedFor: [team("tc")] }, "u1", m)).toBe(true);
    expect(isInUsedForScope({ usedFor: [team("tc")], usedForIncludeSecondary: true }, "u1", m)).toBe(true);
    expect(isInUsedForScope({ usedFor: [team("tc")], usedForIncludeSecondary: false }, "u1", m)).toBe(false);
    // Tắt kiêm nhiệm không ảnh hưởng đơn vị chính.
    expect(isInUsedForScope({ usedFor: [team("dt")], usedForIncludeSecondary: false }, "u1", m)).toBe(true);
  });

  it("kết hợp nhóm + người lẻ", () => {
    const g = { usedFor: [team("dt"), person("u9")] };
    expect(isInUsedForScope(g, "u9", member("u9", "tc"))).toBe(true);
    expect(isInUsedForScope(g, "u1", member("u1", "dt1"))).toBe(true);
    expect(isInUsedForScope(g, "u2", member("u2", "tc"))).toBe(false);
  });

  it("có nhóm nhưng thiếu hồ sơ (membership null) → không thuộc nhóm, người lẻ vẫn khớp", () => {
    const g = { usedFor: [team("tc"), person("u1")] };
    expect(isInUsedForScope(g, "u1", null)).toBe(true);
    expect(isInUsedForScope(g, "u2", null)).toBe(false);
  });

  it("id người trùng id nhóm không khớp nhầm", () => {
    expect(isInUsedForScope({ usedFor: [person("tc")] }, "u1", member("u1", "tc"))).toBe(false);
  });
});

describe("collectGroupAndAncestors / buildScopeMembership", () => {
  it("đi lên đủ nhóm cha", () => {
    expect(collectGroupAndAncestors("btc", parentOf)).toEqual(["btc", "tc"]);
  });

  it("vòng lặp parentId không treo", () => {
    const loop: Record<string, string> = { a: "b", b: "c", c: "a" };
    expect(collectGroupAndAncestors("a", (id) => loop[id])).toEqual(["a", "b", "c"]);
  });

  it("chuỗi cha quá dài bị chặn ở 10 bậc", () => {
    const chain = (id: string) => `n${Number(id.slice(1)) + 1}`;
    expect(collectGroupAndAncestors("n0", chain)).toHaveLength(11);
  });

  it("phòng ban không tồn tại vẫn giữ id, không lỗi", () => {
    expect(collectGroupAndAncestors("da-xoa", () => undefined)).toEqual(["da-xoa"]);
  });

  it("tách nhóm chính và kiêm nhiệm, không trùng", () => {
    const m = buildScopeMembership("u1", { departmentId: "btc", secondaryDepartmentIds: ["bt", "", 5, "dt1"] }, parentOf);
    expect(m.primaryGroupIds).toEqual(["btc", "tc"]);
    expect(m.secondaryGroupIds.sort()).toEqual(["bt", "dt", "dt1"]);
  });

  it("hồ sơ không có đơn vị", () => {
    expect(buildScopeMembership("u1", null, parentOf)).toEqual({ userId: "u1", primaryGroupIds: [], secondaryGroupIds: [] });
  });
});

describe("collectDescendantIds / flattenDepartmentTree", () => {
  it("con cháu của nhóm đã chọn", () => {
    expect([...collectDescendantIds(["tc"], DEPTS)].sort()).toEqual(["bt", "btc"]);
    expect([...collectDescendantIds(["btc"], DEPTS)]).toEqual([]);
  });

  it("cây phẳng: cha trước, con thụt vào", () => {
    const rows = flattenDepartmentTree(DEPTS).map((r) => `${r.depth}:${r.dept.id}`);
    expect(rows).toEqual(["0:dt", "1:dt1", "0:tc", "1:bt", "1:btc"]);
  });

  it("cây có vòng lặp vẫn liệt kê đủ, không lặp vô hạn", () => {
    const loop = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ];
    expect(flattenDepartmentTree(loop).map((r) => r.dept.id).sort()).toEqual(["a", "b"]);
  });
});
