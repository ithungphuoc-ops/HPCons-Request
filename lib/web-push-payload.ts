/**
 * Nội dung thông báo "ra màn hình" (Web Push — cấp 3).
 *
 * Hàm THUẦN, không đụng Firestore/mạng — test được (web-push-payload.test.ts).
 *
 * Quy tắc nội dung — Sếp duyệt demo "noi-dung-thong-bao-day-2026-10-08" (thay quy tắc "ngắn
 * gọn" cũ sau khi thử thật trên Windows thấy quá cụt, không biết việc gì):
 *  - Dòng đậm (title) = biểu tượng + chuyện gì xảy ra ("💬 X nhắc bạn trong bình luận").
 *  - Dòng 1 thân = trích bình luận / lý do / nội dung điều chỉnh / tên đề xuất.
 *  - Dòng 2 thân = "#mã · tên nhóm" (hoặc "tên đề xuất · #mã" như demo).
 *  - Trích dẫn ĐƯỢC PHÉP (kể cả có số tiền — Sếp chấp nhận), cắt ~90 ký tự, 1 dòng.
 *  - Tên NHÓM chỉ lấy groupNameSnapshot khi đề xuất thuộc nhóm; đề xuất trực tiếp lưu tên
 *    tự gõ trong groupNameSnapshot → nơi gọi truyền "Đề xuất trực tiếp" (pushGroupLabel).
 *  - KHÔNG báo tiến độ từng bước — chỉ kết quả cuối (duyệt xong / từ chối / trả lại).
 */

import { cleanOneLine, clipGraphemes } from "@/lib/text-clip";

/** Loại sự kiện được đẩy — trùng tên `kind` của meta chuông App Tổng. */
export type PushKind =
  | "pending_approval"
  | "adjustment_pending"
  | "mentioned"
  | "comment_on_mine"
  | "approved"
  | "rejected"
  | "returned"
  | "adjustment_approved"
  | "adjustment_rejected";

/** 4 nhóm mỗi người tự bật/tắt trong Cài đặt thông báo. */
export type PushCategory = "approval" | "mention" | "comment" | "result";

export const PUSH_CATEGORIES: PushCategory[] = ["approval", "mention", "comment", "result"];

export const PUSH_CATEGORY_OF: Record<PushKind, PushCategory> = {
  pending_approval: "approval",
  adjustment_pending: "approval",
  mentioned: "mention",
  comment_on_mine: "comment",
  approved: "result",
  rejected: "result",
  returned: "result",
  adjustment_approved: "result",
  adjustment_rejected: "result",
};

export type PushPreferences = Record<PushCategory, boolean>;

/** Thiếu khoá = coi như BẬT (giống cài đặt chuông) — kể cả loại "comment" thêm sau: người
 * đã bật từ trước tự nhận luôn, thấy phiền thì tắt. */
