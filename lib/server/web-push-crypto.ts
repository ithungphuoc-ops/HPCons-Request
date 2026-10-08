import "server-only";
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";

/**
 * Mã hoá + ký Web Push theo chuẩn — tự viết bằng `node:crypto` thay vì thêm thư viện
 * `web-push`: chỉ ~100 dòng, chuẩn đã cố định nhiều năm, đỡ 1 phụ thuộc (và đỡ phải cài
 * vào node_modules dùng chung). Có test giải mã ngược (web-push-crypto.test.ts) để chắc
 * trình duyệt giải được.
 *
 *  - RFC 8291 (Message Encryption for Web Push) + RFC 8188 (`aes128gcm`): nội dung được
 *    mã hoá bằng khoá của TRÌNH DUYỆT — dịch vụ đẩy (Google/Mozilla/Apple/Microsoft) chuyển
 *    giúp nhưng không đọc được.
 *  - RFC 8292 (VAPID): ký JWT ES256 bằng khoá riêng của app để dịch vụ đẩy biết thư đến
 *    từ đúng máy chủ đã đăng ký với trình duyệt.
 */

export interface PushSubscriptionKeys {
  /** Khoá công khai P-256 của trình duyệt (65 byte, base64url). */
  p256dh: string;
  /** Bí mật xác thực 16 byte (base64url). */
  auth: string;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function b64urlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(text: string): Buffer {
  const s = text.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s + "=".repeat((4 - (s.length % 4)) % 4), "base64");
}

/** Bản ghi duy nhất — nội dung luôn < 4KB nên 4096 là đủ (Chrome/Firefox cùng mặc định). */
const RECORD_SIZE = 4096;

export function encryptPushPayload(
  plaintext: Buffer,
  keys: PushSubscriptionKeys,
  // Cho test truyền cố định; thực tế luôn ngẫu nhiên mỗi thư.
  opts: { salt?: Buffer; serverEcdh?: ReturnType<typeof createECDH> } = {},
): Buffer {
  const uaPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("Khoá đăng ký thông báo không hợp lệ");

  const server = opts.serverEcdh ?? createECDH("prime256v1");
  if (!opts.serverEcdh) server.generateKeys();
  const asPublic = server.getPublicKey();
  const ecdhSecret = server.computeSecret(uaPublic);
  const salt = opts.salt ?? randomBytes(16);

  // RFC 8291 §3.4: IKM = HKDF(auth, ecdh, "WebPush: info\0" || ua_public || as_public, 32)
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  // RFC 8188 §2.2/2.3: CEK 16 byte, NONCE 12 byte (bản ghi duy nhất → SEQ = 0).
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  // Dấu phân cách 0x02 = "bản ghi cuối", không đệm thêm.
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** JWT VAPID — hạn 12 giờ (chuẩn cho tối đa 24 giờ). `aud` = gốc (origin) của endpoint. */
export function vapidAuthorization(endpoint: string, vapid: VapidConfig, nowSec = Math.floor(Date.now() / 1000)): string {
  const pub = b64urlDecode(vapid.publicKey);
  const priv = padTo32(b64urlDecode(vapid.privateKey));
  if (pub.length !== 65 || priv.length !== 32) throw new Error("Khoá VAPID không hợp lệ");
  const key = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: b64urlEncode(priv), x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: vapid.subject })),
  );
  const unsigned = `${header}.${claims}`;
  // JOSE cần chữ ký dạng r||s 64 byte, không phải DER.
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64urlEncode(signature)}, k=${vapid.publicKey}`;
}

/** Khoá riêng có thể bị cắt mất byte 0 ở đầu (vài công cụ tạo khoá) — đệm lại đủ 32 byte. */
function padTo32(buf: Buffer): Buffer {
  return buf.length >= 32 ? buf : Buffer.concat([Buffer.alloc(32 - buf.length), buf]);
}

/** Tạo cặp khoá VAPID mới (dùng cho script tạo khoá). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64urlEncode(ecdh.getPublicKey()), privateKey: b64urlEncode(padTo32(ecdh.getPrivateKey())) };
}
