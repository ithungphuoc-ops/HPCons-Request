import { describe, expect, it } from "vitest";
import { REQUEST_SUMMARY_FIELDS, toRequestSummary } from "./request-summary";
import { notableFieldParts, notableFields, tableFieldCellValues, draftLinkFor, submitterInitial } from "./request-list-format";
import { resolveRequestTitle } from "./request-title";
import { matchesRequestView, REQUEST_VIEW_ORDER } from "./request-views";
import type { RequestInstance } from "./types";

const NOW = Date.parse("2026-10-08T03:00:00.000Z");

/** Đề xuất "đầy đủ" có đủ các field nặng mà bản gọn bỏ đi. */
function full(over: Partial<RequestInstance> = {}): RequestInstance {
  return {
    id: "r1",
    code: "000000184",
    groupId: "g1",
    groupNameSnapshot: "1.0. Phiếu đề nghị",
    fieldsSnapshot: [
      { id: "f1", code: "ten_de_xuat", name: "Tên đề xuất", dataType: "short_text", order: 1 },
      { id: "f2", name: "Công trình", dataType: "short_text", order: 2 },
      { id: "f3", name: "Số tiền", dataType: "number", order: 3 },
      { id: "f4", name: "Chi tiết", dataType: "table", order: 4, tableColumns: ["Vật tư", "SL"] },
    ],
    values: { f1: "Mua sơn", f2: "AID", f3: 1500000, f4: JSON.stringify([["Sơn trắng", "3"]]) },
    submittedBy: { uid: "u1", name: "Lê Minh" },
    submittedAt: "2026-10-07T01:00:00.000Z",
    updatedAt: "2026-10-07T02:00:00.000Z",
    approvalFlow: "sequential",
    approversSnapshot: [{ id: "me", name: "Tôi", username: "toi", avatarInitial: "T" }],
    approvers: [{ id: "me", decision: "pending" }],
    followers: [{ id: "f", name: "F", username: "f", avatarInitial: "F" }],
    status: "pending",
    deadlineAt: "2026-10-07T05:00:00.000Z",
    bookmarkedByUids: ["me"],
    history: [{ at: "2026-10-07T01:00:00.000Z", actor: "Lê Minh", action: "Đã gửi đề xuất" }],
    comments: [{ id: "c1", authorUid: "x", authorName: "X", text: "hi", at: "2026-10-07T01:30:00.000Z" }],
    attachments: [{ name: "a.pdf", path: "p", size: 1 }],
    viewedAt: { me: "2026-10-07T03:00:00.000Z" },
    deletedAt: null,
    ...over,
  } as unknown as RequestInstance;
}

/** Giả lập Firestore `.select(...)`: chỉ giữ đúng các field được chọn. */
function selectLike(r: RequestInstance): RequestInstance {
  const { id, ...data } = r as unknown as Record<string, unknown> & { id: string };
  const picked: Record<string, unknown> = {};
  for (const k of REQUEST_SUMMARY_FIELDS) if (k in data) picked[k] = data[k];
  return toRequestSummary(id, picked);
}

describe("toRequestSummary — bản gọn hiển thị y như bản đầy đủ ở Trang chủ / Tìm kiếm", () => {
  const cases: [string, RequestInstance][] = [
    ["đang chờ, quá hạn, đến lượt tôi, đã đánh dấu", full()],
    ["nháp", full({ status: "draft", deadlineAt: null })],
    [
      "điều chỉnh sau duyệt chờ tôi",
      full({
        status: "approved",
        pendingAdjustment: {
          noiDung: "đổi",
          attachment: null,
          requestedByUid: "u1",
          requestedByName: "Lê Minh",
          createdAt: "2026-10-07T04:00:00.000Z",
          approvers: [{ uid: "me", name: "Tôi", approvedAt: null }],
        },
      } as never),
    ],
  ];

  it.each(cases)("%s", (_label, r) => {
    const s = selectLike(r);
    expect(resolveRequestTitle(s)).toBe(resolveRequestTitle(r));
    expect(notableFields(s)).toEqual(notableFields(r));
    expect(notableFieldParts(s)).toEqual(notableFieldParts(r));
    expect(tableFieldCellValues(s)).toEqual(tableFieldCellValues(r));
    expect(draftLinkFor(s)).toBe(draftLinkFor(r));
    expect(submitterInitial(s)).toBe(submitterInitial(r));
    for (const v of REQUEST_VIEW_ORDER) {
      for (const uid of ["me", "u1", null]) expect(matchesRequestView(v, s, uid, NOW), `${v}/${uid}`).toBe(matchesRequestView(v, r, uid, NOW));
    }
    for (const k of ["id", "code", "status", "groupNameSnapshot", "submittedBy", "submittedAt", "updatedAt", "approversSnapshot", "approvers", "followers", "bookmarkedByUids", "deletedAt"] as const) {
      expect(s[k], k).toEqual(r[k]);
    }
  });

  it("bỏ field nặng nhưng vẫn đúng kiểu (mảng rỗng, không undefined)", () => {
    const s = selectLike(full());
    expect(s.history).toEqual([]);
    expect(s.comments).toEqual([]);
    expect("attachments" in s).toBe(false);
    expect("viewedAt" in s).toBe(false);
  });

  it("bản ghi thiếu field (dữ liệu cũ) vẫn có mặc định an toàn", () => {
    const s = toRequestSummary("x", { status: "pending", submittedBy: { uid: "a", name: "A" }, groupNameSnapshot: "G", submittedAt: "2026-01-01" });
    expect(s).toMatchObject({ approvers: [], approversSnapshot: [], followers: [], fieldsSnapshot: [], values: {}, deletedAt: null });
    expect(resolveRequestTitle(s)).toBe("G");
  });
});
