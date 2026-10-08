import "server-only";
import { createHash } from "node:crypto";
import { CURRENT_APP_HOST } from "@/lib/constants";
import { PUSH_CATEGORY_OF, type PushCategory, type PushKind, type PushPayload } from "@/lib/web-push-payload";

/**
 * Thông báo "ra màn hình" gửi QUA App Tổng (Sếp duyệt 08/10/2026 — gộp về 1 chỗ cài đặt
 * account.hpcore.vn/dashboard/thong-bao?caidat=man-hinh cho mọi app).
 *
 * App này vẫn tự quyết: AI nhận (bỏ người vừa thao tác), LOẠI gì (category) và NỘI DUNG gì
 * (lib/web-push-payload.ts — giữ nguyên câu chữ PR #96). App Tổng lo phần còn lại: công tắc
 * từng người (apps.de_xuat, kinds.de_xuat[category]), luật `onlyIfDisabled`, danh sách máy
 * đã bật và việc gửi thật tới dịch vụ đẩy của trình duyệt.
 *
 * Hợp đồng: POST {NOTIFY_PUSH_DISPATCH_URL} — Authorization: Bearer ${NOTIFY_INGEST_KEY}
 *   { appId: "de_xuat", eventId, items: [{ uid, category, onlyIfDisabled?, push: {title, body, actionTitle?, url, tag?} }] }
 * Trả { ok: true, queued } hoặc { ok: true, duplicate: true } (eventId đã nhận rồi).
 *
 * TẮT HOÀN TOÀN khi thiếu khoá (hoặc khoá < 24 ký tự): không gọi mạng, cảnh báo 1 lần.
 * Bắn rồi quên — mọi lỗi chỉ log, KHÔNG ném ra ngoài (chạy trong after()).
 */

export const DEFAULT_PUSH_DISPATCH_URL = "https://account.hpcore.vn/api/push/dispatch";
export const PUSH_APP_ID = "de_xuat";
const MIN_KEY_LENGTH = 24;
export const DISPATCH_TIMEOUT_MS = 8_000;
export const DISPATCH_RETRY_DELAY_MS = 1_500;
export const MAX_ITEMS_PER_REQUEST = 200;
/** App Tổng từ chối thân > 16KB (413) — chừa biên, mỗi lần gửi ≤ 14.000 byte UTF-8. */
export const MAX_BODY_BYTES = 14_000;
const EVENT_ID_MAX = 200;
/** Chừa chỗ cho hậu tố chia lô ":c12". */
const EVENT_ID_BASE_MAX = EVENT_ID_MAX - 8;

const LIMITS = { title: 120, body: 240, actionTitle: 30, tag: 80 } as const;

/** 1 thư định đẩy cho 1 người — dựng ở lib/server/hpcore-notifications.ts. */
export interface PushItem {
  uid: string;
  payload: PushPayload;
  /** Chỉ gửi nếu người nhận ĐANG TẮT nhóm này — "bình luận mới" khi người gửi đề xuất cũng
   * bị nhắc tên (nhắc tên thắng). App Tổng xét theo công tắc thật của người đó. */
  onlyIfDisabled?: PushCategory;
}

export interface DispatchItem {
  uid: string;
  category: PushCategory;
  onlyIfDisabled?: PushCategory;
  push: { title: string; body: string; actionTitle?: string; url: string; tag?: string };
}

export interface DispatchBody {
  appId: typeof PUSH_APP_ID;
  eventId: string;
  items: DispatchItem[];
}

export interface DispatchConfig {
  url: string;
  key: string;
}

let warnedMissingKey = false;

export function getPushDispatchConfig(): DispatchConfig | null {
  const key = process.env.NOTIFY_INGEST_KEY?.trim() ?? "";
  if (key.length < MIN_KEY_LENGTH) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      // KHÔNG in khoá ra log — chỉ báo thiếu/không hợp lệ.
      console.warn("NOTIFY_INGEST_KEY chưa đặt (hoặc ngắn hơn 24 ký tự) — tạm TẮT thông báo ra màn hình qua App Tổng.");
    }
    return null;
  }
  const url = process.env.NOTIFY_PUSH_DISPATCH_URL?.trim() || DEFAULT_PUSH_DISPATCH_URL;
  return { url, key };
}

