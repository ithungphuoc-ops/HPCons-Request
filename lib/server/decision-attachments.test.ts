import { describe, expect, it } from "vitest";
import { isFreshOwnUploadPath, sanitizeDecisionAttachmentsInput } from "./decision-attachments";

const NOW = Date.UTC(2026, 9, 6, 7, 0, 0);
const fresh = (uid: string, name = "Bien_ban.pdf", ts = NOW - 60_000) => `requests/${uid}/${ts}-${name}`;
const ON = {
  decisionAttachmentEnabled: { approve: true, reject: true },
  requireDecisionAttachment: { reject: true },
};

function run(over: Partial<Parameters<typeof sanitizeDecisionAttachmentsInput>[0]>) {
  return sanitizeDecisionAttachmentsInput({
    decision: "approved",
    raw: undefined,
    group: ON,
    uid: "uA",
    existingPaths: [],
    nowMs: NOW,
    ...over,
  });
}

describe("isFreshOwnUploadPath", () => {
  it("chỉ nhận path của chính người gọi, đúng dạng buildUploadPath, còn mới", () => {
    expect(isFreshOwnUploadPath(fresh("uA"), "uA", NOW)).toBe(true);
    expect(isFreshOwnUploadPath(fresh("uB"), "uA", NOW)).toBe(false);
    expect(isFreshOwnUploadPath("print-templates/g1/mau.docx", "uA", NOW)).toBe(false);
    expect(isFreshOwnUploadPath(`requests/uA/${NOW}-../uB/x.pdf`, "uA", NOW)).toBe(false);
    expect(isFreshOwnUploadPath("requests/uA/khong-co-moc.pdf", "uA", NOW)).toBe(false);
    // Tệp tải từ hơn 24 giờ trước (vd đã đính vào đề xuất khác) → chặn.
    expect(isFreshOwnUploadPath(fresh("uA", "x.pdf", NOW - 25 * 3600_000), "uA", NOW)).toBe(false);
  });
});

describe("sanitizeDecisionAttachmentsInput", () => {
  it("không gửi tệp → rỗng (ô không bắt buộc)", () => {
    expect(run({})).toEqual({ ok: true, attachments: [] });
  });

  it("nhận tệp hợp lệ, cắt khoảng trắng thừa của tên", () => {
    const res = run({ raw: [{ name: " Bien ban.pdf ", path: fresh("uA"), size: 123 }] });
    expect(res).toEqual({ ok: true, attachments: [{ name: "Bien ban.pdf", path: fresh("uA"), size: 123 }] });
  });

  it("bắt buộc mà thiếu tệp → lỗi (gọi thẳng API cũng bị chặn)", () => {
    expect(run({ decision: "rejected", raw: [] }).ok).toBe(false);
    expect(run({ decision: "rejected" }).ok).toBe(false);
  });

  it("ô đang tắt → bỏ hết tệp, không lỗi (không lưu)", () => {
    const res = run({ decision: "forward_then_approve", raw: [{ name: "a.pdf", path: fresh("uB"), size: 1 }] });
    expect(res).toEqual({ ok: true, attachments: [] });
  });

  it("Trả lại luôn nhận tệp, kể cả nhóm cũ", () => {
    const res = run({ decision: "returned", group: null, raw: [{ name: "a.pdf", path: fresh("uA", "a.pdf"), size: 1 }] });
    expect(res.ok && res.attachments).toHaveLength(1);
  });

  it("path của người khác / tệp đã có trong đề xuất / trùng nhau → lỗi", () => {
    expect(run({ raw: [{ name: "a.pdf", path: fresh("uB"), size: 1 }] }).ok).toBe(false);
    expect(run({ raw: [{ name: "a.pdf", path: fresh("uA"), size: 1 }], existingPaths: [fresh("uA")] }).ok).toBe(false);
    expect(
      run({
        raw: [
          { name: "a.pdf", path: fresh("uA"), size: 1 },
          { name: "a.pdf", path: fresh("uA"), size: 1 },
        ],
      }).ok,
    ).toBe(false);
  });

  it("sai kiểu / quá số tệp → lỗi", () => {
    expect(run({ raw: "x" }).ok).toBe(false);
    expect(run({ raw: [{ name: 1, path: fresh("uA") }] }).ok).toBe(false);
    expect(run({ raw: [null] }).ok).toBe(false);
    const many = Array.from({ length: 7 }, (_, i) => ({ name: `f${i}.pdf`, path: fresh("uA", `f${i}.pdf`), size: 1 }));
    expect(run({ raw: many }).ok).toBe(false);
  });
});