export function normalizePushPreferences(stored: unknown): PushPreferences {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<Record<PushCategory, unknown>>;
  return {
    approval: s.approval !== false,
    mention: s.mention !== false,
    comment: s.comment !== false,
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
  /** Chữ trên nút bấm của thông báo (Windows/Android hiện nút). */
  actionTitle: string;
}

export interface PushPayloadInput {
  kind: PushKind;
  requestId: string;
  code?: string | null;
  /** Tên NHÓM đã lọc qua pushGroupLabel (đề xuất trực tiếp → "Đề xuất trực tiếp"). */
  groupName?: string | null;
  /** Tên đề xuất như chuông hiện (resolveRequestTitle). */
  requestTitle?: string | null;
  /** Tên đề xuất có KHÁC tên nhóm không — giống nhau thì khỏi lặp 2 lần cùng 1 chữ. */
  hasCustomTitle?: boolean;
  actorName?: string | null;
  /** Lượt duyệt tới tay người nhận là do người khác "chuyển tiếp". */
  forwarded?: boolean;
  /** Bình luận / lý do / nội dung điều chỉnh — sẽ được cắt 1 dòng ~90 ký tự. */
  excerpt?: string | null;
  /** Số người duyệt (duyệt xong đề xuất / đủ người duyệt điều chỉnh). */
  approverTotal?: number;
  /** Kiểu luồng duyệt: lần lượt → "duyệt bước cuối"; đồng thời → "duyệt cuối cùng";
   * 1 người là xong → "đã duyệt" (không đếm). */
  approvalFlow?: "sequential" | "concurrent" | "single";
  /** Trả lại: đường dẫn thẳng tới màn sửa & gửi lại (cùng link nút "Sửa và gửi lại" trên trang). */
  editUrl?: string;
  /** Số tệp kèm điều chỉnh (khi không có chữ nội dung). */
  fileCount?: number;
}

export const EXCERPT_PUSH_MAX = 90;
const NAME_MAX = 60;
const GROUP_MAX = 80;

/** Gộp xuống dòng/khoảng trắng thành 1 dòng rồi cắt theo cụm ký tự (không vỡ emoji/dấu),
 * bỏ ký tự điều khiển chiều chữ — xem lib/text-clip.ts. */
export function clipLine(text: string | null | undefined, max: number = EXCERPT_PUSH_MAX): string {
  return clipGraphemes(text, max);
}

/** Mã "000000166" → "000166" (bỏ số 0 thừa, giữ tối thiểu 6 chữ số như demo). */
export function shortCode(code: string | null | undefined): string {
  const c = cleanOneLine(code).slice(0, 30);
  return c.replace(/^0+(?=\d{6,}$)/, "");
}

function lines(...parts: string[]): string {
  return parts.filter(Boolean).join("\n");
}

function joinDot(...parts: string[]): string {
  return parts.filter(Boolean).join(" · ");
}

export function requestPushUrl(requestId: string): string {
  return `/request/requests/${encodeURIComponent(requestId)}`;
}

export function buildPushPayload(input: PushPayloadInput): PushPayload {
  const code = shortCode(input.code);
  const hashCode = code ? `#${code}` : "";
  const group = clipLine(input.groupName, GROUP_MAX);
  const actor = clipLine(input.actorName, NAME_MAX);
  const title = clipLine(input.requestTitle);
  const excerpt = clipLine(input.excerpt);
  const quote = excerpt ? `“${excerpt}”` : "";
  /** "Lê Văn C: “lý do”" — thiếu phần nào thì bỏ phần đó. */
  const actorQuote = (fallbackVerb: string) =>
    actor && quote ? `${actor}: ${quote}` : quote || (actor ? `${actor} ${fallbackVerb}` : "");
  // Dòng cuối: "#mã · nhóm" cho người cần xử lý; "tên đề xuất · #mã" cho người gửi.
  const codeGroup = joinDot(hashCode, group);
  const titleCode = joinDot(title || group, hashCode);
  const base = { url: requestPushUrl(input.requestId), tag: `req-${input.requestId}`, kind: input.kind };
  const open = "Mở đề xuất";
  const n = input.approverTotal ?? 0;

  switch (input.kind) {
    case "mentioned":
      return {
        ...base,
        title: actor ? `💬 ${actor} nhắc bạn trong bình luận` : "💬 Bạn được nhắc tên trong bình luận",
        body: lines(quote, codeGroup),
        actionTitle: open,
      };
    case "comment_on_mine":
      return {
        ...base,
        title: actor ? `💬 ${actor} bình luận đề xuất của bạn` : "💬 Có bình luận mới trên đề xuất của bạn",
        body: lines(quote, titleCode),
        actionTitle: open,
      };
    case "pending_approval":
      return {
        ...base,
        title: !actor
          ? "⏳ Có đề xuất chờ bạn duyệt"
          : input.forwarded
            ? `⏳ ${actor} chuyển tiếp cho bạn duyệt`
            : `⏳ Chờ bạn duyệt — ${actor} gửi`,
        body: lines(input.hasCustomTitle ? title : "", codeGroup),
        actionTitle: "Mở để duyệt",
      };
    case "adjustment_pending":
      return {
        ...base,
        title: "✏️ Điều chỉnh sau duyệt chờ bạn duyệt",
        body: lines(
          quote
            ? actorQuote("")
            : (input.fileCount ?? 0) > 0
              ? `${actor || "Có người"} gửi điều chỉnh kèm ${input.fileCount} tệp`
              : actor
                ? `${actor} đề nghị điều chỉnh`
                : "",
          codeGroup,
        ),
        actionTitle: "Mở để duyệt",
      };
    case "approved":
      return {
        ...base,
        title: "✅ Đề xuất của bạn đã được duyệt xong",
        body: lines(
          !actor
            ? ""
            : input.approvalFlow === "single" || n <= 0
              ? `${actor} đã duyệt`
              : input.approvalFlow === "concurrent"
                ? `${actor} duyệt cuối cùng (${n}/${n})`
                : `${actor} duyệt bước cuối (${n}/${n})`,
          titleCode,
        ),
        actionTitle: open,
      };
    case "rejected":
      return {
        ...base,
        title: "❌ Đề xuất của bạn bị từ chối",
        body: lines(actorQuote("đã từ chối"), titleCode),
        actionTitle: open,
      };
    case "returned":
      return {
        ...base,
        // Nút "Sửa và gửi lại" đưa THẲNG tới màn sửa (giống nút cùng tên trên trang đề xuất).
        ...(input.editUrl ? { url: input.editUrl } : {}),
        title: "↩️ Đề xuất bị trả lại để bổ sung",
        body: lines(actorQuote("đã trả lại"), titleCode),
        actionTitle: "Sửa và gửi lại",
      };
    case "adjustment_approved":
      return {
        ...base,
        title: "✅ Điều chỉnh của bạn đã được chấp thuận",
        body: lines(n > 0 ? `Đủ ${n}/${n} người duyệt` : "", joinDot(code ? `Đề xuất ${hashCode}` : "", group)),
        actionTitle: open,
      };
    case "adjustment_rejected":
      return {
        ...base,
        title: "❌ Điều chỉnh của bạn bị từ chối",
        body: lines(actorQuote("đã từ chối"), joinDot(code ? `Đề xuất ${hashCode}` : "", group)),
        actionTitle: open,
      };
  }
}

export function buildTestPushPayload(): PushPayload {
  return {
    title: "🔔 Thông báo thử — HPCore Đề xuất",
    body: "Máy này đã nhận được thông báo ra màn hình.",
    url: "/request/settings/notifications",
    tag: "push-test",
    kind: "test",
    actionTitle: "Mở cài đặt",
  };
}
