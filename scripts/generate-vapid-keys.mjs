// Tạo cặp khoá VAPID cho thông báo ra màn hình (Web Push, 08/10/2026).
// Chạy:  node scripts/generate-vapid-keys.mjs
// Rồi dán 3 dòng in ra vào biến môi trường Vercel (Production) — KHÔNG commit khoá vào git.
// Tương đương `npx web-push generate-vapid-keys` (cùng định dạng base64url).
// LƯU Ý: đổi khoá = mọi máy đã bật phải bấm "Bật trên máy này" lại (đăng ký cũ gắn với khoá cũ).
import { createECDH } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
let priv = ecdh.getPrivateKey();
if (priv.length < 32) priv = Buffer.concat([Buffer.alloc(32 - priv.length), priv]);

console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${b64url(ecdh.getPublicKey())}`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${b64url(priv)}`);
// Email liên hệ gửi kèm cho dịch vụ đẩy (Google/Apple…) khi cần báo sự cố — thay bằng email quản trị thật.
console.log("WEB_PUSH_SUBJECT=mailto:<email-quan-tri>@hpcons.com.vn");
