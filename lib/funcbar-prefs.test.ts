import { afterEach, describe, expect, it } from "vitest";

// Node bản mới che mất localStorage của jsdom khi chạy test → dùng bộ nhớ tạm.
const store = new Map<string, string>();
const memoryStorage = {
  get length() { return store.size; },
  clear: () => store.clear(),
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  key: (i: number) => [...store.keys()][i] ?? null,
  removeItem: (k: string) => { store.delete(k); },
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
} as Storage;
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage });
Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage });
import {
  clampFuncbarWidth,
  FUNCBAR_COLLAPSED_KEY,
  FUNCBAR_PREPAINT_SCRIPT,
  FUNCBAR_WIDTH_KEY,
  parseStoredFuncbarWidth,
} from "./funcbar-prefs";

describe("clampFuncbarWidth", () => {
  it("giữ trong khoảng 160-400 trên màn rộng", () => {
    expect(clampFuncbarWidth(100, 1440)).toBe(160);
    expect(clampFuncbarWidth(250.4, 1440)).toBe(250);
    expect(clampFuncbarWidth(900, 1440)).toBe(400);
  });

  it("màn vừa: chừa tối thiểu 320px cho vùng nội dung", () => {
    // 1024 - 80 (thanh đen) - 320 = 624 → vẫn tối đa 400
    expect(clampFuncbarWidth(900, 1024)).toBe(400);
    // 700 - 80 - 320 = 300
    expect(clampFuncbarWidth(900, 700)).toBe(300);
  });

  it("màn quá hẹp: không nhỏ hơn mức tối thiểu 160", () => {
    expect(clampFuncbarWidth(900, 400)).toBe(160);
  });
});

describe("parseStoredFuncbarWidth", () => {
  it("đọc số hợp lệ, bỏ giá trị hỏng hoặc ngoài khoảng", () => {
    expect(parseStoredFuncbarWidth("240")).toBe(240);
    expect(parseStoredFuncbarWidth(null)).toBeNull();
    expect(parseStoredFuncbarWidth("abc")).toBeNull();
    expect(parseStoredFuncbarWidth("50")).toBeNull();
    expect(parseStoredFuncbarWidth("9999")).toBeNull();
  });
});

describe("FUNCBAR_PREPAINT_SCRIPT", () => {
  afterEach(() => {
    document.getElementById("funcbar-prepaint")?.remove();
    localStorage.clear();
  });
  const run = () => new Function(FUNCBAR_PREPAINT_SCRIPT)();
  const css = () => document.getElementById("funcbar-prepaint")?.textContent ?? null;

  it("chưa lưu gì: không chèn thẻ style", () => {
    run();
    expect(css()).toBeNull();
  });

  it("đã lưu độ rộng: đặt biến --funcbar-w", () => {
    localStorage.setItem(FUNCBAR_WIDTH_KEY, "280");
    run();
    expect(css()).toContain("--funcbar-w:280px");
    expect(css()).not.toContain("display:none");
  });

  it("đã lưu trạng thái ẩn: thu khung về 0 cho tới khi FuncBar gắn data-collapsed", () => {
    localStorage.setItem(FUNCBAR_COLLAPSED_KEY, "1");
    run();
    expect(css()).toContain(".funcbar-wrap:not([data-collapsed]){width:0}");
  });

  it("độ rộng lưu hỏng: bỏ qua, không làm lỗi trang", () => {
    localStorage.setItem(FUNCBAR_WIDTH_KEY, "99999");
    expect(run).not.toThrow();
    expect(css()).toBeNull();
  });
});
