import { describe, expect, it } from "vitest";
import {
  buildPushPayload,
  clipLine,
  EXCERPT_PUSH_MAX,
  normalizePushPreferences,
  PUSH_CATEGORY_OF,
  shortCode,
  type PushKind,
} from "./web-push-payload";

const ALL_KINDS = Object.keys(PUSH_CATEGORY_OF) as PushKind[];
const base = {
  requestId: "r1",
  code: "000000231",
  groupName: "1.0. Phiếu đề nghị (HPCons)",
  requestTitle: "Mua thép hộp 40×80 công trình Khánh Thành",
  hasCustomTitle: true,
  actorName: "Trần Văn B",
};

describe("buildPushPayload — đúng câu chữ demo Sếp duyệt (noi-dung-thong-bao-day-2026-10-08)", () => {
  it("nhắc tên", () => {
    expect(
      buildPushPayload({ ...base, kind: "mentioned", code: "000000166", groupName: "1. Phiếu đề nghị", actorName: "Nguyễn Tấn Hậu", excerpt: "@HauNT anh xem giúp báo giá" }),
    ).toMatchObject({
      title: "💬 Nguyễn Tấn Hậu nhắc bạn trong bình luận",
      body: "“@HauNT anh xem giúp báo giá”\n#000166 · 1. Phiếu đề nghị",
      actionTitle: "Mở đề xuất",
      url: "/request/requests/r1",
      tag: "req-r1",
    });
  });

  it("chờ bạn duyệt / được chuyển tiếp", () => {
    expect(buildPushPayload({ ...base, kind: "pending_approval" })).toMatchObject({
      title: "⏳ Chờ bạn duyệt — Trần Văn B gửi",
      body: "Mua thép hộp 40×80 công trình Khánh Thành\n#000231 · 1.0. Phiếu đề nghị (HPCons)",
      actionTitle: "Mở để duyệt",
    });
    expect(buildPushPayload({ ...base, kind: "pending_approval", actorName: "Cẩm Thu", forwarded: true }).title).toBe(
      "⏳ Cẩm Thu chuyển tiếp cho bạn duyệt",
    );
    // Nhóm không có trường "tên đề xuất" → không lặp tên nhóm 2 lần.
    expect(buildPushPayload({ ...base, kind: "pending_approval", hasCustomTitle: false }).body).toBe("#000231 · 1.0. Phiếu đề nghị (HPCons)");
  });

  it("duyệt xong (chỉ bước cuối) — có/không đếm bước", () => {
    const p = buildPushPayload({ ...base, kind: "approved", code: "000198", requestTitle: "Mua máy in văn phòng tầng 3", actorName: "Nguyễn Thị Cẩm Thu", approverTotal: 2 });
    expect(p.title).toBe("✅ Đề xuất của bạn đã được duyệt xong");
    expect(p.body).toBe("Nguyễn Thị Cẩm Thu duyệt bước cuối (2/2)\nMua máy in văn phòng tầng 3 · #000198");
    expect(buildPushPayload({ ...base, kind: "approved", approverTotal: 3, approvalFlow: "single" }).body.split("\n")[0]).toBe("Trần Văn B đã duyệt");
    expect(buildPushPayload({ ...base, kind: "approved", approverTotal: 3, approvalFlow: "concurrent" }).body.split("\n")[0]).toBe(
      "Trần Văn B duyệt cuối cùng (3/3)",
    );
    expect(buildPushPayload({ ...base, kind: "approved", approverTotal: 3, approvalFlow: "sequential" }).body.split("\n")[0]).toBe(
      "Trần Văn B duyệt bước cuối (3/3)",
    );
  });

  it("từ chối / trả lại kèm lý do; trả lại có nút Sửa và gửi lại", () => {
    const r = buildPushPayload({ ...base, kind: "rejected", actorName: "Lê Văn C", excerpt: "Thiếu báo giá so sánh 3 nhà cung cấp" });
    expect(r.title).toBe("❌ Đề xuất của bạn bị từ chối");
    expect(r.body).toBe("Lê Văn C: “Thiếu báo giá so sánh 3 nhà cung cấp”\nMua thép hộp 40×80 công trình Khánh Thành · #000231");
    const t = buildPushPayload({ ...base, kind: "returned", actorName: "Lê Văn C", excerpt: "Bổ sung hình ảnh hiện trạng" });
    expect(t.title).toBe("↩️ Đề xuất bị trả lại để bổ sung");
    expect(t.body.split("\n")[0]).toBe("Lê Văn C: “Bổ sung hình ảnh hiện trạng”");
    expect(t.actionTitle).toBe("Sửa và gửi lại");
    expect(t.url).toBe("/request/requests/r1");
    expect(buildPushPayload({ ...base, kind: "returned", editUrl: "/request/groups/g1/submit?draftId=r1" }).url).toBe(
      "/request/groups/g1/submit?draftId=r1",
    );
    expect(buildPushPayload({ ...base, kind: "rejected", actorName: "Lê Văn C" }).body.split("\n")[0]).toBe("Lê Văn C đã từ chối");
  });

  it("bình luận mới trên đề xuất của tôi", () => {
    const p = buildPushPayload({ ...base, kind: "comment_on_mine", actorName: "Lê Văn C", excerpt: "Đã nhận hàng đợt 1, còn thiếu 20 cây" });
    expect(p.title).toBe("💬 Lê Văn C bình luận đề xuất của bạn");
    expect(p.body).toBe("“Đã nhận hàng đợt 1, còn thiếu 20 cây”\nMua thép hộp 40×80 công trình Khánh Thành · #000231");
  });

  it("điều chỉnh chờ duyệt: có nội dung / chỉ có tệp", () => {
    const p = buildPushPayload({ ...base, kind: "adjustment_pending", code: "000150", excerpt: "Thép hộp 40×80 đổi 120 → 90 cây" });
    expect(p.title).toBe("✏️ Điều chỉnh sau duyệt chờ bạn duyệt");
    expect(p.body).toBe("Trần Văn B: “Thép hộp 40×80 đổi 120 → 90 cây”\n#000150 · 1.0. Phiếu đề nghị (HPCons)");
    expect(p.actionTitle).toBe("Mở để duyệt");
    expect(buildPushPayload({ ...base, kind: "adjustment_pending", fileCount: 2 }).body.split("\n")[0]).toBe("Trần Văn B gửi điều chỉnh kèm 2 tệp");
  });

  it("điều chỉnh có kết quả", () => {
    expect(buildPushPayload({ ...base, kind: "adjustment_approved", code: "000150", approverTotal: 2 })).toMatchObject({
      title: "✅ Điều chỉnh của bạn đã được chấp thuận",
      body: "Đủ 2/2 người duyệt\nĐề xuất #000150 · 1.0. Phiếu đề nghị (HPCons)",
    });
    expect(buildPushPayload({ ...base, kind: "adjustment_rejected", actorName: "Lê Văn C" }).body.split("\n")[0]).toBe("Lê Văn C đã từ chối");
  });
});