/** Chỉ dùng trong test: cho phép cảnh báo "thiếu khoá" hiện lại. */
export function resetDispatchWarningsForTest(): void {
  warnedMissingKey = false;
}

/** Cắt cho vừa giới hạn độ dài của App Tổng (đơn vị UTF-16 như `string.length`), không vỡ
 * emoji, GIỮ xuống dòng (thân 2 dòng). Nội dung bình thường ngắn hơn nhiều → không đổi gì. */
export function fitLength(text: string, max: number): string {
  if (text.length <= max) return text;
  const out: string[] = [];
  let len = 0;
  for (const cp of Array.from(text)) {
    if (len + cp.length > max - 1) break;
    out.push(cp);
    len += cp.length;
  }
  return `${out.join("").trimEnd()}…`;
}

/** Đường dẫn tương đối của thư → link đầy đủ tới app này (App Tổng gửi từ tên miền của nó). */
export function absoluteRequestUrl(path: string): string {
  if (/^https:\/\//i.test(path)) return path;
  return `https://${CURRENT_APP_HOST}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Dựng danh sách gửi App Tổng — y luật cũ của bộ gửi tại chỗ:
 *  - không bao giờ gửi cho chính người vừa thao tác (`actorUid`);
 *  - 1 người xuất hiện 2 lần trong 1 sự kiện → giữ thư đầu tiên;
 *  - thư "test" không đi đường này (không có loại tương ứng).
 */
export function buildDispatchItems(items: PushItem[], actorUid?: string): DispatchItem[] {
  const seen = new Set<string>();
  const out: DispatchItem[] = [];
  for (const item of items) {
    if (!item.uid || item.uid === actorUid || seen.has(item.uid)) continue;
    const { payload } = item;
    if (payload.kind === "test") continue;
    seen.add(item.uid);
    const category = PUSH_CATEGORY_OF[payload.kind as PushKind];
    out.push({
      uid: item.uid,
      category,
      ...(item.onlyIfDisabled ? { onlyIfDisabled: item.onlyIfDisabled } : {}),
      push: {
        title: fitLength(payload.title, LIMITS.title),
        body: fitLength(payload.body, LIMITS.body),
        ...(payload.actionTitle ? { actionTitle: fitLength(payload.actionTitle, LIMITS.actionTitle) } : {}),
        url: absoluteRequestUrl(payload.url),
        ...(payload.tag ? { tag: fitLength(payload.tag, LIMITS.tag) } : {}),
      },
    });
  }
  return out;
}

/**
 * Mã sự kiện CỐ ĐỊNH theo sự kiện: cùng 1 sự kiện gọi lại (thử lại, after() chạy 2 lần) → cùng
 * mã → App Tổng trả `duplicate` thay vì đẩy 2 lần. `eventKey` = loại + mã đề xuất + mốc (id bình
 * luận / thời điểm dòng nhật ký); ghép thêm dấu vân tay nội dung để 2 sự kiện khác nhau không
 * bao giờ trùng mã.
 */
export function buildEventId(eventKey: string, items: DispatchItem[]): string {
  const fingerprint = createHash("sha256")
    .update(eventKey)
    .update("\n")
    .update(JSON.stringify(items))
    .digest("hex")
    .slice(0, 24);
  // Chỉ giữ ký tự an toàn (App Tổng có thể dùng làm mã tài liệu Firestore — cấm "/").
  const readable = eventKey.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, EVENT_ID_BASE_MAX - fingerprint.length - 1);
  return `${readable}:${fingerprint}`;
}

function bodyBytes(body: DispatchBody): number {
  return Buffer.byteLength(JSON.stringify(body), "utf8");
}

/**
 * Chia lô: mỗi lần gửi ≤ 200 người VÀ thân JSON ≤ 14.000 byte (UTF-8). Giữ nguyên thứ tự người
 * nhận → cùng dữ liệu luôn ra cùng các lô (thử lại gửi y hệt). 1 lô thì giữ nguyên mã sự kiện;
 * nhiều lô thì thêm hậu tố :c0, :c1... (tính kích thước theo hậu tố dài nhất có thể).
 */
export function chunkDispatch(eventId: string, items: DispatchItem[]): DispatchBody[] {
  const whole: DispatchBody = { appId: PUSH_APP_ID, eventId, items };
  if (items.length <= MAX_ITEMS_PER_REQUEST && bodyBytes(whole) <= MAX_BODY_BYTES) return [whole];
  // Đo với hậu tố dài nhất có thể (":c" + số lô ≤ số người) để lô nào cũng chắc chắn vừa.
  const probeId = `${eventId}:c${items.length}`;
  // JSON của mảng = "[" + các phần tử nối bằng "," + "]" → cộng dồn chính xác, khỏi stringify lại cả lô.
  const emptyBytes = bodyBytes({ appId: PUSH_APP_ID, eventId: probeId, items: [] });
  const groups: DispatchItem[][] = [];
  let current: DispatchItem[] = [];
  let currentBytes = emptyBytes;
  for (const item of items) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
    const nextBytes = currentBytes + itemBytes + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && (current.length + 1 > MAX_ITEMS_PER_REQUEST || nextBytes > MAX_BODY_BYTES)) {
      groups.push(current);
      current = [item];
      currentBytes = emptyBytes + itemBytes;
    } else {
      // 1 người một mình vẫn quá lớn là bất thường (nội dung đã cắt theo giới hạn) — vẫn gửi riêng.
      current.push(item);
      currentBytes = nextBytes;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups.map((group, i) => ({ appId: PUSH_APP_ID, eventId: `${eventId}:c${i}`, items: group }));
}

export interface DispatchDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type AttemptResult = { ok: true } | { ok: false; retry: boolean; reason: string };

async function attempt(body: DispatchBody, config: DispatchConfig, doFetch: typeof fetch): Promise<AttemptResult> {
  try {
    const res = await doFetch(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => {});
    if (res.ok) return { ok: true };
    if (res.status === 413) {
      // Lỗi lập trình (chia lô sai) — không thử lại, ghi rõ để sửa.
      console.error(`LỖI: App Tổng từ chối thân quá lớn (413, ${Buffer.byteLength(JSON.stringify(body), "utf8")} byte, sự kiện ${body.eventId}) — kiểm tra chunkDispatch.`);
    }
    const retry = res.status >= 500 || res.status === 429;
    return { ok: false, retry, reason: `HTTP ${res.status}` };
  } catch (error) {
    // Mất mạng / quá 8 giây → thử lại 1 lần.
    return { ok: false, retry: true, reason: error instanceof Error ? error.name || error.message : "lỗi mạng" };
  }
}

/** Gửi 1 lô: lỗi mạng / 5xx / 429 → đợi ~1,5 giây thử lại ĐÚNG 1 lần, CÙNG eventId; 4xx khác thì thôi. */
export async function postDispatch(body: DispatchBody, config: DispatchConfig, deps: DispatchDeps = {}): Promise<boolean> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  let result = await attempt(body, config, doFetch);
  if (!result.ok && result.retry) {
    await sleep(DISPATCH_RETRY_DELAY_MS);
    result = await attempt(body, config, doFetch);
  }
  if (!result.ok) {
    console.error(`Gửi thông báo ra màn hình qua App Tổng thất bại (${result.reason}, sự kiện ${body.eventId}) — bỏ qua.`);
    return false;
  }
  return true;
}

/**
 * Gửi thông báo ra màn hình của 1 SỰ KIỆN qua App Tổng. Gọi trong `after()` (qua
 * lib/server/hpcore-notifications.ts) nên không làm chậm thao tác chính.
 */
export async function dispatchPushItems(
  items: PushItem[],
  opts: { actorUid?: string; eventKey: string },
  deps: DispatchDeps = {},
): Promise<void> {
  try {
    const dispatchItems = buildDispatchItems(items, opts.actorUid);
    if (dispatchItems.length === 0) return;
    const config = getPushDispatchConfig();
    if (!config) return;
    const eventId = buildEventId(opts.eventKey, dispatchItems);
    for (const body of chunkDispatch(eventId, dispatchItems)) {
      await postDispatch(body, config, deps);
    }
  } catch (error) {
    console.error("Gửi thông báo ra màn hình qua App Tổng lỗi (không ảnh hưởng thao tác chính):", error);
  }
}
