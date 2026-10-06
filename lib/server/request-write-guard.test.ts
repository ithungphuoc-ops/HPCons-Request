import { describe, expect, it } from "vitest";
import { requestVersionKey } from "@/lib/request-version";
import {
  checkEditGuard,
  deletedGuard,
  parseExpectedVersion,
  REQUEST_CHANGED_MESSAGE,
  REQUEST_DELETED_MESSAGE,
} from "./request-write-guard";
import type { RequestInstance } from "@/lib/types";

function req(extra: Partial<RequestInstance> = {}): RequestInstance {
  return {
    id: "r1",
    groupId: "g1",
    status: "pending",
    approvers: [
      { id: "a", decision: "pending" },
      { id: "b", decision: "pending" },
    ],
    history: [],
    updatedAt: "2026-10-06T01:00:00.000Z",
    deletedAt: null,
    ...extra,
  } as unknown as RequestInstance;
}

describe("requestVersionKey", () => {
  it("không đổi khi chỉ có bình luận (updatedAt) / lịch sử / tệp thay đổi", () => {
    const base = req();
    const touched = req({
      updatedAt: "2026-10-06T09:00:00.000Z",
      history: [{ at: "x", actor: "Hệ thống", action: "Đã đồng bộ" }],
      attachments: [{ name: "a.pdf", path: "p", size: 1 }],
    });
    expect(requestVersionKey(touched)).toBe(requestVersionKey(base));
  });

  it("đổi khi người duyệt quyết định / trạng thái đổi / bị xoá / chuyển tiếp", () => {
    const base = requestVersionKey(req());
    expect(requestVersionKey(req({ approvers: [{ id: "a", decision: "approved" }, { id: "b", decision: "pending" }] } as Partial<RequestInstance>))).not.toBe(base);
    expect(requestVersionKey(req({ status: "returned" }))).not.toBe(base);
    expect(requestVersionKey(req({ deletedAt: "2026-10-06T02:00:00.000Z" }))).not.toBe(base);
    expect(
      requestVersionKey(
        req({
          approvers: [
            { id: "a", decision: "pending" },
            { id: "z", decision: "pending" },
            { id: "b", decision: "pending" },
          ],
        } as Partial<RequestInstance>),
      ),
    ).not.toBe(base);
  });

  it("deletedAt thiếu và null coi như nhau (dữ liệu cũ không có field)", () => {
    const noField = req();
    delete (noField as Partial<RequestInstance>).deletedAt;
    expect(requestVersionKey(noField)).toBe(requestVersionKey(req()));
  });
});

describe("checkEditGuard", () => {
  it("không đổi → cho ghi", () => {
    expect(checkEditGuard(req(), req(), requestVersionKey(req()))).toBeNull();
    expect(checkEditGuard(req(), req())).toBeNull();
  });

  it("đã xoá trên bản mới nhất → 409 'Đề xuất đã bị xoá.'", () => {
    expect(checkEditGuard(req(), req({ deletedAt: "2026-10-06T02:00:00.000Z" }))).toEqual({
      status: 409,
      error: REQUEST_DELETED_MESSAGE,
    });
  });

  it("người duyệt vừa duyệt giữa lúc đọc và ghi → 409 'vừa có thay đổi'", () => {
    const latest = req({ approvers: [{ id: "a", decision: "approved" }, { id: "b", decision: "pending" }] } as Partial<RequestInstance>);
    expect(checkEditGuard(req(), latest)).toEqual({ status: 409, error: REQUEST_CHANGED_MESSAGE });
  });

  it("client mở form từ trước khi bị trả lại (expectedVersion cũ) → 409 dù đọc–ghi trên máy chủ khớp nhau", () => {
    const openedAt = requestVersionKey(req());
    const nowReturned = req({ status: "returned" });
    expect(checkEditGuard(nowReturned, nowReturned, openedAt)).toEqual({ status: 409, error: REQUEST_CHANGED_MESSAGE });
  });
});

describe("deletedGuard / parseExpectedVersion", () => {
  it("deletedGuard", () => {
    expect(deletedGuard(req())).toBeNull();
    expect(deletedGuard(req({ deletedAt: "x" }))?.status).toBe(409);
  });
  it("parseExpectedVersion chỉ nhận chuỗi", () => {
    expect(parseExpectedVersion("abc")).toBe("abc");
    expect(parseExpectedVersion(undefined)).toBeUndefined();
    expect(parseExpectedVersion(123)).toBeUndefined();
    expect(parseExpectedVersion(null)).toBeUndefined();
  });
});
