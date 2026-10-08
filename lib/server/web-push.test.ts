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
  return { store, fakeDb: { collection: (name: string) => colRef(name) } };
});

vi.mock("@/lib/firebase/admin", () => ({ adminDb: fakeDb }));

const {
  endpointId,
  getWebPushConfig,
  isAllowedPushEndpoint,
  parseSubscriptionInput,
  saveSubscription,
  sendTestPush,
  sendWebPushItems,
} = await import("./web-push");
const { generateVapidKeys, b64urlEncode } = await import("./web-push-crypto");
const { buildPushPayload, buildTestPushPayload } = await import("@/lib/web-push-payload");
import { createECDH, randomBytes } from "node:crypto";

const vapid = generateVapidKeys();

function browserKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: b64urlEncode(ecdh.getPublicKey()), auth: b64urlEncode(randomBytes(16)) };
}

function addDevice(uid: string, endpoint: string) {
  store.set(`push-subscriptions/${uid}/devices/${endpointId(endpoint)}`, {
    endpoint,
    keys: browserKeys(),
    lastUsedAt: new Date().toISOString(),
  });
}

const payload = (kind: Parameters<typeof buildPushPayload>[0]["kind"]) =>
  buildPushPayload({ kind, requestId: "r1", code: "000123", groupName: "1.0. Phiếu đề nghị (HPCons)", actorName: "Nguyễn Văn A" });

const fetchMock = vi.fn();

beforeEach(() => {
  store.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("WEB_PUSH_VAPID_PUBLIC_KEY", vapid.publicKey);
  vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", vapid.privateKey);
  vi.stubEnv("WEB_PUSH_SUBJECT", "mailto:test@hpcons.example");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FCM = (n: string) => `https://fcm.googleapis.com/fcm/send/${n}`;

describe("tắt hoàn toàn khi thiếu biến môi trường", () => {
  it("thiếu 1 trong 3 biến → config null, không đọc Firestore, không gọi mạng", async () => {
    vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", "");
    expect(getWebPushConfig()).toBeNull();
    addDevice("uA", FCM("a"));
    await sendWebPushItems([{ uid: "uA", payload: payload("pending_approval") }]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await sendTestPush("uA", FCM("a"), buildTestPushPayload())).toBe("disabled");
  });
});

describe("lọc người nhận", () => {
  it("gửi cho người có máy đã đăng ký; người chưa bật thì bỏ qua", async () => {
    addDevice("uA", FCM("a"));
    await sendWebPushItems([
      { uid: "uA", payload: payload("pending_approval") },
      { uid: "uB", payload: payload("pending_approval") },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(FCM("a"));
    expect(init.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(init.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(init.headers.Urgency).toBe("high");
  });

  it("KHÔNG gửi cho chính người vừa thao tác", async () => {
    addDevice("actor", FCM("x"));
    addDevice("uA", FCM("a"));
    await sendWebPushItems(
      [
        { uid: "actor", payload: payload("mentioned") },
        { uid: "uA", payload: payload("mentioned") },
      ],
      { actorUid: "actor" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(FCM("a"));
  });

  it("tôn trọng công tắc từng loại", async () => {
    addDevice("uA", FCM("a"));
    store.set("push-subscriptions/uA", { prefs: { approval: false, mention: true, result: true } });
    await sendWebPushItems([{ uid: "uA", payload: payload("pending_approval") }]);
    await sendWebPushItems([{ uid: "uA", payload: payload("adjustment_pending") }]);
    expect(fetchMock).not.toHaveBeenCalled();
    await sendWebPushItems([{ uid: "uA", payload: payload("mentioned") }]);
    await sendWebPushItems([{ uid: "uA", payload: payload("returned") }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("1 người lặp 2 lần trong 1 sự kiện → chỉ 1 thư mỗi máy", async () => {
    addDevice("uA", FCM("a1"));
    addDevice("uA", FCM("a2"));
    await sendWebPushItems([
      { uid: "uA", payload: payload("pending_approval") },
      { uid: "uA", payload: payload("pending_approval") },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Set(fetchMock.mock.calls.map((c) => c[0]))).toEqual(new Set([FCM("a1"), FCM("a2")]));
  });
});

describe("dọn đăng ký chết", () => {
  it("410 Gone → xoá máy đó + chỉ mục; máy khác vẫn còn", async () => {
    addDevice("uA", FCM("dead"));
    addDevice("uA", FCM("live"));
    store.set(`push-endpoints/${endpointId(FCM("dead"))}`, { uid: "uA" });
    fetchMock.mockImplementation(async (url: string) => new Response(null, { status: url === FCM("dead") ? 410 : 201 }));
    await sendWebPushItems([{ uid: "uA", payload: payload("approved") }]);
    expect(store.has(`push-subscriptions/uA/devices/${endpointId(FCM("dead"))}`)).toBe(false);
    expect(store.has(`push-endpoints/${endpointId(FCM("dead"))}`)).toBe(false);
    expect(store.has(`push-subscriptions/uA/devices/${endpointId(FCM("live"))}`)).toBe(true);
  });

  it("lỗi khác (500 / mất mạng) chỉ log, không xoá, không ném lỗi", async () => {
    addDevice("uA", FCM("a"));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(sendWebPushItems([{ uid: "uA", payload: payload("approved") }])).resolves.toBeUndefined();
    fetchMock.mockRejectedValueOnce(new Error("network"));
    await expect(sendWebPushItems([{ uid: "uA", payload: payload("approved") }])).resolves.toBeUndefined();
    expect(store.has(`push-subscriptions/uA/devices/${endpointId(FCM("a"))}`)).toBe(true);
  });
});

describe("đăng ký", () => {
  it("chỉ chấp nhận endpoint của dịch vụ đẩy thật (chặn SSRF)", () => {
    expect(isAllowedPushEndpoint(FCM("a"))).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedPushEndpoint("https://evilfcm.googleapis.com.attacker.io/x")).toBe(false);
    expect(parseSubscriptionInput({ endpoint: FCM("a"), keys: { p256dh: "a b", auth: "x" } })).toBeNull();
  });

  it("1 trình duyệt chỉ thuộc 1 người: người mới bật → gỡ khỏi người cũ", async () => {
    const keys = browserKeys();
    await saveSubscription("uOld", { endpoint: FCM("shared"), keys }, "UA");
    await saveSubscription("uNew", { endpoint: FCM("shared"), keys }, "UA");
    const id = endpointId(FCM("shared"));
    expect(store.has(`push-subscriptions/uOld/devices/${id}`)).toBe(false);
    expect(store.has(`push-subscriptions/uNew/devices/${id}`)).toBe(true);
    expect(store.get(`push-endpoints/${id}`)?.uid).toBe("uNew");
  });

  it("Gửi thử chỉ tới máy của đúng người đang đăng nhập", async () => {
    addDevice("uA", FCM("a"));
    expect(await sendTestPush("uB", FCM("a"), buildTestPushPayload())).toBe("not_found");
    expect(await sendTestPush("uA", FCM("a"), buildTestPushPayload())).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
