import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FUNCBAR_COLLAPSED_KEY, FUNCBAR_WIDTH_KEY } from "@/lib/funcbar-prefs";

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

vi.mock("next/navigation", () => ({
  usePathname: () => "/request/list",
  useSearchParams: () => new URLSearchParams("scope=all"),
}));
vi.mock("@/context/RequestContext", () => ({
  useRequestContext: () => ({
    categoryGroups: [],
    openCreateGroup: () => {},
    mobileNavOpen: false,
    setMobileNavOpen: () => {},
  }),
}));
vi.mock("@/lib/useCurrentSession", () => ({
  useCurrentSession: () => ({ session: { name: "Nguyễn Hữu Phước", role: "owner" }, isAdmin: false }),
}));

const { default: FuncBar } = await import("./FuncBar");

function wrapEl(container: HTMLElement) {
  return container.querySelector(".funcbar-wrap") as HTMLElement;
}
async function renderBar() {
  const r = render(<FuncBar />);
  await act(async () => {
    await new Promise((res) => setTimeout(res, 30));
  });
  return r;
}

describe("FuncBar — kéo rộng/hẹp và ẩn/hiện", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("mặc định: mở, rộng 200px", async () => {
    const { container } = await renderBar();
    expect(wrapEl(container).dataset.collapsed).toBe("false");
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("200px");
    expect(screen.getByRole("button", { name: "Ẩn thanh chức năng" })).toBeTruthy();
  });

  it("nhớ độ rộng và trạng thái ẩn đã lưu", async () => {
    localStorage.setItem(FUNCBAR_WIDTH_KEY, "300");
    localStorage.setItem(FUNCBAR_COLLAPSED_KEY, "1");
    const { container } = await renderBar();
    expect(wrapEl(container).dataset.collapsed).toBe("true");
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("300px");
    expect(screen.getByRole("button", { name: "Hiện thanh chức năng" })).toBeTruthy();
    // đang ẩn thì không có tay nắm kéo
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("bấm nút: ẩn rồi hiện lại, lưu lựa chọn", async () => {
    const { container } = await renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Ẩn thanh chức năng" }));
    expect(wrapEl(container).dataset.collapsed).toBe("true");
    expect(localStorage.getItem(FUNCBAR_COLLAPSED_KEY)).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Hiện thanh chức năng" }));
    expect(wrapEl(container).dataset.collapsed).toBe("false");
    expect(localStorage.getItem(FUNCBAR_COLLAPSED_KEY)).toBe("0");
  });

  it("kéo mép phải: đổi độ rộng, chặn trong 160-400, lưu khi thả", async () => {
    const { container } = await renderBar();
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { clientX: 280, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 380, pointerId: 1 });
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("300px");
    expect(screen.getByText("300 px")).toBeTruthy();
    fireEvent.pointerMove(handle, { clientX: 2000, pointerId: 1 });
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("400px");
    fireEvent.pointerUp(handle, { clientX: 2000, pointerId: 1 });
    expect(localStorage.getItem(FUNCBAR_WIDTH_KEY)).toBe("400");
    expect(screen.queryByText("400 px")).toBeNull();
    expect(document.body.style.cursor).toBe("");
  });

  it("thả chuột ngay sau lần rê cuối: lưu đúng vị trí lúc thả (không lưu số cũ)", async () => {
    const { container } = await renderBar();
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { clientX: 280, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 320, pointerId: 1 });
    // thả ở chỗ khác lần rê cuối — trước đây lưu 240 (số của lần vẽ trước)
    fireEvent.pointerUp(handle, { clientX: 357, pointerId: 1 });
    expect(localStorage.getItem(FUNCBAR_WIDTH_KEY)).toBe("277");
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("277px");
  });

  it("giữ chuột phải/giữa kéo: không đổi độ rộng", async () => {
    const { container } = await renderBar();
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { clientX: 280, pointerId: 1, button: 2 });
    fireEvent.pointerMove(handle, { clientX: 340, pointerId: 1, button: 2 });
    fireEvent.pointerUp(handle, { clientX: 340, pointerId: 1, button: 2 });
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("200px");
    expect(localStorage.getItem(FUNCBAR_WIDTH_KEY)).toBeNull();
    expect(document.body.style.cursor).toBe("");
  });

  it("bị huỷ giữa chừng / trình duyệt tự nhả tay nắm: giữ độ rộng đang hiện, không kẹt con trỏ", async () => {
    const { container } = await renderBar();
    const handle = screen.getByRole("separator");
    fireEvent.pointerDown(handle, { clientX: 280, pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 340, pointerId: 1, button: 0 });
    // toạ độ của sự kiện huỷ không đáng tin (ở đây 0) → vẫn lưu 260 đang hiện
    fireEvent.pointerCancel(handle, { clientX: 0, pointerId: 1 });
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("260px");
    expect(localStorage.getItem(FUNCBAR_WIDTH_KEY)).toBe("260");
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(screen.queryByText("260 px")).toBeNull();

    fireEvent.pointerDown(handle, { clientX: 300, pointerId: 2, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 330, pointerId: 2, button: 0 });
    fireEvent.lostPointerCapture(handle, { clientX: 0, pointerId: 2 });
    expect(localStorage.getItem(FUNCBAR_WIDTH_KEY)).toBe("290");
    expect(document.body.style.cursor).toBe("");
    // đã kết thúc kéo: rê chuột (không giữ nút) qua tay nắm không đổi độ rộng nữa
    fireEvent.pointerMove(handle, { clientX: 500, pointerId: 2 });
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("290px");
  });

  it("tay nắm báo đúng khoảng cho trình đọc màn hình", async () => {
    await renderBar();
    const handle = screen.getByRole("separator");
    expect(handle.getAttribute("aria-valuemin")).toBe("160");
    expect(handle.getAttribute("aria-valuemax")).toBe("400");
    expect(handle.getAttribute("aria-valuenow")).toBe("200");
  });

  it("thu nhỏ cửa sổ rồi mở to lại: quay về đúng độ rộng đã chọn", async () => {
    localStorage.setItem(FUNCBAR_WIDTH_KEY, "370");
    const { container } = await renderBar();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("200px");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("370px");
    expect(localStorage.getItem(FUNCBAR_WIDTH_KEY)).toBe("370");
  });

  it("báo độ rộng thật cho bảng nổi (--funcbar-live): 0 khi ẩn", async () => {
    localStorage.setItem(FUNCBAR_WIDTH_KEY, "260");
    await renderBar();
    expect(document.documentElement.style.getPropertyValue("--funcbar-live")).toBe("260px");
    fireEvent.click(screen.getByRole("button", { name: "Ẩn thanh chức năng" }));
    expect(document.documentElement.style.getPropertyValue("--funcbar-live")).toBe("0px");
  });

  it("nhấp đúp mép phải: trả về 200px", async () => {
    localStorage.setItem(FUNCBAR_WIDTH_KEY, "350");
    const { container } = await renderBar();
    fireEvent.doubleClick(screen.getByRole("separator"));
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("200px");
    expect(localStorage.getItem(FUNCBAR_WIDTH_KEY)).toBe("200");
  });

  it("phím ← → trên tay nắm: đổi 10px mỗi lần", async () => {
    const { container } = await renderBar();
    const handle = screen.getByRole("separator");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("220px");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(wrapEl(container).style.getPropertyValue("--funcbar-w")).toBe("210px");
  });
});
