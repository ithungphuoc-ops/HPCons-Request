import type { ApproverState } from "./approval-logic";

export type ApprovalFlowType = "concurrent" | "sequential" | "single";

export const approvalFlowLabels: Record<ApprovalFlowType, string> = {
  concurrent: "Xử lý đồng thời",
  sequential: "Xử lý lần lượt",
  single: "Chỉ cần một người duyệt",
};

export const approvalFlowDescriptions: Record<ApprovalFlowType, string> = {
  concurrent:
    "Tất cả người duyệt có thể xử lý không theo thứ tự; đề xuất chỉ hoàn tất khi mọi người cần thiết đều chấp thuận.",
  sequential: "Người được xếp trước phải xử lý xong mới tới người tiếp theo.",
  single: "Một trong các người duyệt chấp thuận là đủ để hoàn tất bước duyệt.",
};

export interface TaggedUser {
  id: string;
  name: string;
  username: string;
  avatarInitial: string;
  /** "group" = nhóm thành viên/phòng ban (chỉ dùng cho mention bình luận,
   * xem lib/server/mentions.ts) — thiếu field = người (mặc định, tương thích
   * ngược với usedFor/approverSteps/followers hiện có). */
  kind?: "user" | "group";
  /** Chức danh phụ hiện dưới tên (vd "Trưởng phòng Hành chính Nhân sự") —
   * chỉ /api/directory/managers trả field này, các nguồn danh bạ khác để
   * trống. */
  title?: string;
}

export interface ProposalField {
  id: string;
  name: string;
  /**
   * Mã trường ỔN ĐỊNH dùng làm thẻ ${code} trong mẫu in — sinh 1 LẦN DUY NHẤT
   * lúc tạo field (slug từ tên ban đầu, thêm hậu tố _2/_3... nếu trùng trong
   * nhóm) và KHÔNG đổi khi người dùng sửa tên hiển thị sau này. Field tạo
   * trước khi có cơ chế này chưa có `code` — được backfill ngầm khi đọc qua
   * API groups (xem lib/server/groups.ts), nên coi field này là optional ở
   * type nhưng thực tế luôn có giá trị sau khi đi qua API.
   */
  code?: string;
  dataType: FieldDataType;
  required: boolean;
  order: number;
  placeholder?: string;
  options?: string[];
  tableColumns?: string[];
  formula?: string;
  /** Chỉ hiển thị field này trên form Gửi đề xuất khi điều kiện thoả mãn (dựa
   * trên giá trị field khác của CÙNG đề xuất) — ví dụ 4 field "Thiết bị..."
   * chỉ hiện đúng 1 cái tuỳ theo "Nhóm đề xuất" đang chọn. Field bị ẩn KHÔNG
   * bắt buộc trả lời dù `required=true`, và giá trị của field bị ẩn không
   * được validate khi gửi (xem lib/server/requests.ts findVisibleFields). */
  visibleWhen?: ConditionRule;
}

export type FieldDataType =
  | "integer"
  | "decimal"
  | "short_text"
  | "paragraph"
  | "date"
  | "datetime"
  | "single_choice"
  | "multiple_choice"
  | "file"
  | "table"
  | "currency"
  | "formula"
  | "base_table"
  | "section_title"
  | "department_select"
  | "user_select";

export const fieldDataTypeLabels: Record<FieldDataType, string> = {
  integer: "Số nguyên",
  decimal: "Số thập phân",
  short_text: "Văn bản ngắn",
  paragraph: "Văn bản đoạn",
  date: "Ngày",
  datetime: "Ngày giờ",
  single_choice: "Một lựa chọn",
  multiple_choice: "Nhiều lựa chọn",
  file: "Tệp tin",
  table: "Bảng",
  currency: "Tiền tệ",
  formula: "Công thức",
  base_table: "Base Table",
  section_title: "Tiêu đề phân đoạn",
  department_select: "Chọn bộ phận (tự động từ Nhóm thành viên)",
  user_select: "Chọn người dùng (@)",
};

