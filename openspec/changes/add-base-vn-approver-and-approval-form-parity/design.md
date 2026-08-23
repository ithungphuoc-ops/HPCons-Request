## Context

Phần 2 nối tiếp `add-base-vn-group-settings-parity` (đã complete) — change đó cố tình loại 4 mục sidebar (In đề xuất/Phân quyền/Chữ ký điện tử/Thông báo kiểu Base) vì chưa có ảnh tham khảo thật. Sếp đã cung cấp 9 ảnh chụp thật màn "Thiết lập chung" và 4 tab đó của nhóm "14.3. Thanh toán HĐ khác (HP Cons)" trên request.base.vn (qua phiên explore mode 22/08/2026). Change này bao phủ đúng những gì đã XÁC MINH được qua ảnh — phần nào ảnh không cho thấy đủ chi tiết (enum đầy đủ, hành vi biên) được ghi rõ ở Open Questions, không suy đoán.

Kiến trúc giữ nguyên: Firestore (`groups`, `requests`) qua Admin SDK, không có client Firestore trực tiếp. `lib/approval-logic.ts`/`lib/permissions.ts` đã có test bao phủ — không đổi trong change này.

Phát hiện quan trọng lúc khảo sát: đã có 1 change riêng `add-pdf-export` (in-progress, đang chờ Sếp chốt hạ tầng: tự host Gotenberg / SaaS / vẽ PDF bằng JS) sở hữu capability `pdf-export`. Change này KHÔNG đụng vào `pdf-export` — chỉ thêm cờ cấu hình "có cho phép xuất PDF theo mẫu không" ở cấp nhóm, cờ này chưa có tác dụng thật cho tới khi `add-pdf-export` xong.

## Goals / Non-Goals

**Goals:**
- Bước duyệt có tên hiển thị riêng (khác mã máy `code`) và thời hạn xử lý (giờ) riêng từng bước — nhãn hiển thị luôn là "Thời hạn xử lý"/"Hạn xử lý", không dùng chữ viết tắt "SLA" ở bất kỳ đâu hiển thị cho người dùng cuối (Sếp chốt 23/08/2026, áp dụng thống nhất toàn app — không chỉ riêng change này).
- Thêm bước duyệt kiểu "linh động" (`flexible_approver`) — vai trò/nhóm người duyệt Admin tự gán tay, cho phép để trống chưa gán ai.
- Thêm cơ chế "Mẫu form phê duyệt" — field chỉ hiện cho đúng người duyệt lúc xử lý đúng (bước × hành động).
- Thêm "Giải thích trường dữ liệu" (helper text luôn hiện, khác placeholder).
- Thêm 7 cờ phân quyền thật ở cấp nhóm, thay phần hiển thị tĩnh hiện có.
- Thêm cấu hình thông báo ở cấp nhóm (khác cài đặt cá nhân).
- Thêm 7 cờ tuỳ chỉnh loại in + cấu hình vị trí QR — CHỈ lưu cấu hình, không tự sinh PDF/chèn QR thật.
- Thêm `createdBy` cho nhóm đề xuất.

**Non-Goals:**
- KHÔNG triển khai "Chữ ký điện tử" (Sếp xác nhận chưa cần) — không thiết kế field nào cho tab này.
- KHÔNG triển khai import field từ Excel (thấy có ở Base nhưng ngoài yêu cầu Sếp).
- KHÔNG tự làm logic sinh PDF thật (thuộc `add-pdf-export`, đang chờ chốt hạ tầng riêng) hay logic chèn QR code thật vào file in — chỉ lưu cấu hình/hiển thị đúng nút, phần sinh file thật để sau khi có hạ tầng.
- KHÔNG triển khai gửi email thật cho cờ "Thông báo email" — chỉ lưu cấu hình (giống cách "Thời hạn xử lý theo lịch làm việc" đã làm ở change trước — lưu cấu hình trước, áp dụng logic sau).
- KHÔNG đổi `lib/approval-logic.ts`/`lib/permissions.ts`.
- KHÔNG bắt buộc khớp 100% pixel-by-pixel với Base.vn — khớp đúng HÀNH VI và DỮ LIỆU.

