// @vitest-environment node
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { b64urlDecode, b64urlEncode, encryptPushPayload, generateVapidKeys, vapidAuthorization } = await import("./web-push-crypto");

/** Giải mã y như TRÌNH DUYỆT làm (RFC 8291 phía nhận) — chứng minh thư mã hoá đúng chuẩn. */
function decryptAsBrowser(body: Buffer, uaEcdh: ReturnType<typeof createECDH>, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  expect(rs).toBe(4096);
  const ecdhSecret = uaEcdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaEcdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  expect(plain[plain.length - 1]).toBe(2); // dấu "bản ghi cuối"
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

describe("encryptPushPayload (aes128gcm)", () => {
  it("trình duyệt giải mã ra đúng nội dung (có dấu tiếng Việt)", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const text = JSON.stringify({ title: "Đề xuất 000123 chờ bạn duyệt", body: "Nguyễn Văn A gửi" });
    const body = encryptPushPayload(Buffer.from(text), { p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(auth) });
    expect(decryptAsBrowser(body, ua, auth)).toBe(text);
  });

  it("khoá trình duyệt sai định dạng → ném lỗi (nơi gọi bắt và chỉ log)", () => {
    expect(() => encryptPushPayload(Buffer.from("x"), { p256dh: "abc", auth: "def" })).toThrow();
  });
});

describe("vapidAuthorization (JWT ES256)", () => {
  it("chữ ký kiểm được bằng khoá công khai, aud = gốc endpoint", () => {
    const keys = generateVapidKeys();
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", { ...keys, subject: "mailto:a@b.c" }, 1_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, c, sig, k] = m!;
    expect(k).toBe(keys.publicKey);
    const claims = JSON.parse(b64urlDecode(c).toString());
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_000_000 + 12 * 3600, sub: "mailto:a@b.c" });
    const pub = b64urlDecode(keys.publicKey);
    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33)) },
      format: "jwk",
    });
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, b64urlDecode(sig))).toBe(true);
  });
});
