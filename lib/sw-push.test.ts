// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/** Nạp public/sw-push.js vào 1 "self" giả rồi bấm thông báo — kiểm hành vi notificationclick. */
function loadSw(clientUrls: string[]) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const clients = clientUrls.map((url) => ({ url, focus: vi.fn().mockResolvedValue(undefined), navigate: vi.fn() }));
  const self = {
    location: { origin: "https://request.hpcore.vn" },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    skipWaiting: vi.fn(),
    clients: { matchAll: vi.fn().mockResolvedValue(clients), openWindow: vi.fn().mockResolvedValue(undefined), claim: vi.fn() },
    registration: { showNotification: vi.fn() },
  };
  vm.runInNewContext(readFileSync(path.resolve(__dirname, "../public/sw-push.js"), "utf8"), { self, URL });
  async function click(url: unknown) {
    let done: Promise<unknown> = Promise.resolve();
    listeners.notificationclick({ notification: { close: vi.fn(), data: { url } }, waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  }
  return { self, clients, click };
}

describe("sw-push.js notificationclick", () => {
  it("có tab đang mở ĐÚNG đề xuất → chỉ đưa lên trước, không mở thêm", async () => {
    const { self, clients, click } = loadSw(["https://request.hpcore.vn/request/list", "https://request.hpcore.vn/request/requests/r1"]);
    await click("/request/requests/r1");
    expect(clients[1].focus).toHaveBeenCalled();
    expect(clients[0].focus).not.toHaveBeenCalled();
    expect(clients.every((c) => c.navigate.mock.calls.length === 0)).toBe(true);
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it("tab khác của app (có thể đang gõ dở) KHÔNG bị chuyển trang → mở cửa sổ mới", async () => {
    const { self, clients, click } = loadSw(["https://request.hpcore.vn/request/requests/new"]);
    await click("/request/requests/r9");
    expect(clients[0].navigate).not.toHaveBeenCalled();
    expect(self.clients.openWindow).toHaveBeenCalledWith("https://request.hpcore.vn/request/requests/r9");
  });

  it("đưa tab lên lỗi → mở mới đúng 1 lần", async () => {
    const { self, clients, click } = loadSw(["https://request.hpcore.vn/request/requests/r1"]);
    clients[0].focus.mockRejectedValueOnce(new Error("blocked"));
    await click("/request/requests/r1");
    expect(self.clients.openWindow).toHaveBeenCalledTimes(1);
  });

  it("đường dẫn khác tên miền / hỏng → về /request", async () => {
    const { self, click } = loadSw([]);
    await click("https://evil.example/phish");
    await click(undefined);
    expect(self.clients.openWindow.mock.calls.map((c) => c[0])).toEqual([
      "https://request.hpcore.vn/request",
      "https://request.hpcore.vn/request",
    ]);
  });
});