## Decisions

### 1. `flexible_approver` — tách kind riêng (Sếp chốt, chọn "Cách B" khi được hỏi)

```ts
export type ApproverStepDef =
  | {
      kind: "fixed";
      name?: string;              // MỚI — nhãn hiển thị (vd "KTTCH"), khác `code`
      user: TaggedUser;
      users?: TaggedUser[];
      code?: string;
      condition?: ConditionGroup;
      slaHours?: number;          // MỚI — thời hạn xử lý riêng bước này (giờ); nhãn hiển thị "Thời hạn xử lý"/"Hạn xử lý", không hiện chữ "SLA"
    }
  | {
      kind: "submitter_manager";
      name?: string;              // MỚI
      code?: string;
      condition?: ConditionGroup;
      slaHours?: number;          // MỚI
    }
  | {
      kind: "flexible_approver";  // MỚI — vai trò/nhóm duyệt Admin tự gán tay
      name: string;               // BẮT BUỘC (không optional) — bước này TỒN TẠI VÌ có tên,
                                   // khác "fixed" vốn có `user` bắt buộc để định danh
      users: TaggedUser[];        // CHO PHÉP RỖNG = "Chưa cài đặt danh sách duyệt"
      code?: string;
      condition?: ConditionGroup;
      slaHours?: number;
    };
```

Lý do tách kind riêng (không gộp vào `fixed` cho phép rỗng): Sếp chọn trực tiếp khi được hỏi 2 phương án — giữ đúng ngữ nghĩa Base thật dùng 2 tiền tố code khác nhau (`flexible_approver_x` vs `fixed_approver_y`), phòng sẵn cho khả năng 2 loại cần xử lý khác nhau sau này (vd chỉ `flexible_approver` mới cho sửa danh sách người mà không cần vào cấu hình nhóm — chưa làm trong change này nhưng kiến trúc không bị kẹt).

**Xử lý bước rỗng lúc gửi đề xuất**: `resolveApproverStepsDetailed()` (`lib/server/requests.ts`) gặp bước `flexible_approver` với `users: []` → BỎ QUA bước đó khỏi danh sách người duyệt thực tế (không chặn gửi đề xuất, không báo lỗi) — tương tự cách bước có `condition` không thoả cũng bị loại. Ghi log cảnh báo phía server (không phải lỗi) để Admin biết có bước "treo" chưa gán người. Rủi ro: 1 nhóm có TẤT CẢ bước đều `flexible_approver` rỗng → đề xuất không có ai duyệt — xử lý bằng validate PHÍA UI (`ApproverStepsEditor.tsx`/màn Thiết lập chung): cảnh báo rõ nếu sau khi loại các bước rỗng, danh sách duyệt cuối cùng trống, KHÔNG chặn lưu nhóm (Admin có thể đang cấu hình dần).

### 2. `slaHours` riêng từng bước — quan hệ với `approverSlaEnabled` cũ

Cờ `approverSlaEnabled` cũ (bật/tắt, chưa áp dụng logic) đổi ý nghĩa thành **"công tắc tổng cho cả nhóm"**: bật thì `computeDeadline()` mỗi bước ưu tiên dùng `step.slaHours` (nếu có) thay cho `group.slaHours` chung; tắt thì mọi bước đều dùng `group.slaHours` chung như hành vi hiện tại (không đổi gì khi nhóm chưa bật). Không đổi tên field, không thêm field cấu hình mới — chỉ đổi Ý NGHĨA khi có dữ liệu `slaHours` thật để dùng. Giữ tương thích ngược hoàn toàn: nhóm cũ không có `slaHours` ở bước nào → hành vi giống hệt trước.

### 3. "Mẫu form phê duyệt" — field gắn (bước × hành động)