/**
 * Điều kiện đơn giản dựa trên giá trị 1 field của đề xuất — dùng chung cho
 * bước duyệt có điều kiện (ApproverStepDef.condition) và người theo dõi theo
 * điều kiện (ProposalGroup.followersConditional). "equals"/"not_equals" dùng
 * cho field kiểu single_choice/department_select; "includes" dùng cho
 * multiple_choice (value nằm trong mảng đã chọn). Xem design.md của change
 * add-base-vn-group-settings-parity — chỉ hỗ trợ 1 field/1 điều kiện, chưa
 * có AND/OR vì chưa có bằng chứng Base.vn thật cần điều đó.
 */
export interface ConditionRule {
  /** Tham chiếu ProposalField.code trong CÙNG nhóm, không phải field.id. */
  fieldCode: string;
  operator: "equals" | "not_equals" | "includes";
  value: string;
}

/**
 * Định nghĩa 1 bước duyệt của nhóm — "fixed" là một người cố định (giống
 * nhau cho mọi đề xuất); "submitter_manager" là quản lý trực tiếp/trưởng
 * đơn vị của CHÍNH NGƯỜI GỬI, được tra cứu lại (department.leaderId) tại
 * thời điểm gửi từng đề xuất — khác nhau tuỳ người gửi.
 *
 * `code` là mã ổn định sinh 1 lần lúc tạo (cùng cơ chế slugifyFieldName của
 * field), backfill ngầm cho bước duyệt cũ khi đọc qua API — xem
 * lib/server/groups.ts. `condition`: nếu có, bước duyệt CHỈ được đưa vào
 * danh sách người duyệt thực tế khi điều kiện thoả mãn tại thời điểm gửi.
 */
export type ApproverStepDef =
  | { kind: "fixed"; user: TaggedUser; code?: string; condition?: ConditionRule }
  | { kind: "submitter_manager"; code?: string; condition?: ConditionRule };

export interface ProposalGroup {
  id: string;
  name: string;
  description: string;
  /** Mô tả nhóm dạng rich text (HTML đã sanitize phía server) — description
   * ở trên giữ nguyên làm bản plain-text rút gọn cho nơi hiển thị ngắn (vd
   * danh sách nhóm), không phải nơi nào cũng cần sửa sang đọc field mới này. */
  descriptionHtml?: string;
  category: string;
  status: "active" | "closed";
  approvalFlow: ApprovalFlowType;
  slaHours: number | null;
  notifyManager: boolean;
  usedFor: TaggedUser[];
  approverSteps: ApproverStepDef[];
  followers: TaggedUser[];
  /** Danh sách người theo dõi CHỈ được thêm khi điều kiện tương ứng thoả mãn
   * lúc gửi chính thức — hợp cùng `followers` (cố định) + người gửi tự thêm. */
  followersConditional?: { condition: ConditionRule; users: TaggedUser[] }[];
  fields: ProposalField[];
  pinned: boolean;
  createdAt: string;
  /** Ghi chú chân trang khi in đề xuất — vd "Người lập phiếu / Người duyệt". */
  printFooterNote?: string;
  /** Chặn "In theo mẫu" nếu đề xuất chưa ở trạng thái approved — mặc định false. */
  printRequireFullyApproved?: boolean;
  /** Người tạo có bắt buộc điền field tuỳ chỉnh của nhóm khi gửi hay có thể bỏ
   * qua (chỉ điền thông tin hệ thống) — mặc định true (bắt buộc), giữ đúng
   * hành vi hiện tại khi field này chưa được đặt. */
  requiresSubmissionForm?: boolean;
  /** Bật SLA riêng cho từng bước duyệt (độc lập SLA chung slaHours) — chưa áp
   * dụng logic tính hạn riêng trong change này, chỉ lưu cấu hình. */
  approverSlaEnabled?: boolean;
  /** Tính SLA theo lịch làm việc (bỏ giờ ngoài hành chính/ngày nghỉ) thay vì
   * giờ đồng hồ liên tục — chưa áp dụng logic tính trong change này. */
  slaByWorkCalendar?: boolean;
  /** Bắt buộc người duyệt nhập ghi chú khi thực hiện hành động tương ứng. */
  requireDecisionNote?: {
    approve?: boolean;
    reject?: boolean;
    forward?: boolean;
    approveAndForward?: boolean;
  };
  /** Bật mã đề xuất tự sinh riêng theo nhóm (transaction riêng), thay vì luôn
   * dùng bộ đếm toàn hệ thống — mặc định false/chưa đặt = dùng bộ đếm chung. */
  useOwnCounter?: boolean;
}

