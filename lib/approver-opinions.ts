/**
 * "Ý kiến của người duyệt" (Sếp duyệt demo
 * tong-quan-demo/base-request-app/y-kien-nguoi-duyet-2026-10-06, 06/10/2026).
 *
 * Hàm THUẦN: trích ý kiến từ `request.history` (route decision đã ghi `note`
 * cho mọi hành động duyệt từ trước tới nay) — KHÔNG lưu thêm gì, KHÔNG chuyển
 * dữ liệu, nên đề xuất cũ có ghi chú cũng hiện được.
 *
 * Ý kiến = dòng lịch sử thuộc hành động của NGƯỜI DUYỆT (chấp thuận, từ chối,
 * chuyển tiếp các kiểu, kể cả nhãn cũ "Đã chuyển tiếp", và "Trả lại" — lý do
 * trả lại cũng là ý kiến của người duyệt) có `note` khác rỗng.
 *
 * Giới hạn: lịch sử chỉ ghi TÊN người thao tác (không có uid) → ghép tên với
 * `approversSnapshot[].name` như lib/approver-progress.ts. Hai người duyệt
 * TRÙNG TÊN: ưu tiên người có quyết định hiện tại khớp hành động, không có thì
 * người đứng trước — có thể gán nhầm giữa 2 người trùng tên. Người không còn
 * trong danh sách duyệt (vd bị thay theo kiểu chuyển tiếp cũ) → vẫn liệt kê
 * theo tên, chỉ không gắn được biểu tượng cạnh tên.
 */
import { HISTORY_ACTION, sameName } from "./approver-progress";
import { resolveReplacementChain, type AttachmentChange } from "./decision-attachment-edit";
import type { RequestAttachment, RequestInstance } from "./types";

export type ApproverOpinionKind = "approved" | "rejected" | "approveAndForward" | "forward" | "returned";

export interface ApproverOpinion {
  /** Khoá ổn định trong 1 lần hiển thị (vị trí trong history). */
  key: string;
  at: string;
  actor: string;
  kind: ApproverOpinionKind;
  note: string;
  /** Người nhận khi là chuyển tiếp. */
  target?: string;
  /** Tệp người duyệt đính kèm cùng quyết định ("Đính kèm tệp khi duyệt",
   * 06/10/2026). Tệp không tìm thấy trong `attachments` (vd đã bị gỡ) vẫn
   * liệt kê theo tên với `path` rỗng — UI không cho mở.
   * Tệp đã THAY → ở đây là tệp thay thế hiện hành; tệp đã GỠ → không có ở
   * đây (nằm trong `formerAttachments`). */
  attachments: RequestAttachment[];
  /** Tệp cũ đã gỡ/đã bị thay ("Sửa tệp đính kèm khi duyệt", 06/10/2026) —
   * UI hiện gạch ngang thu gọn, không cho mở. */
  formerAttachments: RequestAttachment[];
  /** Các lần thay/gỡ tệp của ý kiến này, cũ → mới. */
  attachmentChanges: AttachmentChange[];
  /** Vị trí trong `approversSnapshot` — null nếu không ghép được tên. */
  approverIndex: number | null;
  approverId: string | null;
}

const ACTION_TO_KIND: Record<string, ApproverOpinionKind> = {
  [HISTORY_ACTION.approved]: "approved",
  [HISTORY_ACTION.rejected]: "rejected",
  [HISTORY_ACTION.approveAndForward]: "approveAndForward",
  [HISTORY_ACTION.forwardThenApprove]: "forward",
  [HISTORY_ACTION.legacyForwarded]: "forward",
  [HISTORY_ACTION.returned]: "returned",
};

/** Động từ sau tên người: "Hồ Văn Thi đã chấp thuận đề xuất". */
export const OPINION_VERB: Record<ApproverOpinionKind, string> = {
  approved: "đã chấp thuận",
  rejected: "đã từ chối",
  approveAndForward: "đã chấp thuận và chuyển tiếp",
  forward: "đã chuyển tiếp",
  returned: "đã trả lại",
};

/** Trích ý kiến người duyệt, xếp theo thời gian tăng dần (cũ → mới). */
export function extractApproverOpinions(
  request: Pick<RequestInstance, "history" | "approversSnapshot" | "approvers"> &
    Partial<Pick<RequestInstance, "attachments">>,
): ApproverOpinion[] {
  const snapshot = request.approversSnapshot ?? [];
  const approvers = request.approvers ?? [];
  const allAttachments = request.attachments ?? [];
  const used = new Set<RequestAttachment>();
  const out: ApproverOpinion[] = [];

  (request.history ?? []).forEach((entry, i) => {
    const kind = ACTION_TO_KIND[entry.action];
    const note = entry.note?.trim() ?? "";
    const names = (entry.attachmentNames ?? []).filter((n) => typeof n === "string" && n);
    // Ý kiến có thể chỉ có tệp, không ghi chú — vẫn là 1 ý kiến.
    if (!kind || (!note && names.length === 0)) return;

    // Ghép tên tệp với tệp GỐC thật: ưu tiên tệp `source: "decision"` cùng
    // mốc `addedAt` = `at` của dòng lịch sử; không có thì tệp quyết định cùng
    // tên. Tệp THAY THẾ (`replacesPath`) không bao giờ là gốc — nó được nối
    // vào qua chuỗi thay thế của tệp gốc bên dưới (dòng lịch sử quyết định
    // giữ nguyên tên tệp gốc, không bị sửa).
    const files: RequestAttachment[] = [];
    const formerAttachments: RequestAttachment[] = [];
    const attachmentChanges: AttachmentChange[] = [];
    for (const name of names) {
      const isRoot = (a: RequestAttachment) => !used.has(a) && a.source === "decision" && !a.replacesPath;
      const pick =
        allAttachments.find((a) => isRoot(a) && a.addedAt === entry.at && a.name === name) ??
        allAttachments.find((a) => isRoot(a) && a.name === name);
      if (!pick) {
        files.push({ name, path: "", size: 0 });
        continue;
      }
      used.add(pick);
      const chain = resolveReplacementChain(pick, allAttachments);
      if (chain.current) files.push(chain.current);
      formerAttachments.push(...chain.former);
      attachmentChanges.push(...chain.changes);
    }
    attachmentChanges.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    const candidates = snapshot
      .map((s, idx) => ({ s, idx }))
      .filter(({ s }) => sameName(s.name, entry.actor));
    let chosen = candidates[0];
    if (candidates.length > 1) {
      const wanted =
        kind === "approved" || kind === "approveAndForward" ? "approved" : kind === "rejected" ? "rejected" : null;
      const byDecision = wanted
        ? candidates.find(({ s }) => approvers.find((a) => a.id === s.id)?.decision === wanted)
        : undefined;
      if (byDecision) chosen = byDecision;
    }

    out.push({
      key: `${i}-${entry.at}`,
      at: entry.at,
      actor: entry.actor,
      kind,
      note,
      target: entry.target,
      attachments: files,
      formerAttachments,
      attachmentChanges,
      approverIndex: chosen ? chosen.idx : null,
      approverId: chosen ? chosen.s.id : null,
    });
  });

  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Số ý kiến theo id người duyệt — cho biểu tượng bong bóng cạnh tên. */
export function countOpinionsByApprover(opinions: ApproverOpinion[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of opinions) {
    if (!o.approverId) continue;
    counts[o.approverId] = (counts[o.approverId] ?? 0) + 1;
  }
  return counts;
}