```ts
export interface ApprovalTimeField {
  id: string;
  approverStepCode: string;   // tham chiếu ApproverStepDef.code trong CÙNG nhóm
  decisionAction: "approve" | "reject" | "forward" | "approveAndForward"; // trùng requireDecisionNote
  field: Omit<ProposalField, "visibleWhen" | "computedFrom" | "dateLeadTimeRule">; // field thường,
    // loại trừ 3 cơ chế không có ý nghĩa ở đây (điều kiện hiện/tự tính/ngày cần cấp đều thiết kế
    // cho form GỬI, không phải form phê duyệt)
}
```
Lưu ở `ProposalGroup.approvalTimeFields?: ApprovalTimeField[]` (mảng riêng, KHÔNG trộn vào `fields` hiện có của nhóm — `fields` vẫn đúng nghĩa "người GỬI điền", tách bạch rõ 2 khái niệm).

**Chỉ áp dụng cho bước `kind: "fixed"`** trong lần đầu này — đúng như ảnh Base ghi rõ "Trường tùy chỉnh chỉ áp dụng cho khối người duyệt cố định". `flexible_approver`/`submitter_manager` CHƯA hỗ trợ (xem Open Questions #4) — UI dropdown "Liên kết đến (Khối người duyệt)" chỉ liệt kê bước `fixed` của nhóm.

**Hiển thị lúc duyệt**: trang chi tiết đề xuất (`RequestDetailView.tsx`), khi người đang xem là approver của bước `fixed` có `code` khớp `approverStepCode`, VÀ họ đang mở đúng modal hành động khớp `decisionAction` (Chấp thuận/Từ chối/Chuyển tiếp/Chấp thuận và chuyển tiếp) → hiện thêm field đó ngay trong modal xác nhận hành động, bắt buộc điền theo `field.required` trước khi submit quyết định. Giá trị lưu vào `FirestoreRequest.approvalTimeValues?: Record<string, unknown>` (key = `ApprovalTimeField.id`), KHÔNG trộn vào `values` (dữ liệu form gửi ban đầu).

### 4. `helpText` — độc lập với `placeholder`, không thêm validate ký tự đặc biệt

`ProposalField.helpText?: string` — hiển thị dưới ô nhập (giống style `<p className="text-xs text-gray-400">` đã dùng cho các dòng phụ khác trong app), KHÔNG áp dụng validate "chặn ký tự đặc biệt <, >, ;" mà ảnh Base gợi ý — đây là placeholder-text CỦA CHÍNH Ô "Giải thích trường dữ liệu" khi Admin đang nhập (tức nhắc Admin không gõ ký tự đó VÀO đoạn giải thích), không phải rule validate cho GIÁ TRỊ người dùng cuối điền vào field. Quyết định: chỉ lưu chuỗi thường, sanitize cơ bản (trim, cắt độ dài hợp lý ~300 ký tự) khi lưu — không cần thư viện sanitize-html vì đây là text thường, không phải rich text.

### 5. 7 cờ phân quyền nhóm — `ProposalGroup.permissionRules`

```ts
export interface GroupPermissionRules {
  followersEditableBy: "system_owners_only" | "all_viewers"; // xem Open Questions #1 (enum có thể thiếu giá trị)
  creatorCanAddButNotRemoveDefaultFollowers: boolean;
  autoAddSubtaskAssigneesAsFollowers: boolean;
  lockCommentsAfterFirstDecision: boolean;
  defaultFollowersCanExportData: boolean;
  defaultApproversCanExportData: boolean;
  approversCanDelegateApproval: boolean; // xem Open Questions #3 — có thể trùng/khác "Chuyển tiếp"
}
```
Thay hẳn nội dung tĩnh hiện có ở tab "Tuỳ chỉnh về phân quyền" (4 câu mô tả cố định) bằng form thật đọc/ghi object này. Field thiếu (nhóm cũ) → dùng default an toàn: `followersEditableBy: "all_viewers"`, còn lại đều `false`/tương đương hành vi HIỆN TẠI (không đổi hành vi nhóm cũ khi chưa ai bật gì).

**`defaultFollowersCanExportData`/`defaultApproversCanExportData`**: kiểm soát việc HIỆN nút "Xuất Excel" ở trang Danh sách đề xuất (`app/request/list/page.tsx`) cho người CHỈ có vai trò follower/approver (không phải chủ đề xuất/Admin/Owner) trên các đề xuất thuộc nhóm đó — hiện nút này không phân biệt vai trò, cờ mới thêm điều kiện ẩn/hiện theo đúng 2 cờ này.

### 6. Thông báo theo nhóm — `ProposalGroup.notificationRules`

```ts
export interface GroupNotificationRules {
  sequentialTurnBasedNotify: boolean; // cờ 1 — bật quy tắc thông báo mô tả dài của Base
  perStepBlockNotify: boolean;        // cờ 2
  emailNotify: boolean;               // cờ 3 — CHỈ LƯU, chưa gửi email thật
}
```
`sequentialTurnBasedNotify`/`perStepBlockNotify` mô tả hành vi thông báo ĐÃ ĐÚNG với cách `pushNotify`/chuông thông báo hiện tại đang hoạt động (người duyệt chỉ thấy trong "Cần tôi duyệt" khi tới lượt mình theo `canApproverAct`) — 2 cờ này ban đầu chỉ LƯU cấu hình, hành vi thực tế hiện tại của app đã gần khớp mô tả mặc định, chưa cần đổi code thông báo ngay (ghi rõ Non-Goal, tránh rủi ro đổi luồng thông báo đang chạy ổn).

### 7. Cờ tuỳ chỉnh in — `ProposalGroup.printOptions`

```ts
export interface GroupPrintOptions {
  allowPrintProposal: boolean;
  allowPrintProposalWithDiscussion: boolean;
  allowPrintToWord: boolean;
  allowPrintToPdf: boolean;        // chờ add-pdf-export — cờ có thể bật nhưng nút PDF thật
                                     // chỉ hoạt động khi add-pdf-export xong
  allowPrintWithQrCode: boolean;
  allowPrintAttachmentWithQrCode: boolean;
  allowPrintCustomFieldFileWithQrCode: boolean;
  customFieldQrPosition?: "top_left" | string; // xem Open Questions #2 — enum chưa đủ
  attachmentQrPosition?: "top_left" | string;
}
```
Mặc định mọi cờ `true` (giữ hành vi hiện tại — "In theo mẫu" .docx vẫn hoạt động bình thường cho nhóm chưa cấu hình gì).

## Risks / Trade-offs

- [Rủi ro] `ApproverStepDef` thêm case `flexible_approver` — code cũ dùng `switch(step.kind)` không đủ case sẽ bị TypeScript bắt lỗi (exhaustiveness), nhưng code dùng `if (step.kind === "fixed")` rồi fallback không kiểm hết sẽ ÂM THẦM bỏ qua bước mới → Mitigation: grep toàn bộ `step.kind` trước khi merge, ưu tiên sửa về dạng `switch` có `default: assertNever` nếu khả thi.
- [Rủi ro] Bỏ qua bước `flexible_approver` rỗng lúc gửi có thể khiến 1 đề xuất "tưởng đã gửi cho đủ người" nhưng thực ra thiếu 1 bước → Mitigation: cảnh báo rõ ở UI cấu hình nhóm (Quyết định #1) + hiển thị badge "Chưa cài đặt danh sách duyệt" y hệt Base để Admin dễ nhận ra.
- [Rủi ro] `approvalTimeFields` là mảng riêng trên `ProposalGroup`, không validate chồng chéo (2 field cùng `approverStepCode`+`decisionAction` bị trùng) → Mitigation: validate ở API route (PATCH group), báo lỗi rõ nếu trùng.
- [Đánh đổi] Không hỗ trợ `approvalTimeFields` cho `flexible_approver`/`submitter_manager` ngay — nếu Sếp cần sau, mở rộng field `approverStepCode` để tham chiếu đúng cả 2 kind (dữ liệu đã có `code` sẵn cho mọi kind, không cần đổi shape thêm).
- [Đánh đổi] `printOptions`/`notificationRules.emailNotify` chỉ lưu cấu hình chưa áp dụng logic thật — Sếp cần biết bật cờ không có nghĩa tính năng đã "chạy", tránh hiểu nhầm khi demo cho người dùng cuối.

## Migration Plan

1. Deploy code mới — mọi field thêm đều optional (trừ `flexible_approver.name`/`users` bắt buộc NHƯNG chỉ áp dụng cho bước MỚI TẠO, không có bước cũ nào thuộc kind này để migrate).
2. Backfill `name` cho bước `fixed`/`submitter_manager` cũ: KHÔNG backfill tự động giá trị (không có nguồn dữ liệu đúng để suy ra tên) — để trống, UI hiển thị "Bước {index+1}" như hiện tại khi thiếu `name` (giữ đúng hành vi cũ).
3. `permissionRules`/`notificationRules`/`printOptions` thiếu ở nhóm cũ → áp dụng default ở tầng đọc (`toProposalGroup()`), không cần ghi ngược vào Firestore.

## Open Questions

1. **Enum đầy đủ của "Quyền được chỉnh sửa danh sách người theo dõi"** — ảnh chỉ thấy 1 giá trị đang chọn ("Tất cả người dùng có thể xem đề xuất đều có t..."), không thấy hết list khi bấm mở dropdown. Tạm thiết kế 2 giá trị hợp lý nhất (`system_owners_only`/`all_viewers`) — CẦN Sếp xác nhận/chụp thêm dropdown mở ra nếu có giá trị khác.
2. **Enum đầy đủ vị trí QR code** — ảnh chỉ thấy "Trên - Trái". Tạm để kiểu `string` mở (không enum cứng) cho tới khi có đủ danh sách, tránh chặn code vì thiếu 1 giá trị.
3. **"Cho phép người duyệt chuyển quyền duyệt cho người khác" có phải cùng khái niệm với "Chuyển tiếp" (ForwardModal) đã có?** Tạm coi là 2 khái niệm KHÁC NHAU trong thiết kế này: "Chuyển tiếp" hiện có là hành động 1-lần trên 1 đề xuất cụ thể (đã có sẵn, không đổi); cờ mới `approversCanDelegateApproval` tạm hiểu là "uỷ quyền dài hạn" (đổi hẳn ai là approver mặc định của họ cho các đề xuất SAU này) — NHƯNG chưa có cơ chế UI/data nào cho "uỷ quyền dài hạn" trong app hiện tại, nên trong change này cờ này CHỈ LƯU CẤU HÌNH (giống notificationRules.emailNotify), KHÔNG triển khai hành vi thật cho tới khi Sếp xác nhận đúng ý nghĩa.
4. **`approvalTimeFields` có cần mở rộng cho `flexible_approver`/`submitter_manager` không?** Tạm CHỈ hỗ trợ `fixed` (khớp đúng ảnh Base), để ngỏ mở rộng sau.
5. **Thời hạn xử lý riêng bước có cần TÍNH LẠI mỗi khi đề xuất chuyển sang bước duyệt tiếp theo không** (luồng "Lần lượt" nhiều bước, mỗi bước thời hạn khác nhau)? Đã triển khai phần AN TOÀN (tính 1 lần lúc gửi, dùng thời hạn của bước ĐẦU TIÊN — xem `resolveInitialSlaHours()`); phần "làm mới đồng hồ đếm ngược mỗi lần sang bước mới" CHƯA làm vì đụng `/api/requests/[id]/decision` và ảnh hưởng trực tiếp badge "Quá hạn" đang chạy thật — cần Sếp xác nhận rõ hành vi mong muốn trước khi triển khai.
