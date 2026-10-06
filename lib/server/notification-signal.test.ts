import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { mockSet, mockDoc, mockCollection } = vi.hoisted(() => {
  const mockSet = vi.fn();
  const mockDoc = vi.fn(() => ({ set: mockSet }));
  const mockCollection = vi.fn(() => ({ doc: mockDoc }));
  return { mockSet, mockDoc, mockCollection };
});

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: { collection: mockCollection },
}));

import { bumpNotificationSignal } from "./notification-signal";

describe("bumpNotificationSignal", () => {
  beforeEach(() => {
    mockSet.mockReset().mockResolvedValue(undefined);
    mockCollection.mockClear();
    mockDoc.mockClear();
  });

  it("ghi đúng system/notification-signal", async () => {
    await bumpNotificationSignal();
    expect(mockCollection).toHaveBeenCalledWith("system");
    expect(mockDoc).toHaveBeenCalledWith("notification-signal");
  });

  it("CHỈ ghi 1 field `at` kiểu chuỗi ISO — không bao giờ kèm dữ liệu đề xuất", async () => {
    await bumpNotificationSignal();
    const payload = mockSet.mock.calls[0][0];
    expect(Object.keys(payload)).toEqual(["at"]);
    expect(typeof payload.at).toBe("string");
    expect(new Date(payload.at).toISOString()).toBe(payload.at);
  });

  it("lỗi ghi Firestore bị nuốt — không ném ra ngoài (gọi trong after(), không được làm hỏng response chính)", async () => {
    mockSet.mockRejectedValue(new Error("Firestore lỗi"));
    await expect(bumpNotificationSignal()).resolves.toBeUndefined();
  });
});
