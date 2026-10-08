import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** Firestore giả trong bộ nhớ — đủ cho collection/doc/get/set/update/delete + subcollection. */
const { store, fakeDb } = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  function docRef(path: string): unknown {
    return {
      id: path.split("/").pop(),
      path,
      async get() {
        const data = store.get(path);
        return { exists: !!data, id: path.split("/").pop(), data: () => (data ? { ...data } : undefined) };
      },
      async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
        store.set(path, opts?.merge ? { ...(store.get(path) ?? {}), ...data } : { ...data });
      },
      async update(data: Record<string, unknown>) {
        if (!store.has(path)) throw new Error("not found");
        store.set(path, { ...store.get(path), ...data });
      },
      async delete() {
        store.delete(path);
      },
      collection: (name: string) => colRef(`${path}/${name}`),
    };
  }
  function colRef(path: string) {
    return {
      doc: (id: string) => docRef(`${path}/${id}`),
      async get() {
        const docs = [...store.entries()]
          .filter(([p]) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes("/"))
          .map(([p, data]) => ({ id: p.split("/").pop()!, data: () => ({ ...data }) }));
        return { empty: docs.length === 0, docs };
      },
    };
  }
  type Ref = { get: () => Promise<unknown>; set: (d: Record<string, unknown>) => Promise<void>; delete: () => Promise<void> };
  const fakeDb = {
    collection: (name: string) => colRef(name),
    // Transaction giả: đọc thẳng, gom ghi chạy cuối — đủ kiểm logic; tính nguyên tử do Firestore thật lo.
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const writes: (() => Promise<void>)[] = [];
      const tx = {
        get: (ref: Ref) => ref.get(),
        set: (ref: Ref, d: Record<string, unknown>) => void writes.push(() => ref.set(d)),
        delete: (ref: Ref) => void writes.push(() => ref.delete()),
      };
      const out = await fn(tx);
      for (const w of writes) await w();
      return out;
    },
  };
  return { store, fakeDb };
});

vi.mock("@/lib/firebase/admin", () => ({ adminDb: fakeDb }));

const { endpointId, isAllowedPushEndpoint, removeSubscription } = await import("./web-push");

/**
 * 08/10/2026: việc gửi đã chuyển sang App Tổng (push-dispatch.test.ts). Ở đây chỉ còn phần
 * DỌN đăng ký cũ — DELETE /api/push/subscription gọi removeSubscription.
 */

const FCM = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gỡ đăng ký cũ", () => {
  it("chỉ chấp nhận endpoint của dịch vụ đẩy thật", () => {
    expect(isAllowedPushEndpoint(FCM("a"))).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://evilfcm.googleapis.com.attacker.io/x")).toBe(false);
    expect(isAllowedPushEndpoint(42)).toBe(false);
  });

  it("xoá máy của đúng người + chỉ mục nếu chỉ mục thuộc người đó", async () => {
    const id = endpointId(FCM("a"));
    store.set(`push-subscriptions/uA/devices/${id}`, { endpoint: FCM("a") });
    store.set(`push-endpoints/${id}`, { uid: "uA" });
    await removeSubscription("uA", FCM("a"));
    expect(store.has(`push-subscriptions/uA/devices/${id}`)).toBe(false);
    expect(store.has(`push-endpoints/${id}`)).toBe(false);
  });

  it("chỉ mục thuộc người khác (máy dùng chung) → giữ chỉ mục, chỉ xoá bản ghi của mình", async () => {
    const id = endpointId(FCM("b"));
    store.set(`push-subscriptions/uA/devices/${id}`, { endpoint: FCM("b") });
    store.set(`push-endpoints/${id}`, { uid: "uB" });
    await removeSubscription("uA", FCM("b"));
    expect(store.has(`push-subscriptions/uA/devices/${id}`)).toBe(false);
    expect(store.get(`push-endpoints/${id}`)?.uid).toBe("uB");
  });
});