/**
 * 1 mẫu in (.docx) của 1 nhóm đề xuất — lưu ở subcollection
 * `groups/{groupId}/printTemplates/{id}` (KHÔNG phải field đơn trên group
 * doc), cho phép nhiều mẫu/nhóm + versioning + lịch sử độc lập.
 */
export interface PrintTemplate {
  id: string;
  groupId: string;
  /** Tên hiển thị Sếp tự đặt, độc lập với fileName gốc. */
  name: string;
  fileName: string;
  /** Đường dẫn thật trong Storage (không phải URL công khai). */
  path: string;
  isDefault: boolean;
  createdBy: { uid: string; name: string };
  createdAt: string;
  updatedAt: string;
  /** Tăng mỗi lần thay file (không tăng khi chỉ đổi tên/đặt mặc định). */
  version: number;
  /** Danh sách thẻ ${...} phát hiện được trong file lúc quét (upload/thay file). */
  detectedVariables: string[];
  validation: {
    errors: string[];
    warnings: string[];
  };
}

/**
 * 1 lần xuất file theo mẫu — chỉ ghi metadata, KHÔNG ghi nội dung/giá trị
 * thật của đề xuất (tránh lộ dữ liệu nhạy cảm vào log/lịch sử).
 */
export interface PrintExportRecord {
  id: string;
  requestId: string;
  requestCode: string | null;
  groupId: string;
  templateId: string;
  templateVersion: number;
  format: "docx";
  performedBy: { uid: string; name: string };
  performedAt: string;
  status: "success" | "failed";
  resultPath: string | null;
  errorMessage?: string;
}

export interface CategoryGroup {
  id: string;
  code: string;
  name: string;
  groups: ProposalGroup[];
}

/**
 * "returned" (Đã trả lại) chưa có hành động riêng dựng trên UI (chưa xác
 * nhận chắc chắn từ đặc tả gốc — xem design.md Decision 7 / Open Questions).
 * Giữ chỗ trong type để không phải đổi schema lần 2 khi xác nhận xong.
 */
export type RequestStatus = "draft" | "pending" | "approved" | "rejected" | "returned";

export interface RequestSubmitter {
  uid: string;
  email: string;
  name: string;
}

export interface RequestHistoryEntry {
  at: string;
  actor: string;
  action: string;
  /** Người nhận khi action là chuyển tiếp. */
  target?: string;
  note?: string;
}

/** Giá trị của trường "file" trong values — path là đường dẫn thật trong
 * Storage (không phải URL công khai); tải về qua API có kiểm tra quyền. */
export interface RequestAttachment {
  name: string;
  path: string;
  size: number;
}

export interface RequestComment {
  id: string;
  authorUid: string;
  authorName: string;
  avatarInitial: string;
  text: string;
  at: string;
  /** uid người + id nhóm thành viên/phòng ban được @mention trong bình luận này. */
  mentionIds?: string[];
  /** Luôn trỏ về 1 bình luận GỐC (không có parentId riêng) — trả lời giới hạn 1 cấp,
   * xem design.md của change add-comment-mentions-realtime. */
  parentId?: string | null;
  /** Có giá trị nếu tác giả đã sửa lại nội dung sau khi gửi. */
  editedAt?: string;
}

