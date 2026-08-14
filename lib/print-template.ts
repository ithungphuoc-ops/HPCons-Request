import { COMPANY_NAME } from "@/lib/constants";
import { deserializeTableRows } from "@/lib/table-field";
import type {
  ApproverStepDef,
  ProposalField,
  RequestInstance,
  RequestStatus,
  TaggedUser,
} from "@/lib/types";

const MAX_APPROVAL_SLOTS = 20;

const COMBINING_MARKS_REGEX = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * Biến tên trường tiếng Việt thành khoá thẻ giữ chỗ trong mẫu in, ví dụ
 * "Bộ Phận" -> "bo_phan", "Tên đề xuất" -> "ten_de_xuat". Người dùng gõ thẻ
 * ${khoa} trực tiếp vào file Word mẫu.
 */
export function slugifyFieldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(COMBINING_MARKS_REGEX, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Sinh `code` ổn định cho các field CHƯA có (dữ liệu cũ trước khi có cơ chế
 * này, hoặc field vừa tạo) — slug từ tên hiện tại, thêm hậu tố _2/_3... nếu
 * trùng code khác trong CÙNG nhóm. Field đã có `code` giữ nguyên tuyệt đối
 * (không tính lại dù đổi tên sau này). Trả về `changed=true` nếu có field
 * nào vừa được gán code mới — gọi nơi dùng để ghi backfill xuống Firestore.
 */
export function ensureFieldCodes(fields: ProposalField[]): {
  fields: ProposalField[];
  changed: boolean;
} {
  const used = new Set(fields.filter((f) => f.code).map((f) => f.code as string));
  let changed = false;
  const next = fields.map((f) => {
    if (f.code) return f;
    changed = true;
    const base = slugifyFieldName(f.name) || "truong";
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return { ...f, code: candidate };
  });
  return { fields: next, changed };
}

/**
 * Sinh `code` ổn định cho các bước duyệt CHƯA có, cùng cơ chế với
 * `ensureFieldCodes` ở trên (dùng chung `slugifyFieldName`, backfill 1 lần,
 * không đổi lại nếu đã có). "submitter_manager" luôn dùng gốc cố định
 * "quan_ly_truc_tiep" (không có tên riêng để slug); "fixed" slug từ tên
 * người được chỉ định.
 */
export function ensureApproverStepCodes(steps: ApproverStepDef[]): {
  steps: ApproverStepDef[];
  changed: boolean;
} {
  const used = new Set(steps.filter((s) => s.code).map((s) => s.code as string));
  let changed = false;
  const next = steps.map((s) => {
    if (s.code) return s;
    changed = true;
    const base =
      s.kind === "submitter_manager"
        ? "quan_ly_truc_tiep"
        : slugifyFieldName(s.user.name) || "nguoi_duyet";
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return { ...s, code: candidate };
  });
  return { steps: next, changed };
}

/** Vài mã trường phổ biến cho "tiêu đề" của 1 đề xuất — dùng cho thẻ ${name}. */
const TITLE_FIELD_CODES = new Set(["ten_de_xuat", "ten_de_nghi", "ten_phieu", "ten_dang_ky"]);

function formatFieldValueForPrint(field: ProposalField, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (field.dataType === "table" || field.dataType === "base_table") {
    return deserializeTableRows(value)
      .map((row) => row.filter(Boolean).join(" / "))
      .filter(Boolean)
      .join("; ");
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    if (typeof value[0] === "object") {
      return (value as { name?: string }[]).map((v) => v.name ?? "").filter(Boolean).join(", ");
    }
    return (value as string[]).join(", ");
  }
  if (field.dataType === "user_select" && typeof value === "object") {
    return (value as { name?: string }).name ?? "";
  }
  return String(value);
}

function statusLabel(status: RequestStatus): string {
  switch (status) {
    case "draft":
      return "Nháp";
    case "pending":
      return "Đang chờ duyệt";
    case "approved":
      return "Đã chấp thuận";
    case "rejected":
      return "Đã từ chối";
    case "returned":
      return "Đã trả lại";
    default:
      return status;
  }
}

function formatDateVN(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN");
}

function formatDateTimeVN(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN");
}

/** Bản ghi lịch sử ứng với quyết định (duyệt/từ chối) của 1 approver — tra theo tên (chấp nhận được ở quy mô công ty hiện tại). */
function findDecisionEntry(
  request: RequestInstance,
  approverName: string,
): RequestInstance["history"][number] | null {
  return (
    [...request.history]
      .reverse()
      .find(
        (h) => h.actor === approverName && (h.action === "Đã chấp thuận" || h.action === "Đã từ chối"),
      ) ?? null
  );
}

/** Khối chữ ký/duyệt nhiều dòng — "Tên (username) - trạng thái (thời gian)", mỗi người 1 dòng. Giữ lại cho mẫu đã dùng thẻ này từ trước. */
function buildApprovalsBlock(request: RequestInstance): string {
  return request.approversSnapshot
    .map((approver, i) => {
      const state = request.approvers[i];
      const decisionLabel =
        state?.decision === "approved"
          ? "Đã chấp thuận"
          : state?.decision === "rejected"
            ? "Đã từ chối"
            : "Chưa xử lý";
      const entry = findDecisionEntry(request, approver.name);
      const atLabel = entry ? ` (${formatDateTimeVN(entry.at)})` : "";
      return `${approver.name} (${approver.username}) - ${decisionLabel}${atLabel}`;
    })
    .join("\n");
}

/** approval_name_1..20 / title(rỗng) / datetime / note / action — người duyệt theo đúng thứ tự thực tế, tối đa 20 người. */
function buildApprovalNumberedKeys(request: RequestInstance): Record<string, string> {
  const data: Record<string, string> = {};
  request.approversSnapshot.slice(0, MAX_APPROVAL_SLOTS).forEach((approver, i) => {
    const n = i + 1;
    const state = request.approvers[i];
    const entry = findDecisionEntry(request, approver.name);
    data[`approval_name_${n}`] = approver.name;
    data[`approval_title_${n}`] = "";
    data[`approval_datetime_${n}`] = entry ? formatDateTimeVN(entry.at) : "";
    data[`approval_note_${n}`] = entry?.note ?? "";
    data[`approval_action_${n}`] =
      state?.decision === "approved"
        ? "Đã chấp thuận"
        : state?.decision === "rejected"
          ? "Đã từ chối"
          : "Chưa xử lý";
  });
  return data;
}

const EMPTY_FINAL_APPROVAL: Record<string, string> = {
  approval_final_name: "",
  approval_final_title: "",
  approval_final_date: "",
  approval_final_datetime: "",
  approval_final_note: "",
};

/** approval_final_* — người duyệt CUỐI CÙNG (theo thứ tự) đã chấp thuận, chỉ có khi đề xuất đã approved. */
function buildApprovalFinalKeys(request: RequestInstance): Record<string, string> {
  if (request.status !== "approved") return EMPTY_FINAL_APPROVAL;

  let finalApprover: TaggedUser | null = null;
  for (let i = request.approversSnapshot.length - 1; i >= 0; i -= 1) {
    if (request.approvers[i]?.decision === "approved") {
      finalApprover = request.approversSnapshot[i];
      break;
    }
  }
  if (!finalApprover) return EMPTY_FINAL_APPROVAL;

  const entry = findDecisionEntry(request, finalApprover.name);
  return {
    approval_final_name: finalApprover.name,
    approval_final_title: "",
    approval_final_date: entry ? formatDateVN(entry.at) : "",
    approval_final_datetime: entry ? formatDateTimeVN(entry.at) : "",
    approval_final_note: entry?.note ?? "",
  };
}

const EMPTY_REJECTION: Record<string, string> = {
  rejection_name: "",
  rejection_title: "",
  rejection_datetime: "",
  rejection_note: "",
};

/** rejection_* — người TỪ CHỐI, chỉ có khi đề xuất đã rejected. */
function buildRejectionKeys(request: RequestInstance): Record<string, string> {
  if (request.status !== "rejected") return EMPTY_REJECTION;

  const rejectorIndex = request.approvers.findIndex((a) => a.decision === "rejected");
  const rejector = rejectorIndex >= 0 ? request.approversSnapshot[rejectorIndex] : null;
  if (!rejector) return EMPTY_REJECTION;

  const entry = findDecisionEntry(request, rejector.name);
  return {
    rejection_name: rejector.name,
    rejection_title: "",
    rejection_datetime: entry ? formatDateTimeVN(entry.at) : "",
    rejection_note: entry?.note ?? "",
  };
}

/** Giá trị của trường được coi là "tên đề xuất" (mã trường ổn định, VD ten_de_xuat) — nếu không có, dùng tên nhóm. */
function resolveNameValue(request: RequestInstance): string {
  for (const field of request.fieldsSnapshot) {
    if (field.code && TITLE_FIELD_CODES.has(field.code)) {
      const value = formatFieldValueForPrint(field, request.values[field.id]);
      if (value) return value;
    }
  }
  return request.groupNameSnapshot;
}

/** Danh sách thẻ hệ thống cố định — luôn có sẵn, không phụ thuộc trường tuỳ chỉnh của nhóm. */
export const SYSTEM_TEMPLATE_KEYS = [
  { key: "id", label: "Mã đề xuất" },
  { key: "name", label: "Tên đề xuất (lấy từ trường \"Tên đề xuất\", nếu có)" },
  { key: "company", label: "Tên công ty" },
  { key: "creator_name", label: "Tên người tạo" },
  { key: "creator_title", label: "Chức vụ người tạo (chưa có dữ liệu — luôn để trống)" },
  { key: "creator_username", label: "Tài khoản người tạo" },
  { key: "group_name", label: "Tên nhóm đề xuất" },
  { key: "group_id", label: "Mã nhóm đề xuất" },
  { key: "status", label: "Trạng thái hiện tại" },
  { key: "created_at_date", label: "Ngày tạo" },
  { key: "created_at_datetime", label: "Ngày giờ tạo" },
  { key: "approval_final_name", label: "Người duyệt cuối" },
  { key: "approval_final_title", label: "Chức vụ người duyệt cuối (chưa có dữ liệu)" },
  { key: "approval_final_date", label: "Ngày duyệt hoàn tất" },
  { key: "approval_final_datetime", label: "Ngày giờ duyệt hoàn tất" },
  { key: "approval_final_note", label: "Ý kiến người duyệt cuối" },
  { key: "rejection_name", label: "Người từ chối" },
  { key: "rejection_title", label: "Chức vụ người từ chối (chưa có dữ liệu)" },
  { key: "rejection_datetime", label: "Thời gian từ chối" },
  { key: "rejection_note", label: "Lý do từ chối" },
  { key: "nhom_de_xuat", label: "Tên nhóm đề xuất (alias cũ của group_name, giữ tương thích mẫu đã có)" },
  { key: "approval_action", label: "Hành động của người duyệt #1 (Đã chấp thuận/Đã từ chối/Chưa xử lý) — alias của approval_action_1" },
];

/** approval_name_1..20, approval_title_1..20, approval_datetime_1..20, approval_note_1..20, approval_action_1..20 — người duyệt theo thứ tự thực tế. */
const APPROVAL_NUMBERED_REGEX = /^approval_(name|title|datetime|note|action)_([1-9]|1[0-9]|20)$/;

/** Kiểm tra 1 tên biến có nằm trong danh sách thẻ hệ thống (cố định + approval_*_N đánh số) không. */
export function isKnownSystemKey(key: string): boolean {
  return SYSTEM_TEMPLATE_KEYS.some((k) => k.key === key) || APPROVAL_NUMBERED_REGEX.test(key);
}

/**
 * Danh sách thẻ gợi ý theo trường tuỳ chỉnh của nhóm (dùng CODE ổn định, không
 * phải slug-từ-tên) — trường kiểu Bảng sinh thêm 1 thẻ mẫu cho mỗi cột dạng
 * column.<code>.<số cột> (cột 0 = STT tự động, cột 1..n = dữ liệu thật).
 */
export function fieldTemplateKeys(fields: ProposalField[]): { key: string; label: string }[] {
  const keys: { key: string; label: string }[] = [];
  for (const field of fields) {
    if (!field.code) continue;
    if (field.dataType === "table" || field.dataType === "base_table") {
      keys.push({ key: `column.${field.code}.0`, label: `${field.name} — STT (tự động)` });
      (field.tableColumns ?? []).forEach((col, i) => {
        keys.push({ key: `column.${field.code}.${i + 1}`, label: `${field.name} — ${col}` });
      });
    } else {
      keys.push({ key: field.code, label: field.name });
    }
  }
  return keys;
}

/**
 * Dựng bảng khoá->giá trị (chuỗi) để điền vào mẫu docx bằng docxtemplater —
 * chạy SAU khi duplicateTableRows() đã xử lý xong các thẻ ${column.*} trực
 * tiếp trong XML, nên hàm này KHÔNG cần (và không nên) tự điền lại các thẻ
 * đó. docxtemplater KHÔNG tự hiểu dấu chấm là truy cập lồng nhau, nhưng ở
 * đây mọi khoá phẳng đơn giản (không có dấu chấm) nên không phát sinh vấn đề.
 */
export function buildPrintTemplateData(request: RequestInstance): Record<string, string> {
  const numberedApprovals = buildApprovalNumberedKeys(request);
  const data: Record<string, string> = {
    id: request.code ?? request.id,
    name: resolveNameValue(request),
    company: COMPANY_NAME,
    creator_name: request.submittedBy.name,
    creator_title: "",
    creator_username: request.submittedBy.email.split("@")[0] ?? "",
    group_name: request.groupNameSnapshot,
    // Alias giữ tương thích với mẫu Sếp đã tải lên trước khi có ${group_name}.
    nhom_de_xuat: request.groupNameSnapshot,
    group_id: request.groupId ?? "",
    status: statusLabel(request.status),
    created_at_date: formatDateVN(request.submittedAt),
    created_at_datetime: formatDateTimeVN(request.submittedAt),
    approvals_name_username_title_datetime: buildApprovalsBlock(request),
    // Alias không đánh số của approval_action_1, khớp mẫu thật Sếp đã dùng.
    approval_action: numberedApprovals.approval_action_1 ?? "Chưa xử lý",
    ...buildApprovalFinalKeys(request),
    ...numberedApprovals,
    ...buildRejectionKeys(request),
  };

  for (const field of request.fieldsSnapshot) {
    if (!field.code) continue;
    data[field.code] = formatFieldValueForPrint(field, request.values[field.id]);
  }

  return data;
}
