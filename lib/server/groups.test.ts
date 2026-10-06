import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/firebase/admin", () => ({ adminDb: {} }));

import { diffGroupPatch } from "./groups";

describe("diffGroupPatch — cờ Ý kiến khi phê duyệt", () => {
  it("cùng nghĩa nhưng khác thứ tự key → không ghi lịch sử ảo", () => {
    const before = {
      requireDecisionNote: { reject: true, approve: false, approveAndForward: true, forward: false },
      decisionNoteEnabled: { forward: false, approve: true, reject: true, approveAndForward: true },
    };
    const patch = {
      requireDecisionNote: { approve: false, reject: true, forward: false, approveAndForward: true },
      decisionNoteEnabled: { approve: true, reject: true, forward: false, approveAndForward: true },
    };
    expect(diffGroupPatch(before, patch)).toEqual([]);
  });

  it("đổi thật → 1 dòng, hiển thị dễ đọc", () => {
    const changes = diffGroupPatch(
      { decisionNoteEnabled: { approve: true } },
      { decisionNoteEnabled: { approve: false } },
    );
    expect(changes).toEqual([
      { field: "Ý kiến khi phê duyệt — có ô ghi chú", before: "Chấp thuận: Có", after: "Chấp thuận: Không" },
    ]);
  });

  it("field thường vẫn so như cũ", () => {
    expect(diffGroupPatch({ name: "A" }, { name: "B" })).toHaveLength(1);
    expect(diffGroupPatch({ name: "A" }, { name: "A" })).toEqual([]);
  });
});