/**
 * Một đề xuất cụ thể đã gửi từ một nhóm (ProposalGroup), hoặc "Đề xuất trực
 * tiếp" (groupId null) — xem design.md Decision 10. Chụp lại field và người
 * duyệt tại thời điểm gửi (không tham chiếu sống tới nhóm gốc) để sửa nhóm
 * sau này không làm đổi hình dạng các đề xuất đang chờ xử lý — xem design.md
 * của change add-core-request-flow-and-hpcore-sso.
 */
export interface RequestInstance {
  id: string;
  /** Mã hiển thị cho người dùng — 6 chữ số, cấp khi gửi chính thức (null lúc còn nháp). */
  code: string | null;
  /** null = "Đề xuất trực tiếp", không gắn với nhóm/mẫu nào. */
  groupId: string | null;
  groupNameSnapshot: string;
  fieldsSnapshot: ProposalField[];
  values: Record<string, unknown>;
  submittedBy: RequestSubmitter;
  submittedAt: string;
  /** Cập nhật mỗi lần sửa nháp, gửi chính thức, hoặc có quyết định duyệt/chuyển tiếp. */
  updatedAt: string;
  approvalFlow: ApprovalFlowType;
  /** Thông tin hiển thị (tên/avatar) của người duyệt, cùng thứ tự với `approvers`. */
  approversSnapshot: TaggedUser[];
  /** Trạng thái quyết định — dùng nguyên với lib/approval-logic.ts, không đổi shape. */
  approvers: ApproverState[];
  followers: TaggedUser[];
  status: RequestStatus;
  /**
   * Hạn xử lý tính từ slaHours của nhóm tại thời điểm gửi; null nếu nhóm
   * không đặt SLA hoặc đề xuất còn là nháp. "Quá hạn" là nhãn tính lúc đọc
   * (status vẫn "pending"), không lưu thành trạng thái riêng.
   */
  deadlineAt: string | null;
  history: RequestHistoryEntry[];
  comments: RequestComment[];
  /** Hợp nhất mọi uid từng được @mention (trực tiếp hoặc qua nhóm/phòng ban)
   * trong các bình luận của đề xuất này — dùng để NotificationBell tính
   * `scope=mentioned` mà không cần collection notifications riêng. */
  mentionedUids?: string[];
  /** Xóa mềm — null nếu chưa xóa. Đề xuất đã xóa bị loại khỏi mọi danh sách
   * thường (mine/inbox/all/group...), chỉ hiện trong "Tất cả đề xuất hệ
   * thống" (scope=system, admin) để khôi phục khi cần. */
  deletedAt: string | null;
}

export type ModalWindowStatus =
  | "closed"
  | "open"
  | "submitting"
  | "success"
  | "error";

export type FieldRowStatus = "normal" | "dragging" | "editing" | "invalid";

export type PermissionAssignmentStatus =
  | "unselected"
  | "selected"
  | "saving"
  | "saved"
  | "error";

export type ListLoadStatus = "loading" | "loaded" | "empty" | "error";

export type RequestListScope = "all" | "sent-to-me" | "mine" | "following" | "group";

/**
 * 5 loại thông báo mà chuông (NotificationBell) có thể hiển thị — mỗi user tự
 * bật/tắt riêng từng loại, xem lib/server/notificationSettings.ts. Không có
 * collection notifications riêng: mỗi loại tương ứng 1 scope tính lại từ dữ
 * liệu requests (xem app/api/requests/route.ts).
 */
export type NotificationCategory =
  | "approver_pending"
  | "own_decided"
  | "mentioned"
  | "following"
  | "manager_bypassed";

export type NotificationSettings = Record<NotificationCategory, boolean>;

export interface GroupHistoryChange {
  field: string;
  before: string;
  after: string;
}

export interface GroupHistoryEntry {
  id: string;
  groupId: string;
  groupName: string;
  actor: string;
  at: string;
  action: string;
  changes: GroupHistoryChange[];
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  before: string;
  after: string;
  at: string;
}
