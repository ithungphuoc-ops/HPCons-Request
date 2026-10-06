import { describe, expect, it } from "vitest";
import { countOpinionsByApprover, extractApproverOpinions } from "./approver-opinions";
import type { RequestHistoryEntry, TaggedUser } from "./types";

function u(id: string, name: string): TaggedUser {
  return { id, name, username: id, avatarInitial: name[0] };
}

function req(
  history: RequestHistoryEntry[],
  snapshot: TaggedUser[],
  decisions: Record<string, "pending" | "approved" | "rejected"> = {},
) {
  return {
    history,
    approversSnapshot: snapshot,
    approvers: snapshot.map((s) => ({ id: s.id, decision: decisions[s.id] ?? "pending" })),
  };
}

const THI = u("thi", "Hồ Văn Thi");
const PHUONG = u("phuong", "Hồ Hữu Phương");

describe("extractApproverOpinions", () => {
  it("nhiều người, giữ thứ tự thời gian, bỏ note rỗng và hành động không phải duyệt", () => {
    const list = extractApproverOpinions(
      req(
        [
          { at: "2026-09-27T07:00:00.000Z", actor: "Người gửi", action: "Đã gửi đề xuất", note: "không tính" },
          { at: "2026-09-29T02:04:00.000Z", actor: "Hồ Văn Thi", action: "Đã chấp thuận", note: "  " },
          {
            at: "2026-10-06T06:54:00.000Z",
            actor: "hồ hữu phương",
            action: "Đã chấp thuận và chuyển tiếp",
            note: "Dòng 1\nDòng 2",
            target: "Trần Ngọc Phương",
          },
          { at: "2026-10-05T01:00:00.000Z", actor: "Hồ Văn Thi", action: "Đã từ chối", note: "Sai đơn giá" },
        ],
        [THI, PHUONG],
      ),
    );
    expect(list.map((o) => o.kind)).toEqual(["rejected", "approveAndForward"]);
    expect(list[1]).toMatchObject({
      approverId: "phuong",
      approverIndex: 1,
      note: "Dòng 1\nDòng 2",
      target: "Trần Ngọc Phương",
    });
    expect(countOpinionsByApprover(list)).toEqual({ thi: 1, phuong: 1 });
  });

  it("nhãn cũ 'Đã chuyển tiếp' và chuyển tiếp cho duyệt trước đều là chuyển tiếp", () => {
    const list = extractApproverOpinions(
      req(
        [
          { at: "2026-08-01T00:00:00.000Z", actor: "Hồ Văn Thi", action: "Đã chuyển tiếp", note: "Nhờ anh xem" },
          {
            at: "2026-08-02T00:00:00.000Z",
            actor: "Hồ Văn Thi",
            action: "Đã chuyển tiếp cho duyệt trước",
            note: "Xem trước giúp",
          },
        ],
        [THI],
      ),
    );
    expect(list.map((o) => o.kind)).toEqual(["forward", "forward"]);
    expect(countOpinionsByApprover(list)).toEqual({ thi: 2 });
  });

  it("Trả lại có lý do được tính là ý kiến", () => {
    const list = extractApproverOpinions(
      req([{ at: "2026-08-01T00:00:00.000Z", actor: "Hồ Văn Thi", action: "Đã trả lại", note: "Bổ sung báo giá" }], [THI]),
    );
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("returned");
  });

  it("trùng tên: ưu tiên người có quyết định khớp hành động", () => {
    const a = u("a", "Nguyễn Văn An");
    const b = u("b", "Nguyễn Văn An");
    const list = extractApproverOpinions(
      req(
        [{ at: "2026-08-01T00:00:00.000Z", actor: "Nguyễn Văn An", action: "Đã chấp thuận", note: "Ok" }],
        [a, b],
        { a: "pending", b: "approved" },
      ),
    );
    expect(list[0].approverId).toBe("b");
  });

  it("trùng tên mà không phân biệt được → người đứng trước", () => {
    const a = u("a", "Nguyễn Văn An");
    const b = u("b", "Nguyễn Văn An");
    const list = extractApproverOpinions(
      req([{ at: "2026-08-01T00:00:00.000Z", actor: "Nguyễn Văn An", action: "Đã trả lại", note: "Thiếu" }], [a, b]),
    );
    expect(list[0].approverId).toBe("a");
  });

  it("người không còn trong danh sách duyệt vẫn được liệt kê, không gắn id", () => {
    const list = extractApproverOpinions(
      req([{ at: "2026-08-01T00:00:00.000Z", actor: "Người cũ", action: "Đã chuyển tiếp", note: "Giao lại" }], [THI]),
    );
    expect(list[0]).toMatchObject({ actor: "Người cũ", approverId: null, approverIndex: null });
    expect(countOpinionsByApprover(list)).toEqual({});
  });

  it("đề xuất thiếu history/snapshot không lỗi", () => {
    expect(
      extractApproverOpinions({
        history: undefined as unknown as RequestHistoryEntry[],
        approversSnapshot: undefined as unknown as TaggedUser[],
        approvers: [],
      }),
    ).toEqual([]);
  });
});
