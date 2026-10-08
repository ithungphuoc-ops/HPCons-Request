/**
 * Nội dung thông báo "ra màn hình" (Web Push — cấp 3, Sếp duyệt 08/10/2026).
 *
 * Hàm THUẦN, không đụng Firestore/mạng — test được (web-push-payload.test.ts).
 *
 * Quy tắc nội dung (quyết định số 4 của Sếp): thông báo hiện cả trên MÀN HÌNH KHOÁ điện
 * thoại / góc màn hình máy tính, người đứng cạnh đọc được → CHỈ ghi mã đề xuất + tên
 * nhóm (groupNameSnapshot — do Admin đặt) + tên người làm. TUYỆT ĐỐI KHÔNG đưa:
 *  - số tiền, nội dung bảng, giá trị trường;
 *  - trích bình luận, lý do từ chối/trả lại;
 *  - "tên đề xuất" người dùng tự gõ (resolveRequestTitle) — có thể chứa số tiền.
 * Vì vậy builder này KHÔNG nhận các trường đó làm đầu vào — không thể lỡ tay lọt ra.
 */

/** Loại sự kiện được đẩy (quyết định số 5) — trùng tên `kind` của meta chuông App Tổng. */
export type PushKind =
  | "pending_approval"
  | "adjustment_pending"
  | "mentioned"
  | "approved"
  | "rejected"
  | "returned"
  | "adjustment_approved"
  | "adjustment_rejected";

/** 3 nhóm mỗi người tự bật/tắt trong Cài đặt thông báo. */
export type PushCategory = "approval" | "mention" | "result";

export const PUSH_CATEGORIES: PushCategory[] = ["approval", "mention", "result"];

export const PUSH_CATEGORY_OF: Record<PushKind, PushCategory> = {
  pending_approval: "approval",
  adjustment_pending: "approval",
  mentioned: "mention",
  approved: "result",
  rejected: "result",
  returned: "result",
  adjustment_approved: "result",
  adjustment_rejected: "result",
};

export type PushPreferences = Record<PushCategory, boolean>;

/** Thiếu khoá = coi như BẬT (giống cài đặt chuông) — người đã bấm "Bật trên máy này"
 * thì mặc định nhận đủ 3 loại, tự tắt bớt nếu thấy phiền. */
export function normalizePushPreferences(stored: unknown): PushPreferences {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<Record<PushCategory, unknown>>;
  return {
    approval: s.approval !== false,
    mention: s.mention !== false,
    result: s.result !== false,
  };
}

export interface PushPayload {
  title: string;
  body: string;
  /** Đường dẫn TƯƠNG ĐỐI — service worker tự ghép với đúng tên miền của nó. */
  url: string;
  /** Cùng 1 đề xuất dùng chung tag → thông báo mới THAY thông báo cũ, không chồng 5 cái. */
  tag: string;
  kind: PushKind | "test";
}

export interface PushPayloadInput {
  kind: PushKind;
  requestId: string;
  code?: string | null;
  /** Tên NHÓM đề xuất (groupNameSnapshot) — KHÔNG phải tên đề xuất người dùng gõ. */
  groupName?: string | null;
  actorName?: string | null;
  /** Lượt duyệt tới tay người nhận là do người khác "chuyển tiếp". */
  forwarded?: boolean;
}

const NAME_MAX = 60;
const GROUP_MAX = 80;

function clip(text: string | null | undefined, max: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** "Tên · nhóm" — bỏ phần rỗng để không ra " · " lơ lửng. */
function joinDot(...parts: string[]): string {
  return parts.filter(Boolean).join(" · ");
}

export function requestPushUrl(requestId: string): string {
  return `/request/requests/${encodeURIComponent(requestId)}`;
}

export function buildPushPayload(input: PushPayloadInput): PushPayload {
  const code = clip(input.code, 30);
  const group = clip(input.groupName, GROUP_MAX);
  const actor = clip(input.actorName, NAME_MAX);
  // Đề xuất chưa có mã (hiếm — nháp cũ) thì nói chung chung, KHÔNG dùng id Firestore.
  const ref = code ? `Đề xuất ${code}` : "Một đề xuất";
  const refLower = code ? `đề xuất ${code}` : "một đề xuất";
  const base = { url: requestPushUrl(input.requestId), tag: `req-${input.requestId}`, kind: input.kind };

  switch (input.kind) {
    case "pending_approval":
      return {
        ...base,
        title: `${ref} chờ bạn duyệt`,
        body: joinDot(actor ? `${actor} ${input.forwarded ? "chuyển tiếp" : "gửi"}` : "", group) || "Mở app để xem chi tiết",
      };
    case "adjustment_pending":
      return {
        ...base,
        title: `Điều chỉnh ${refLower} chờ bạn duyệt`,
        body: joinDot(actor ? `${actor} đề nghị điều chỉnh` : "", group) || "Mở app để xem chi tiết",
      };
    case "mentioned":
      return {
        ...base,
        title: actor ? `${actor} nhắc bạn trong ${refLower}` : `Bạn được nhắc tên trong ${refLower}`,
        body: group || "Mở app để xem bình luận",
      };
    case "approved":
      return {
        ...base,
        title: `${ref} của bạn đã được chấp thuận`,
        body: joinDot(actor ? `${actor} chấp thuận` : "", group) || "Mở app để xem chi tiết",
      };
    case "rejected":
      return {
        ...base,
        title: `${ref} của bạn đã bị từ chối`,
        body: joinDot(actor ? `${actor} từ chối` : "", group) || "Mở app để xem lý do",
      };
    case "returned":
      return {
        ...base,
        title: `${ref} của bạn đã bị trả lại`,
        body: joinDot(actor ? `${actor} trả lại` : "", group) || "Mở app để xem lý do",
      };
    case "adjustment_approved":
      return {
        ...base,
        title: `Điều chỉnh ${refLower} của bạn đã được chấp thuận`,
        body: group || "Mở app để xem chi tiết",
      };
    case "adjustment_rejected":
      return {
        ...base,
        title: `Điều chỉnh ${refLower} của bạn đã bị từ chối`,
        body: joinDot(actor ? `${actor} từ chối` : "", group) || "Mở app để xem chi tiết",
      };
  }
}

export function buildTestPushPayload(): PushPayload {
  return {
    title: "Thông báo thử — HPCore Đề xuất",
    body: "Máy này đã nhận được thông báo ra màn hình.",
    url: "/request/settings/notifications",
    tag: "push-test",
    kind: "test",
  };
}
