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
  /** Chỉ hiển thị field này trên form Gửi đề xuất khi nhóm điều kiện thoả mãn
   * (dựa trên giá trị (các) field khác của CÙNG đề xuất, kết hợp AND/OR) —
   * ví dụ 4 field "Thiết bị..." chỉ hiện đúng 1 cái tuỳ theo "Nhóm đề xuất"
   * đang chọn. Field bị ẩn KHÔNG bắt buộc trả lời dù `required=true`, và giá
   * trị của field bị ẩn không được validate khi gửi (xem lib/server/requests.ts
   * findMissingRequiredFields). */
  visibleWhen?: ConditionGroup;
  /**
   * Cho field kiểu short_text/paragraph: nếu có, giá trị field này KHÔNG cho
   * gõ tay mà tự động ghép từ giá trị (các) field khác trong CÙNG đề xuất —
   * xem ComputedFieldConfig. Không đổi `dataType` (vẫn là short_text/paragraph
   * như cũ), chỉ thêm khả năng tự tính — các nơi khác (in ấn, xuất file,
   * webhook) không cần biết tới field này, cứ đọc `values[field.id]` như field
   * văn bản bình thường vì máy chủ đã ghi giá trị tính sẵn vào đó.
   */
  computedFrom?: ComputedFieldConfig;
  /**
   * Chỉ cho field kiểu date/datetime: ràng buộc "ngày cần cấp" phải cách hôm
   * làm đề nghị bao xa — xem DateLeadTimeRule. Đặt RIÊNG theo từng field
   * (không phải cấu hình chung toàn app) vì mỗi loại đề nghị (mua hàng, tạm
   * ứng...) cần lề thời gian khác nhau.
   */
  dateLeadTimeRule?: DateLeadTimeRule;
  /** Giải thích/hướng dẫn LUÔN hiện dưới ô nhập (khác `placeholder` — biến mất
   * khi người dùng bắt đầu gõ). Chỉ lưu chuỗi thường, không phải rich text —
   * xem design.md của change add-base-vn-approver-and-approval-form-parity,
   * Decision #4. Giới hạn ~300 ký tự khi lưu (`sanitizeHelpText()`). */
  helpText?: string;
}

/**
 * 1 trường dữ liệu CHỈ hiện cho ĐÚNG người duyệt của 1 bước CỐ ĐỊNH
 * (`kind: "fixed"`) lúc họ đang xử lý ĐÚNG 1 hành động quyết định — khác hẳn
 * `ProposalGroup.fields` (người GỬI điền lúc tạo đề xuất). Ví dụ: field "Số
 * tiền đã kiểm tra" chỉ hiện cho KTTCH lúc họ bấm "Chấp thuận", không hiện
 * cho người gửi, không hiện cho bước duyệt khác, không hiện lúc KTTCH "Từ
 * chối". Xem design.md của change add-base-vn-approver-and-approval-form-parity,
 * Decision #3 — CHỈ hỗ trợ bước `fixed` trong lần đầu này (không hỗ trợ
 * `flexible_approver`/`submitter_manager`).
 */
export interface ApprovalTimeField {
  id: string;
  /** Tham chiếu `ApproverStepDef.code` của 1 bước `kind: "fixed"` TRONG CÙNG nhóm. */
  approverStepCode: string;
  /** Trùng khái niệm với `ProposalGroup.requireDecisionNote` (4 hành động quyết định). */
  decisionAction: "approve" | "reject" | "forward" | "approveAndForward";
  /** Field thường, loại trừ 3 cơ chế không có ý nghĩa ở đây (điều kiện hiện/tự
   * tính/ngày cần cấp đều thiết kế cho form GỬI, không phải form phê duyệt). */
  field: Omit<ProposalField, "visibleWhen" | "computedFrom" | "dateLeadTimeRule">;
}

/**
 * Ràng buộc "ngày cần cấp" cho 1 field kiểu date/datetime — Sếp chốt
 * 20/08/2026. Khi bật (`enabled: true`), lúc gửi đề xuất, ngày người dùng
 * chọn ở field này được phân loại theo số ngày làm việc (Thứ 2→Thứ 7, trừ
 * Chủ Nhật — cùng quy ước lib/business-hours.ts) cách hôm làm đề nghị:
 *   - ≤ 2 ngày làm việc  → CHẶN HẲN không cho gửi (mốc cứng, không đổi được).
 *   - 3 ngày tới TRƯỚC `standardDays` → coi là "gấp", phải hỏi lại người gửi
 *     có thật cần thiết không, xác nhận rồi mới đánh dấu màu lên ô ngày.
 *   - >= `standardDays` → bình thường, không cảnh báo.
 * `standardDays` do Admin tự chọn khi tạo/sửa field này (5/7/15 ngày làm
 * việc) — xem lib/date-lead-time.ts (classifyDateLeadTime).
 */
