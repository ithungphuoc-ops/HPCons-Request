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

  it("cờ đính kèm tệp: nhóm cũ (thiếu field) lưu toàn Không → không ghi dòng ảo; bật thật → 1 dòng", () => {
    const allOff = { approve: false, reject: false, forward: false, approveAndForward: false };
    expect(diffGroupPatch({}, { decisionAttachmentEnabled: allOff, requireDecisionAttachment: allOff })).toEqual([]);
    const changes = diffGroupPatch({}, { decisionAttachmentEnabled: { ...allOff, approve: true } });
    expect(changes).toEqual([
      {
        field: "Ý kiến khi phê duyệt — có ô đính kèm tệp",
        before: "Chấp thuận: Không, Từ chối: Không, Chuyển tiếp: Không, Chấp thuận và chuyển tiếp: Không",
        after: "Chấp thuận: Có, Từ chối: Không, Chuyển tiếp: Không, Chấp thuận và chuyển tiếp: Không",
      },
    ]);
  });

  it("field thường vẫn so như cũ", () => {
    expect(diffGroupPatch({ name: "A" }, { name: "B" })).toHaveLength(1);
    expect(diffGroupPatch({ name: "A" }, { name: "A" })).toEqual([]);
  });
});

describe("diffGroupPatch — hướng dẫn điều chỉnh của nhóm", () => {
  it("thiếu field → null (đều 'theo mặc định') → không ghi dòng ảo", () => {
    expect(diffGroupPatch({}, { adjustmentGuide: null })).toEqual([]);
  });
  it("soạn riêng / xoá trắng / quay về mặc định → dòng lịch sử dễ đọc", () => {
    expect(diffGroupPatch({}, { adjustmentGuide: "HD mới" })).toEqual([
      { field: "Điều chỉnh sau duyệt — hướng dẫn", before: "Theo nội dung mặc định", after: "HD mới" },
    ]);
    expect(diffGroupPatch({ adjustmentGuide: "HD" }, { adjustmentGuide: "" })).toEqual([
      { field: "Điều chỉnh sau duyệt — hướng dẫn", before: "HD", after: "(Để trống — không hiện cảnh báo)" },
    ]);
    expect(diffGroupPatch({ adjustmentGuide: "HD" }, { adjustmentGuide: null })[0].after).toBe("Theo nội dung mặc định");
  });
  it("hướng dẫn dài → cắt bớt trong lịch sử", () => {
    const after = diffGroupPatch({}, { adjustmentGuide: "x".repeat(500) })[0].after;
    expect(after.length).toBe(301);
    expect(after.endsWith("…")).toBe(true);
  });
});
