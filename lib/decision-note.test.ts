import { describe, expect, it } from "vitest";
import {
  decisionNoteMode,
  describeDecisionNoteFlags,
  resolveDecisionNoteRules,
  sanitizeDecisionNoteFlags,
  sanitizeDecisionNoteInput,
} from "./decision-note";

describe("resolveDecisionNoteRules", () => {
  it("nhóm cũ (chưa có cài đặt) — mọi hành động có ô, chỉ Từ chối bắt buộc", () => {
    expect(resolveDecisionNoteRules({})).toEqual({
      approve: { enabled: true, required: false },
      reject: { enabled: true, required: true },
      forward: { enabled: true, required: false },
      approveAndForward: { enabled: true, required: false },
    });
    expect(resolveDecisionNoteRules(null)).toEqual(resolveDecisionNoteRules({}));
  });

  it("giữ tick bắt buộc cũ: forward kéo theo approveAndForward khi chưa có cờ riêng", () => {
    const rules = resolveDecisionNoteRules({ requireDecisionNote: { approve: true, forward: true } });
    expect(rules.approve.required).toBe(true);
    expect(rules.forward.required).toBe(true);
    expect(rules.approveAndForward.required).toBe(true);
  });

  it("tắt ô ghi chú ⇒ không bắt buộc", () => {
    const rules = resolveDecisionNoteRules({
      requireDecisionNote: { approve: true, reject: true },
      decisionNoteEnabled: { approve: false, reject: false },
    });
    expect(rules.approve).toEqual({ enabled: false, required: false });
    expect(rules.reject).toEqual({ enabled: false, required: false });
    expect(rules.forward.enabled).toBe(true);
  });
});

describe("sanitizeDecisionNoteFlags", () => {
  it("chỉ giữ 4 key hợp lệ, ép boolean", () => {
    expect(sanitizeDecisionNoteFlags({ approve: "yes", reject: true, hack: true })).toEqual({
      approve: false,
      reject: true,
    });
  });
  it("không phải object → null", () => {
    expect(sanitizeDecisionNoteFlags("x")).toBeNull();
    expect(sanitizeDecisionNoteFlags([true])).toBeNull();
    expect(sanitizeDecisionNoteFlags(null)).toBeNull();
  });
});

describe("describeDecisionNoteFlags", () => {
  it("ghi dễ đọc cho lịch sử nhóm", () => {
    expect(describeDecisionNoteFlags({ approve: true, reject: false })).toBe("Chấp thuận: Có, Từ chối: Không");
    expect(describeDecisionNoteFlags(undefined)).toBe("—");
  });
});

describe("decisionNoteMode", () => {
  it("ẩn / không bắt buộc / bắt buộc", () => {
    expect(decisionNoteMode({ enabled: false, required: false })).toBe("hidden");
    expect(decisionNoteMode({ enabled: true, required: false })).toBe("optional");
    expect(decisionNoteMode({ enabled: true, required: true })).toBe("required");
  });
});

describe("sanitizeDecisionNoteInput", () => {
  const off = { decisionNoteEnabled: { approve: false, reject: false, forward: false, approveAndForward: false } };
  it("note không phải chuỗi → lỗi (route trả 400)", () => {
    expect(sanitizeDecisionNoteInput("approved", 123, {}).ok).toBe(false);
    expect(sanitizeDecisionNoteInput("returned", { x: 1 }, {}).ok).toBe(false);
  });
  it("thiếu note → undefined, hợp lệ", () => {
    expect(sanitizeDecisionNoteInput("approved", undefined, {})).toEqual({ ok: true, note: undefined });
    expect(sanitizeDecisionNoteInput("approved", null, {})).toEqual({ ok: true, note: undefined });
  });
  it("ô đã tắt → bỏ note cho cả 4 hành động", () => {
    for (const d of ["approved", "rejected", "approve_and_forward", "forward_then_approve"] as const) {
      expect(sanitizeDecisionNoteInput(d, "Ghi chú lén", off)).toEqual({ ok: true, note: undefined });
    }
  });
  it("Trả lại luôn giữ lý do dù tắt mọi ô", () => {
    expect(sanitizeDecisionNoteInput("returned", "Bổ sung", off)).toEqual({ ok: true, note: "Bổ sung" });
  });
  it("ô đang bật → giữ nguyên note", () => {
    expect(sanitizeDecisionNoteInput("approved", "Ok", {})).toEqual({ ok: true, note: "Ok" });
  });
});