export interface DateLeadTimeRule {
  enabled: boolean;
  standardDays: 5 | 7 | 15;
}

/**
 * Cấu hình field "tự tính" — danh sách nhánh, đánh giá theo thứ tự, dùng mẫu
 * chuỗi của nhánh ĐẦU TIÊN có điều kiện thoả mãn (hoặc không có điều kiện —
 * luôn khớp, dùng làm nhánh mặc định/fallback nếu đặt cuối danh sách). Không
 * nhánh nào khớp → field coi như chưa tính được, cho gõ tay bình thường.
 */
export interface ComputedFieldConfig {
  branches: ComputedTemplateBranch[];
}

/**
 * 1 nhánh: điều kiện tuỳ chọn (dùng chung ConditionGroup với visibleWhen) +
 * mẫu chuỗi dùng cú pháp `${code}` để chèn giá trị field khác trong CÙNG đề
 * xuất (code không khớp field nào thì giữ nguyên `${code}`, không xoá trắng).
 */
export interface ComputedTemplateBranch {
  condition?: ConditionGroup;
  template: string;
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
 * Một rule con dựa trên giá trị 1 field của đề xuất — dùng chung cho field
 * hiển thị theo điều kiện (ProposalField.visibleWhen), bước duyệt có điều
 * kiện (ApproverStepDef.condition), và người theo dõi theo điều kiện
 * (ProposalGroup.followersConditional). Luôn nằm trong 1 ConditionGroup (xem
 * dưới) — không dùng đứng riêng. "equals"/"not_equals" dùng cho field kiểu
 * single_choice/department_select; "includes" dùng cho multiple_choice
 * (value nằm trong mảng đã chọn); "greater_than"/"less_than"/"between" dùng
 * cho field kiểu integer/decimal/currency/date (so sánh sau khi ép kiểu số
 * hoặc thời điểm — xem lib/server/conditions.ts evaluateRule). `valueTo` chỉ
 * dùng khi operator là "between" (cận trên của khoảng, `value` là cận dưới).
 * "not_includes" là phủ định của "includes" (multiple_choice không chứa lựa
 * chọn nào đó). "is_empty"/"is_not_empty" dùng cho MỌI kiểu field (field chưa
 * điền/rỗng hay đã có giá trị) — không cần `value`.
 */
export interface ConditionRule {
  /** Tham chiếu ProposalField.code trong CÙNG nhóm, không phải field.id. */
  fieldCode: string;
  operator:
    | "equals"
    | "not_equals"
    | "includes"
    | "not_includes"
    | "is_empty"
    | "is_not_empty"
    | "greater_than"
    | "less_than"
    | "between";
  /** Bỏ trống ("") khi operator là "is_empty"/"is_not_empty" — không dùng tới. */
  value: string;
  /** Chỉ dùng khi operator === "between" — cận trên của khoảng (đóng 2 đầu). */
  valueTo?: string;
}

/**
 * Một nhóm điều kiện — danh sách 1 hoặc nhiều ConditionRule kết hợp bằng
 * "all" (AND, mọi rule con phải thoả) hoặc "any" (OR, chỉ cần 1 rule con
 * thoả). Nhóm rỗng (rules: []) luôn được coi là thoả mãn — an toàn hơn là
 * chặn nhầm khi dữ liệu migrate lỗi. Cố ý KHÔNG lồng nhóm con trong nhóm cha
 * (không có cây điều kiện nhiều tầng) — xem design.md của change
 * extend-condition-rules: mức phức tạp 1 tầng conjunction phẳng đã đủ dùng,
 * chưa có bằng chứng cần cây điều kiện lồng nhau.
 */
export interface ConditionGroup {
  conjunction: "all" | "any";
  rules: ConditionRule[];
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
 * danh sách người duyệt thực tế khi nhóm điều kiện thoả mãn tại thời điểm gửi.
 */
export type ApproverStepDef =
  | {
      kind: "fixed";
      /** Nhãn hiển thị riêng cho bước (vd "KTTCH") — KHÁC `code` (mã máy ổn
       * định). Bước cũ không có field này → UI hiển thị "Bước {index+1}" như
       * trước (xem design.md của change add-base-vn-approver-and-approval-form-parity). */
      name?: string;
      /** Người ĐẦU TIÊN của bước — giữ nguyên cho tương thích dữ liệu/code cũ
       * (bước tạo trước 16/08/2026 chỉ có field này). Đọc đủ danh sách người
       * của bước bằng `fixedStepUsers()` (lib/approval-logic.ts), đừng đọc
       * trực tiếp field này trừ khi cố ý chỉ cần người đầu tiên. */
      user: TaggedUser;
      /** Đủ danh sách người của bước (nhiều người/1 bước, TẤT CẢ phải duyệt —
       * Sếp chốt 16/08/2026). Bước cũ không có field này = 1 người (`user`). */
      users?: TaggedUser[];
      code?: string;
      condition?: ConditionGroup;
      /** SLA riêng bước này (giờ) — chỉ có tác dụng khi `ProposalGroup.approverSlaEnabled`
       * bật; xem `computeStepSlaHours()` trong lib/server/requests.ts. */
      slaHours?: number;
    }
  | {
      kind: "submitter_manager";
      name?: string;
      code?: string;
      condition?: ConditionGroup;
      slaHours?: number;
    }
  | {
      kind: "flexible_approver";
      /** BẮT BUỘC (khác `fixed`/`submitter_manager` optional) — bước này tồn
       * tại VÌ có tên, không có `user` nào để định danh thay thế. */
      name: string;
      /** Danh sách người duyệt do Admin tự gán tay — CHO PHÉP RỖNG ("Chưa cài
       * đặt danh sách duyệt"). Bước rỗng bị BỎ QUA lúc gửi đề xuất (không chặn
       * gửi, không lỗi) — xem `resolveApproverStepsDetailed()`. */
      users: TaggedUser[];
      code?: string;
      condition?: ConditionGroup;
      slaHours?: number;
    };

/** Tên bước + SLA riêng bước, cùng thứ tự/độ dài với `RequestInstance.approversSnapshot`
 * — dùng để hiển thị tên bước (thay "Bước N") và SLA riêng ở trang chi tiết
 * đề xuất, xem `resolveApproverStepsWithMeta()` trong lib/server/requests.ts. */
export interface ApproverStepMeta {
  name?: string;
  slaHours?: number;
  /** Mã bước — dùng để khớp `ApprovalTimeField.approverStepCode` lúc người
   * duyệt mở hộp thoại quyết định (xem RequestDetailView.tsx). */
  code?: string;
}

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
  /** Danh sách người theo dõi CHỈ được thêm khi nhóm điều kiện tương ứng thoả
   * mãn lúc gửi chính thức — hợp cùng `followers` (cố định) + người gửi tự thêm. */
  followersConditional?: { condition: ConditionGroup; users: TaggedUser[] }[];
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
  /** Người tạo nhóm — set 1 LẦN lúc tạo (`POST /api/groups`), KHÔNG cho sửa
   * lại qua PATCH sau đó. Nhóm tạo trước change này không có field này →
   * UI hiển thị "—" (xem cùng pattern `PrintTemplate.createdBy` đã có). */
  createdBy?: { uid: string; name: string };
  /** "Mẫu form phê duyệt" — mảng RIÊNG, KHÔNG trộn vào `fields` (vốn đúng
   * nghĩa "người GỬI điền"). Đọc LIVE (không snapshot) mỗi khi người duyệt mở
   * hộp thoại quyết định — xem `ApprovalTimeField`. */
  approvalTimeFields?: ApprovalTimeField[];
  /** 7 cờ phân quyền thật — thay phần hiển thị tĩnh cũ ở tab "Tuỳ chỉnh về
   * phân quyền". Thiếu (nhóm cũ) → dùng `DEFAULT_GROUP_PERMISSION_RULES`
   * (tương đương hành vi hiện tại), áp dụng ở từng nơi đọc field này. */
  permissionRules?: GroupPermissionRules;
  /** 3 cờ thông báo CẤP NHÓM — khác "Cài đặt thông báo" cá nhân của từng
   * người dùng (NotificationSettings). `emailNotify` chỉ lưu cấu hình, CHƯA
   * gửi email thật (chưa có hạ tầng). */
  notificationRules?: GroupNotificationRules;
  /** 7 cờ + 2 vị trí QR cho tab "In đề xuất" — CHỈ lưu cấu hình/ẩn-hiện nút,
   * KHÔNG tự sinh PDF/chèn QR thật (PDF chờ capability `pdf-export` riêng). */
  printOptions?: GroupPrintOptions;
}

/**
 * 7 cờ phân quyền thật ở cấp nhóm — xem design.md của change
 * add-base-vn-approver-and-approval-form-parity, Decision #5.
 */
export interface GroupPermissionRules {
  /** Ảnh Base chỉ thấy 1 giá trị đang chọn, chưa chắc đủ 2 — xem Open Questions #1. */
  followersEditableBy: "system_owners_only" | "all_viewers";
  creatorCanAddButNotRemoveDefaultFollowers: boolean;
  autoAddSubtaskAssigneesAsFollowers: boolean;
  /** Áp dụng logic thật: chặn sửa/xoá bình luận khi đề xuất đã có ≥1 quyết
   * định duyệt — xem app/api/requests/[id]/comments/[commentId]/route.ts. */
  lockCommentsAfterFirstDecision: boolean;
  /** Áp dụng logic thật: ẩn/hiện nút "Xuất Excel" ở app/request/list/page.tsx
   * cho người CHỈ có vai trò follower (không phải chủ/Owner/Admin). */
  defaultFollowersCanExportData: boolean;
  /** Như trên, cho người CHỈ có vai trò approver. */
  defaultApproversCanExportData: boolean;
  /** Cho phép người duyệt dùng "Chuyển tiếp và Duyệt" (đưa người khác xử lý
   * TRƯỚC — vd A chưa hiểu rõ đề xuất, chuyển cho B hiểu rõ hơn duyệt trước,
   * trách nhiệm đầu tiên là B, B xong quay lại A, rồi mới tới người kế tiếp)
   * — Sếp chốt ý nghĩa + xác nhận cần làm thật 24/08/2026, xem ForwardModal.tsx.
   * Mặc định TRUE — trước khi có cờ này, hành động "Chuyển tiếp và Duyệt"
   * LUÔN được phép với mọi nhóm, không có cách nào tắt; giữ mặc định TRUE để
   * không mất tính năng đang chạy cho nhóm cũ, admin có thể tắt riêng từng
   * nhóm nếu muốn hạn chế. */
  approversCanDelegateApproval: boolean;
}

/** Dùng khi đọc 1 nhóm chưa có `permissionRules` (tạo trước change này) —
 * đúng hành vi HIỆN TẠI của app, không đổi gì cho nhóm cũ. */
export const DEFAULT_GROUP_PERMISSION_RULES: GroupPermissionRules = {
  followersEditableBy: "all_viewers",
  creatorCanAddButNotRemoveDefaultFollowers: false,
  autoAddSubtaskAssigneesAsFollowers: false,
  lockCommentsAfterFirstDecision: false,
  defaultFollowersCanExportData: false,
  defaultApproversCanExportData: false,
  approversCanDelegateApproval: true,
};

/** 3 cờ thông báo cấp nhóm — xem design.md Decision #6. */
export interface GroupNotificationRules {
  sequentialTurnBasedNotify: boolean;
  perStepBlockNotify: boolean;
  /** CHỈ lưu cấu hình — chưa gửi email thật (chưa có hạ tầng). */
  emailNotify: boolean;
}

/** 2 cờ đầu mặc định `true` vì tả ĐÚNG hành vi thông báo hiện tại của app
 * (NotificationBell/canApproverAct) — không phải bật thêm gì mới. */
export const DEFAULT_GROUP_NOTIFICATION_RULES: GroupNotificationRules = {
  sequentialTurnBasedNotify: true,
  perStepBlockNotify: true,
  emailNotify: false,
};

/** 7 cờ + 2 vị trí QR cho tab "In đề xuất" — xem design.md Decision #7. Mặc
 * định TẤT CẢ cờ `true` khi thiếu (nhóm cũ) để giữ hành vi "In theo mẫu" hiện
 * tại vẫn hoạt động bình thường. */
export interface GroupPrintOptions {
  allowPrintProposal: boolean;
  allowPrintProposalWithDiscussion: boolean;
  allowPrintToWord: boolean;
  /** Cờ có thể bật nhưng nút PDF thật chỉ hoạt động khi capability riêng
   * `pdf-export` (change add-pdf-export, đang chờ Sếp chốt hạ tầng) hoàn tất. */
  allowPrintToPdf: boolean;
  allowPrintWithQrCode: boolean;
  allowPrintAttachmentWithQrCode: boolean;
  allowPrintCustomFieldFileWithQrCode: boolean;
  /** Ảnh Base chỉ thấy "Trên - Trái" — để mở (string) tới khi có đủ danh sách,
   * xem Open Questions #2. QR thật CHƯA triển khai, đây chỉ là cấu hình. */
  customFieldQrPosition?: string;
  attachmentQrPosition?: string;
}

/** Mọi cờ `true` — giữ đúng hành vi hiện tại ("In theo mẫu" .docx vẫn hoạt
 * động bình thường cho nhóm chưa cấu hình gì). */
export const DEFAULT_GROUP_PRINT_OPTIONS: GroupPrintOptions = {
  allowPrintProposal: true,
  allowPrintProposalWithDiscussion: true,
  allowPrintToWord: true,
  allowPrintToPdf: true,
  allowPrintWithQrCode: true,
  allowPrintAttachmentWithQrCode: true,
  allowPrintCustomFieldFileWithQrCode: true,
};

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
  /** Bình luận trả lời cũ (dữ liệu lịch sử) từng trỏ về 1 bình luận gốc — tính
   * năng "Trả lời" đã bị BỎ (24/08/2026, xem design.md), không còn đường tạo
   * `parentId` mới qua UI. Giữ field lại chỉ để không phá dữ liệu cũ nếu đã
   * có bình luận trả lời thật trên production; hiển thị luôn coi mọi bình
   * luận là ngang hàng, sắp theo `at`. */
  parentId?: string | null;
  /** Có giá trị nếu tác giả đã sửa lại nội dung sau khi gửi — KHÔNG dùng để
   * tính lại hạn 10 phút sửa/xóa (luôn tính từ `at` gốc, xem design.md). */
  editedAt?: string;
  /** Tối đa 1 file/bình luận, tải qua /api/uploads (R2) — tái dùng type đã có,
   * không tạo type mới. Chịu chung hạn 10 phút của cả bình luận (không có API
   * xóa/thay file riêng). */
  attachment?: RequestAttachment | null;
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
  /** Tên bước + SLA riêng bước, cùng thứ tự/độ dài với `approversSnapshot` —
   * optional vì đề xuất tạo trước change add-base-vn-approver-and-approval-form-parity
   * không có field này (UI tự rơi về "Bước N" khi thiếu, xem RequestDetailView.tsx). */
  approverStepMeta?: ApproverStepMeta[];
  /** Giá trị "Mẫu form phê duyệt" đã điền — key = `ApprovalTimeField.id`, TÁCH
   * BIỆT khỏi `values` (dữ liệu form gửi ban đầu của người GỬI). */
  approvalTimeValues?: Record<string, unknown>;
  /** Uid những người đã đánh dấu đề xuất này quan trọng — THEO TỪNG NGƯỜI XEM
   * (không phải cờ chung), xem design.md của change
   * add-request-detail-base-parity, capability request-bookmark. */
  bookmarkedByUids?: string[];
  /** Tài liệu đính kèm Ở CẤP ĐỀ XUẤT (khác file đính kèm trong `values` của
   * field kiểu "Tệp tin", 2 danh sách độc lập không gộp chung). */
  attachments?: RequestAttachment[];
  /** uid → thời điểm (ISO) người đó lần cuối MỞ trang chi tiết đề xuất này,
   * hoặc tự thao tác lên nó (duyệt/từ chối/chuyển tiếp/bình luận — hành động
   * nào cũng coi như "đã xem"). Dùng để tính chuông thông báo còn thấy "mới"
   * hay không cho 3 loại vốn không có khái niệm đã đọc (được nhắc tên/đang
   * theo dõi/đã xử lý xong phần mình) — xem design.md của change
   * fix-notification-bell-stale-gaps. */
  viewedAt?: Record<string, string>;
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
  /**
   * Kết quả lần đồng bộ sang App Thu mua GẦN NHẤT — vắng mặt = chưa từng thử (đề xuất
   * không có công trình/vật tư hợp lệ, xem `trichXuatPayloadThuMua`). "failed" là dấu hiệu
   * cho `retryThuMuaSyncNeuLoi()` tự thử lại lần sau có người mở xem đề xuất này — xem
   * `lib/thumua-sync.ts`. Tách field riêng (không chỉ dựa vào `history`) để việc dò "còn ai
   * đồng bộ lỗi" không phải quét chuỗi trong mảng lịch sử.
   */
  thuMuaSyncStatus?: "synced" | "failed";
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
  | "manager_bypassed"
  | "approver_followup";

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
