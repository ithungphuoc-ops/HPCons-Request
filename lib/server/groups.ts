import "server-only";
import { adminDb } from "@/lib/firebase/admin";
import type { GroupHistoryChange } from "@/lib/types";
import { describeDecisionNoteFlags } from "@/lib/decision-note";

export { ensureApproverStepCodes, ensureFieldCodes } from "@/lib/print-template";
export { sanitizeDescriptionHtml } from "@/lib/validation";

/** Đảm bảo tồn tại tài liệu `categories` cho tên danh mục này, tạo mới nếu chưa có. */
export async function ensureCategoryExists(categoryName: string): Promise<void> {
  const categoriesRef = adminDb.collection("categories");
  const existing = await categoriesRef.where("name", "==", categoryName).limit(1).get();
  if (!existing.empty) return;

  const count = (await categoriesRef.count().get()).data().count;
  await categoriesRef.add({
    code: String(count + 1).padStart(2, "0"),
    name: categoryName,
  });
}

const FIELD_LABELS: Record<string, string> = {
  name: "Tên nhóm",
  description: "Mô tả",
  category: "Phân loại",
  status: "Trạng thái",
  approvalFlow: "Quy trình xử lý",
  slaHours: "Thời hạn xử lý (giờ)",
  notifyManager: "Báo quản lý trực tiếp",
  usedFor: "Phạm vi sử dụng",
  usedForIncludeSecondary: "Phạm vi: tính cả người kiêm nhiệm",
  approverSteps: "Người xét duyệt",
  followers: "Người theo dõi",
  fields: "Mẫu biểu (trường dữ liệu)",
  pinned: "Đánh dấu quan trọng",
  requireDecisionNote: "Ý kiến khi phê duyệt — bắt buộc",
  decisionNoteEnabled: "Ý kiến khi phê duyệt — có ô ghi chú",
};

/** Field dạng object cờ theo hành động — hiển thị "Chấp thuận: Có, …" thay
 * vì "[object Object]". */
const DECISION_NOTE_KEYS = new Set(["requireDecisionNote", "decisionNoteEnabled"]);

function toDisplay(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (Array.isArray(value)) return value.length === 0 ? "Trống" : `${value.length} mục`;
  return String(value);
}

/** So sánh giá trị cũ/mới của từng trường trong patch, trả về danh sách thay
 * đổi thật sự (bỏ qua trường không đổi giá trị). */
export function diffGroupPatch(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): GroupHistoryChange[] {
  return Object.entries(patch)
    .filter(([key, value]) =>
      // 2 object cờ "Ý kiến khi phê duyệt": so theo NGHĨA (thứ tự key cố định
      // trong describeDecisionNoteFlags) — Firestore có thể trả key theo thứ
      // tự khác, JSON.stringify sẽ ghi dòng lịch sử ảo.
      DECISION_NOTE_KEYS.has(key)
        ? describeDecisionNoteFlags(before[key]) !== describeDecisionNoteFlags(value)
        : JSON.stringify(before[key]) !== JSON.stringify(value),
    )
    .map(([key, value]) => ({
      field: FIELD_LABELS[key] ?? key,
      before: DECISION_NOTE_KEYS.has(key) ? describeDecisionNoteFlags(before[key]) : toDisplay(before[key]),
      after: DECISION_NOTE_KEYS.has(key) ? describeDecisionNoteFlags(value) : toDisplay(value),
    }));
}

/** Ghi 1 dòng lịch sử chỉnh sửa nhóm — bỏ qua nếu không có thay đổi thật. */
export async function recordGroupHistory(params: {
  groupId: string;
  groupName: string;
  actor: string;
  action: string;
  changes: GroupHistoryChange[];
}): Promise<void> {
  if (params.changes.length === 0) return;
  await adminDb.collection("groupHistory").add({
    groupId: params.groupId,
    groupName: params.groupName,
    actor: params.actor,
    at: new Date().toISOString(),
    action: params.action,
    changes: params.changes,
  });
}
