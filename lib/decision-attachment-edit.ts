/**
 * "Sửa tệp đính kèm khi duyệt" — Sếp duyệt demo
 * tong-quan-demo/base-request-app/sua-tep-dinh-kem-khi-duyet-2026-10-06
 * (06/10/2026): (1) Thay / Gỡ tệp, GIỮ DẤU VẾT (không xoá phần tử khỏi
 * `attachments`, chỉ đánh dấu `removedAt`/`replacedByPath`); (2) chỉ sửa được
 * khi đề xuất CHƯA KẾT THÚC; (3) người đã đính kèm tệp đó và Owner/Admin được
 * sửa, người khác chỉ xem/tải.
 *
 * Hàm THUẦN dùng chung client (ẩn/hiện nút ⋯) và server (route
 * app/api/requests/[id]/attachments/decision — server luôn kiểm lại).
 *
 * Quyết định "chưa kết thúc" = `pending` VÀ `returned`: đề xuất bị trả lại
 * vẫn đang chờ người gửi sửa rồi gửi lại, chưa có kết quả cuối, tệp người
 * duyệt gửi kèm lý do trả lại vẫn đang có tác dụng → cho sửa. `approved` /
 * `rejected` (đã kết thúc) và `draft` → khoá.
 */
import type { RequestAttachment, RequestStatus } from "./types";

export const DECISION_ATTACHMENT_EDITABLE_STATUSES: readonly RequestStatus[] = ["pending", "returned"];

export function isAttachmentRemoved(att: Pick<RequestAttachment, "removedAt"> | null | undefined): boolean {
  return !!att?.removedAt;
}

/** Tệp còn hiệu lực (chưa gỡ/chưa bị thay) — dùng cho danh sách tải/hiển thị chính. */
export function activeAttachments<T extends Pick<RequestAttachment, "removedAt">>(list: readonly T[]): T[] {
  return list.filter((a) => !isAttachmentRemoved(a));
}

/** uid người đính kèm: `addedByUid` (tệp mới) hoặc suy từ path
 * `requests/{uid}/…` — tệp quyết định luôn được kiểm là path tải lên của
 * CHÍNH người quyết định (lib/server/decision-attachments.ts), nên path là
 * nguồn tin cậy cho tệp ghi trước khi có `addedByUid`. */
export function uploaderUidOf(att: Pick<RequestAttachment, "addedByUid" | "path">): string | null {
  if (att.addedByUid) return att.addedByUid;
  const m = /^requests\/([^/]+)\//.exec(att.path ?? "");
  return m ? m[1] : null;
}

export type DecisionAttachmentEditDenied = { ok: false; status: number; error: string };

/**
 * Người `uid` (isAdmin = Owner/Admin của app) có được thay/gỡ tệp `att` của
 * đề xuất đang ở `status` không. Trả lỗi có mã HTTP để route dùng thẳng.
 */
export function checkDecisionAttachmentEdit(params: {
  status: RequestStatus;
  att: RequestAttachment | null | undefined;
  uid: string;
  isAdmin: boolean;
}): { ok: true } | DecisionAttachmentEditDenied {
  const { status, att, uid, isAdmin } = params;
  if (!att) return { ok: false, status: 404, error: "Không tìm thấy tệp đính kèm." };
  if (att.source !== "decision") {
    return { ok: false, status: 400, error: "Chỉ sửa được tệp đính kèm khi duyệt." };
  }
  if (isAttachmentRemoved(att)) {
    return { ok: false, status: 409, error: "Tệp này đã được gỡ hoặc thay trước đó." };
  }
  if (!DECISION_ATTACHMENT_EDITABLE_STATUSES.includes(status)) {
    return {
      ok: false,
      status: 409,
      error: "Đề xuất đã kết thúc — không thay/gỡ tệp đính kèm khi duyệt được nữa.",
    };
  }
  if (!isAdmin && uploaderUidOf(att) !== uid) {
    return { ok: false, status: 403, error: "Chỉ người đã đính kèm tệp hoặc Owner/Admin mới thay/gỡ được." };
  }
  return { ok: true };
}

export function canEditDecisionAttachment(params: Parameters<typeof checkDecisionAttachmentEdit>[0]): boolean {
  return checkDecisionAttachmentEdit(params).ok;
}

/** Một lần thay/gỡ đọc từ chính dữ liệu tệp — hiện thành dòng lịch sử nhỏ
 * dưới ý kiến người duyệt. */
export interface AttachmentChange {
  kind: "replaced" | "removed";
  at: string;
  by: string;
  oldName: string;
  newName?: string;
}

/**
 * Đi theo chuỗi thay thế từ tệp gốc: gốc → (replacedByPath) → … → tệp hiện
 * hành. Trả tệp hiện hành (null nếu cuối chuỗi đã bị GỠ hoặc đứt chuỗi), các
 * tệp cũ (gạch ngang) và các lần thay/gỡ.
 */
export function resolveReplacementChain(
  root: RequestAttachment,
  all: readonly RequestAttachment[],
): { current: RequestAttachment | null; former: RequestAttachment[]; changes: AttachmentChange[] } {
  const former: RequestAttachment[] = [];
  const changes: AttachmentChange[] = [];
  const seen = new Set<string>();
  let cur: RequestAttachment | undefined = root;
  while (cur) {
    if (seen.has(cur.path)) break; // vòng lặp dữ liệu hỏng — dừng an toàn
    seen.add(cur.path);
    if (!isAttachmentRemoved(cur)) return { current: cur, former, changes };
    former.push(cur);
    const nextPath: string | undefined = cur.replacedByPath;
    const next: RequestAttachment | undefined = nextPath ? all.find((a) => a.path === nextPath) : undefined;
    changes.push({
      kind: next ? "replaced" : "removed",
      at: cur.removedAt ?? "",
      by: cur.removedBy?.name ?? "",
      oldName: cur.name,
      ...(next ? { newName: next.name } : {}),
    });
    cur = next;
  }
  return { current: null, former, changes };
}
