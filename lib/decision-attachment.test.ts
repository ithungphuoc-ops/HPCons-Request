import { describe, expect, it } from "vitest";
import {
  decisionAttachmentMode,
  decisionAttachmentRuleFor,
  describeDecisionAttachmentRule,
  isDecisionAttachment,
  resolveDecisionAttachmentRules,
} from "./decision-attachment";

describe("resolveDecisionAttachmentRules", () => {
  it("nhóm cũ (chưa có cài đặt) / không có nhóm → không hành động nào có ô", () => {
    const off = { enabled: false, required: false };
    expect(resolveDecisionAttachmentRules({})).toEqual({
      approve: off,
      reject: off,
      forward: off,
      approveAndForward: off,
    });
    expect(resolveDecisionAttachmentRules(null)).toEqual(resolveDecisionAttachmentRules({}));
  });

  it("bật Có + Bắt buộc theo từng hành động; tắt ô ⇒ không bắt buộc", () => {
    const rules = resolveDecisionAttachmentRules({
      decisionAttachmentEnabled: { approve: true, reject: true, forward: false },
      requireDecisionAttachment: { approve: false, reject: true, forward: true, approveAndForward: true },
    });
    expect(rules.approve).toEqual({ enabled: true, required: false });
    expect(rules.reject).toEqual({ enabled: true, required: true });
    expect(rules.forward).toEqual({ enabled: false, required: false });
    expect(rules.approveAndForward).toEqual({ enabled: false, required: false });
  });
});

describe("decisionAttachmentRuleFor", () => {
  it("Trả lại luôn có ô, không bắt buộc — kể cả nhóm cũ", () => {
    expect(decisionAttachmentRuleFor("returned", null)).toEqual({ enabled: true, required: false });
    expect(
      decisionAttachmentRuleFor("returned", {
        decisionAttachmentEnabled: { approve: true },
        requireDecisionAttachment: { approve: true },
      }),
    ).toEqual({ enabled: true, required: false });
  });

  it("quy đổi quyết định thật → hành động cài đặt", () => {
    const group = {
      decisionAttachmentEnabled: { approveAndForward: true, forward: true },
      requireDecisionAttachment: { approveAndForward: true },
    };
    expect(decisionAttachmentRuleFor("approve_and_forward", group)).toEqual({ enabled: true, required: true });
    expect(decisionAttachmentRuleFor("forward_then_approve", group)).toEqual({ enabled: true, required: false });
    expect(decisionAttachmentRuleFor("approved", group)).toEqual({ enabled: false, required: false });
  });
});

describe("tiện ích hiển thị", () => {
  it("mode + mô tả + nhận diện tệp quyết định", () => {
    expect(decisionAttachmentMode({ enabled: false, required: false })).toBe("hidden");
    expect(decisionAttachmentMode({ enabled: true, required: false })).toBe("optional");
    expect(decisionAttachmentMode({ enabled: true, required: true })).toBe("required");
    expect(describeDecisionAttachmentRule({ enabled: true, required: true })).toBe("Có đính kèm · bắt buộc");
    expect(isDecisionAttachment({ source: "decision" })).toBe(true);
    expect(isDecisionAttachment({})).toBe(false);
    expect(isDecisionAttachment(undefined)).toBe(false);
  });
});
