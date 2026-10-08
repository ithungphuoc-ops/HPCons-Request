import { describe, expect, it } from "vitest";
import {
  buildPushPayload,
  normalizePushPreferences,
  PUSH_CATEGORY_OF,
  type PushKind,
} from "./web-push-payload";

const ALL_KINDS = Object.keys(PUSH_CATEGORY_OF) as PushKind[];
const input = { requestId: "r1", code: "000123", groupName: "1.0. Phiếu đề nghị (HPCons)", actorName: "Nguyễn Văn A" };

describe("buildPushPayload — nội dung ngắn cho màn hình khoá", () => {
  it("ví dụ Sếp duyệt", () => {
    expect(buildPushPayload({ ...input, kind: "pending_approval" })).toMatchObject({
      title: "Đề xuất 000123 chờ bạn duyệt",
      body: "Nguyễn Văn A gửi · 1.0. Phiếu đề nghị (HPCons)",
      url: "/request/requests/r1",
      tag: "req-r1",
    });
    expect(buildPushPayload({ ...input, kind: "mentioned", code: "000166", actorName: "Nguyễn Tấn Hậu" }).title).toBe(
      "Nguyễn Tấn Hậu nhắc bạn trong đề xuất 000166",
    );
    expect(buildPushPayload({ ...input, kind: "approved", code: "000198" }).title).toBe("Đề xuất 000198 của bạn đã được chấp thuận");
  });

  it("chuyển tiếp ghi 'chuyển tiếp' thay vì 'gửi'", () => {
    expect(buildPushPayload({ ...input, kind: "pending_approval", forwarded: true }).body).toBe(
      "Nguyễn Văn A chuyển tiếp · 1.0. Phiếu đề nghị (HPCons)",
    );
  });

  it.each(ALL_KINDS)("%s: chỉ gồm mã + tên nhóm + người làm, tiêu đề/thân không rỗng", (kind) => {
    const p = buildPushPayload({ ...input, kind });
    expect(p.kind).toBe(kind);
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.body.length).toBeGreaterThan(0);
    expect(p.title).toContain("000123");
    // Không có chữ số nào ngoài mã đề xuất + "1.0." của tên nhóm → không thể lọt số tiền.
    const digits = `${p.title} ${p.body}`.replace("000123", "").replace("1.0.", "");
    expect(digits).not.toMatch(/\d/);
  });

  it("từ chối / trả lại KHÔNG kèm lý do (builder không có chỗ nhận lý do)", () => {
    for (const kind of ["rejected", "returned", "adjustment_rejected"] as const) {
      const p = buildPushPayload({ ...input, kind });
      expect(p.body).not.toMatch(/lý do:/i);
    }
  });

  it("thiếu mã / người làm / tên nhóm vẫn ra câu tử tế, không dùng id Firestore", () => {
    const p = buildPushPayload({ kind: "pending_approval", requestId: "AbCdEfGh1234567890xy" });
    expect(p.title).toBe("Một đề xuất chờ bạn duyệt");
    expect(p.body).toBe("Mở app để xem chi tiết");
    expect(p.title).not.toContain("AbCdEf");
  });

  it("tên nhóm quá dài bị cắt", () => {
    const p = buildPushPayload({ ...input, kind: "approved", groupName: "X".repeat(300) });
    expect(p.body.length).toBeLessThan(120);
  });
});

describe("normalizePushPreferences", () => {
  it("thiếu khoá = bật, chỉ false mới tắt", () => {
    expect(normalizePushPreferences(undefined)).toEqual({ approval: true, mention: true, result: true });
    expect(normalizePushPreferences({ mention: false, result: "x" })).toEqual({ approval: true, mention: false, result: true });
  });
});
