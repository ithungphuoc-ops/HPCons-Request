import { describe, expect, it } from "vitest";
import {
  isRequestBookmarked,
  isRequestMyTurn,
  isRequestOverdue,
  matchesRequestView,
} from "./request-views";
import type { RequestInstance } from "./types";

const NOW = Date.parse("2026-09-14T10:00:00.000Z");
const hours = (h: number) => new Date(NOW + h * 3600_000).toISOString();

/** Chỉ dựng đúng các trường mà request-views đọc tới. */
function makeRequest(patch: Partial<RequestInstance> = {}): RequestInstance {
  return {
    status: "pending",
    approvalFlow: "sequential",
    approvers: [
      { id: "u1", decision: "pending" },
      { id: "u2", decision: "pending" },
    ],
    deadlineAt: null,
    bookmarkedByUids: [],
    ...patch,
  } as RequestInstance;
}

describe("isRequestOverdue", () => {
  it("quá hạn khi còn chờ duyệt và hạn đã trôi qua", () => {
    expect(isRequestOverdue(makeRequest({ deadlineAt: hours(-1) }), NOW)).toBe(true);
  });

  it("chưa tới hạn thì không tính quá hạn", () => {
    expect(isRequestOverdue(makeRequest({ deadlineAt: hours(1) }), NOW)).toBe(false);
  });

  it("nhóm không đặt SLA (deadlineAt null) thì không bao giờ quá hạn", () => {
    expect(isRequestOverdue(makeRequest({ deadlineAt: null }), NOW)).toBe(false);
  });

  it("đề xuất đã chấp thuận thì KHÔNG quá hạn dù hạn đã trôi qua", () => {
    // Điểm mấu chốt: quá hạn chỉ có nghĩa khi còn đang chờ ai đó xử lý.
    const done = makeRequest({ status: "approved", deadlineAt: hours(-100) });
    expect(isRequestOverdue(done, NOW)).toBe(false);
  });

  it("deadlineAt hỏng thì coi như không quá hạn, không báo động giả", () => {
    expect(isRequestOverdue(makeRequest({ deadlineAt: "khong-phai-ngay" }), NOW)).toBe(false);
  });
});

describe("isRequestMyTurn", () => {
  it("quy trình lần lượt: chỉ người đầu tiên còn chờ mới tới lượt", () => {
    const r = makeRequest();
    expect(isRequestMyTurn(r, "u1")).toBe(true);
    expect(isRequestMyTurn(r, "u2")).toBe(false);
  });

  it("người đầu duyệt xong thì tới lượt người kế", () => {
    const r = makeRequest({
      approvers: [
        { id: "u1", decision: "approved" },
        { id: "u2", decision: "pending" },
      ],
    });
    expect(isRequestMyTurn(r, "u1")).toBe(false);
    expect(isRequestMyTurn(r, "u2")).toBe(true);
  });

  it("quy trình đồng thời: ai còn chờ cũng tới lượt", () => {
    const r = makeRequest({ approvalFlow: "concurrent" });
    expect(isRequestMyTurn(r, "u1")).toBe(true);
    expect(isRequestMyTurn(r, "u2")).toBe(true);
  });

  it("người ngoài danh sách duyệt thì không bao giờ tới lượt", () => {
    expect(isRequestMyTurn(makeRequest(), "nguoi-la")).toBe(false);
  });

  it("đề xuất đã xong thì không còn tới lượt ai", () => {
    const r = makeRequest({ status: "approved" });
    expect(isRequestMyTurn(r, "u1")).toBe(false);
  });

  it("chưa biết uid (phiên chưa tải) thì trả false, không lộ đề xuất người khác", () => {
    expect(isRequestMyTurn(makeRequest(), null)).toBe(false);
  });
});

describe("isRequestBookmarked", () => {
  it("đánh dấu là RIÊNG từng người, không phải cờ chung", () => {
    const r = makeRequest({ bookmarkedByUids: ["u1"] });
    expect(isRequestBookmarked(r, "u1")).toBe(true);
    expect(isRequestBookmarked(r, "u2")).toBe(false);
  });

  it("đề xuất cũ chưa có trường bookmarkedByUids thì không vỡ", () => {
    const r = makeRequest({ bookmarkedByUids: undefined });
    expect(isRequestBookmarked(r, "u1")).toBe(false);
  });

  it("chưa biết uid thì trả false", () => {
    expect(isRequestBookmarked(makeRequest({ bookmarkedByUids: ["u1"] }), null)).toBe(false);
  });
});

describe("matchesRequestView", () => {
  it('góc nhìn "Tất cả" không lọc gì', () => {
    expect(matchesRequestView("all", makeRequest({ status: "rejected" }), null, NOW)).toBe(true);
  });

  it("MỘT đề xuất có thể nằm trong NHIỀU góc nhìn cùng lúc", () => {
    // Đây chính là lý do 3 thứ này là bộ lọc suy ra, không phải trạng thái:
    // nếu là trạng thái thì một đề xuất chỉ được nằm đúng một chỗ.
    const r = makeRequest({ deadlineAt: hours(-5), bookmarkedByUids: ["u1"] });
    expect(matchesRequestView("turn", r, "u1", NOW)).toBe(true);
    expect(matchesRequestView("overdue", r, "u1", NOW)).toBe(true);
    expect(matchesRequestView("bookmarked", r, "u1", NOW)).toBe(true);
    expect(r.status).toBe("pending"); // trạng thái thật vẫn nguyên
  });

  it("cùng một đề xuất, hai người xem cho kết quả khác nhau", () => {
    const r = makeRequest({ bookmarkedByUids: ["u2"] });
    expect(matchesRequestView("turn", r, "u1", NOW)).toBe(true);
    expect(matchesRequestView("turn", r, "u2", NOW)).toBe(false);
    expect(matchesRequestView("bookmarked", r, "u1", NOW)).toBe(false);
    expect(matchesRequestView("bookmarked", r, "u2", NOW)).toBe(true);
  });
});