describe("cắt gọn trích dẫn", () => {
  const longMultiLine = `Dòng một\n\nDòng hai   rất dài ${"x".repeat(200)}`;

  it.each(ALL_KINDS)("%s: không quá 2 dòng thân, mỗi dòng không có xuống dòng thừa, trích ≤ ~90 ký tự", (kind) => {
    const p = buildPushPayload({ ...base, kind, excerpt: longMultiLine, requestTitle: longMultiLine, approverTotal: 2 });
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.title).not.toContain("\n");
    const bodyLines = p.body.split("\n");
    expect(bodyLines.length).toBeLessThanOrEqual(2);
    for (const line of bodyLines) {
      expect(line.trim()).toBe(line);
      expect(line.length).toBeLessThan(EXCERPT_PUSH_MAX + 60);
    }
  });

  it("clipLine: gộp xuống dòng thành 1 dòng + …", () => {
    expect(clipLine("a\nb\r\n  c")).toBe("a b c");
    const c = clipLine("y".repeat(200));
    expect(c.length).toBe(EXCERPT_PUSH_MAX + 1);
    expect(c.endsWith("…")).toBe(true);
  });

  it("shortCode bỏ số 0 thừa, giữ ≥ 6 chữ số", () => {
    expect(shortCode("000000166")).toBe("000166");
    expect(shortCode("000123")).toBe("000123");
    expect(shortCode("1234567")).toBe("1234567");
    expect(shortCode("DX-0001")).toBe("DX-0001");
  });

  it("thiếu mã / người làm vẫn ra câu tử tế, không dùng id Firestore", () => {
    const p = buildPushPayload({ kind: "pending_approval", requestId: "AbCdEfGh1234567890xy" });
    expect(p.title).toBe("⏳ Có đề xuất chờ bạn duyệt");
    expect(`${p.title} ${p.body}`).not.toContain("AbCdEf");
  });
});

describe("normalizePushPreferences", () => {
  it("thiếu khoá = bật (kể cả loại bình luận mới), chỉ false mới tắt", () => {
    expect(normalizePushPreferences(undefined)).toEqual({ approval: true, mention: true, comment: true, result: true });
    expect(normalizePushPreferences({ mention: false, result: "x" })).toEqual({ approval: true, mention: false, comment: true, result: true });
    expect(normalizePushPreferences({ comment: false }).comment).toBe(false);
  });
});

describe("cắt theo cụm ký tự + bỏ ký tự điều khiển (review PR #96)", () => {
  it("emoji đúng ở vị trí ~90 không bị vỡ thành ký tự lỗi", () => {
    const text = `${"a".repeat(89)}😀😀 đuôi`;
    const c = clipLine(text);
    expect(c).toBe(`${"a".repeat(89)}😀…`);
    expect(c).not.toContain("\uFFFD");
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(c)).toBe(false); // không còn nửa cặp surrogate
  });

  it("emoji gia đình (nối ZWJ) giữ nguyên 1 khối, không tách thành người rời", () => {
    const family = "👨‍👩‍👧‍👦";
    expect(clipLine(`${"b".repeat(88)}${family}${family}xyz`)).toBe(`${"b".repeat(88)}${family}${family}…`);
    expect(clipLine(`Nhà ${family}`)).toBe(`Nhà ${family}`);
  });

  it("chữ tiếng Việt gõ dạng tổ hợp (NFD) chuẩn hoá NFC, cắt không rơi dấu", () => {
    const nfd = "Đề nghị".normalize("NFD").repeat(20);
    const c = clipLine(nfd, 10);
    expect(c).toBe(c.normalize("NFC"));
    expect(c).toBe(`${"Đề nghị".repeat(2).slice(0, 10).trimEnd()}…`);
  });

  it("bỏ ký tự đảo chiều / vô hình trong mọi trường chữ", () => {
    const evil = "\u202Eabc\u2066d\u200Be\u200Ff\uFEFF";
    const p = buildPushPayload({ ...base, kind: "rejected", actorName: `Lê${evil}`, excerpt: evil, requestTitle: evil, groupName: evil, code: `00\u202E1` });
    expect(`${p.title}${p.body}`).not.toMatch(/[\u202A-\u202E\u2066-\u2069\u200B\u200E\u200F\uFEFF]/);
    expect(p.body.split("\n")[0]).toBe("Lêabcdef: “abcdef”");
  });
});
