## 1. Người duyệt — tên bước, thời hạn xử lý riêng bước, bước duyệt linh động

- [x] 1.1 Đổi `ApproverStepDef` trong `lib/types.ts`: thêm `name?: string`, `slaHours?: number` cho `fixed`/`submitter_manager`; thêm kind mới `flexible_approver` (`name: string`, `users: TaggedUser[]` cho phép rỗng, `code?`, `condition?`, `slaHours?`)
- [x] 1.2 Grep toàn bộ `step.kind`/`.kind === "fixed"`/`.kind === "submitter_manager"` trong repo, xác nhận mọi chỗ xử lý đủ case mới (đặc biệt `lib/server/requests.ts`, `components/request/ApproverStepsEditor.tsx`) — ưu tiên đổi sang `switch` có nhánh mặc định báo lỗi rõ nếu gặp kind lạ. Đã sửa thêm: `app/request/groups/[groupId]/submit/page.tsx` (ternary 2 nhánh cũ coi "không phải fixed" = submitter_manager — lỗi ẩn thật), `app/request/groups/page.tsx` (bulk "thay người duyệt" giờ áp dụng cả cho `flexible_approver.users`), `lib/print-template.ts` (`ensureApproverStepCodes` sinh mã cho kind mới, slug từ `name`).
- [x] 1.3 Sửa `resolveApproverStepsDetailed()`/`resolveApproverSteps()`: bước `flexible_approver` với `users: []` bị loại khỏi danh sách người duyệt thực tế (không lỗi); nếu sau khi loại (kể cả do điều kiện) danh sách rỗng thì báo lỗi như hành vi hiện có với bước có điều kiện không thoả. Thêm `assertNeverApproverKind()` (lib/approval-logic.ts) để bắt lỗi biên dịch nếu sau này thêm kind mới mà quên xử lý.
- [x] 1.4 `ApproverStepsEditor.tsx`: đổi từ nút toggle 2 trạng thái sang `<select>` 3 kind (Cố định/Quản lý trực tiếp/Linh động) + 3 nút "+ Thêm" theo từng kind; ô nhập tên riêng cho từng bước (mọi kind); ô SLA (giờ) riêng từng bước (mọi kind); hiển thị "Chưa cài đặt danh sách duyệt" khi bước linh động rỗng. **Lược bớt so với mô tả gốc**: không tách riêng "nhiều người cố định" khỏi "cố định" (cùng 1 kind, TagUserInput đã multi-select sẵn) và không có nút "+ Thêm theo điều kiện" riêng (điều kiện là checkbox có sẵn trên MỌI bước qua `ConditionEditor`, không phải 1 loại bước riêng) — vẫn đủ 3 kind dữ liệu thật, chỉ khác cách trình bày so với demo HTML ban đầu.
- [x] 1.5 Sửa nơi tính hạn xử lý LÚC GỬI đề xuất (2 chỗ gọi `computeDeadline()`): khi `group.approverSlaEnabled` bật và BƯỚC ĐẦU TIÊN có `slaHours`, dùng `slaHours` của bước đó; ngược lại dùng `group.slaHours` như hiện tại (hàm mới `resolveInitialSlaHours()`). **CHƯA làm — cần Sếp xác nhận riêng**: tính lại deadline MỚI mỗi khi đề xuất chuyển sang bước duyệt tiếp theo (luồng "Lần lượt" nhiều bước, mỗi bước SLA khác nhau) — việc này đụng `/api/requests/[id]/decision` và ảnh hưởng trực tiếp badge "Quá hạn" đang chạy thật trên production, rủi ro cao nếu đoán sai hành vi mong muốn. Xem ghi chú tại `resolveInitialSlaHours()` trong lib/server/requests.ts.
- [x] 1.6 Cập nhật trang chi tiết đề xuất: hiển thị tên bước (nếu có) thay tên người dưới mỗi dòng "Người xét duyệt", kèm "Hạn xử lý: X giờ" nếu bước có `slaHours` riêng. Thêm `RequestInstance.approverStepMeta` (mảng song song `approversSnapshot`, lưu tại thời điểm gửi) + `resolveApproverStepsWithMeta()`/`dedupeApproversWithMeta()` để không phải resolve lại Firestore 2 lần.
- [x] 1.7 Viết test (`lib/server/requests.test.ts`, mới — file này trước đây CHƯA có test nào vì có `import "server-only"` + gọi Firestore thật; đã thêm `vi.mock("server-only")` + mock `getHpcoreDb()` để test được mà không gọi mạng thật): bỏ qua bước linh động rỗng ✓, chặn gửi khi mọi bước đều rỗng ✓, SLA riêng bước có/không bật cờ tổng ✓ (4 trường hợp). 9/9 test pass, không ảnh hưởng 191 test cũ của toàn repo.

## 2. Tạo bởi (createdBy)

- [x] 2.1 Thêm `createdBy?: { uid, name }` vào `ProposalGroup` (`lib/types.ts`)
- [x] 2.2 Set `createdBy` lúc tạo nhóm mới (`POST /api/groups`) từ session hiện tại — PATCH nhóm (`app/api/groups/[id]/route.ts`) chủ động `delete patch.createdBy` để không tin client, không sửa lại được sau khi tạo
- [x] 2.3 Hiển thị "Tạo bởi: {tên}" (hoặc "—" nếu thiếu) ở đầu trang cài đặt chung nhóm

## 3. Mẫu form phê duyệt (approval-time fields)

- [x] 3.1 Thêm `ApprovalTimeField` (id, approverStepCode, decisionAction, field) và `ProposalGroup.approvalTimeFields?: ApprovalTimeField[]` vào `lib/types.ts`
- [x] 3.2 Thêm `RequestInstance.approvalTimeValues?: Record<string, unknown>` — tách biệt khỏi `values`
- [x] 3.3 UI mới "Mẫu form phê duyệt" — khối phụ trong trang "Mẫu biểu đề xuất" (`(settings)/form/page.tsx`), dưới danh sách field thường. **Lược bớt so với mô tả gốc**: viết 1 modal RIÊNG (`ApprovalTimeFieldModal.tsx`) thay vì mở rộng `AddFieldModal` — `AddFieldModal`/`RequestContext.addField()` gắn cứng vào `group.fields`, mở rộng để viết cả vào `group.approvalTimeFields` (shape khác — bọc thêm `approverStepCode`/`decisionAction`) rủi ro cao hơn tự viết modal mới cùng style. Có đủ 2 ô mới: "Liên kết đến (Khối người duyệt)" (chỉ liệt kê bước `kind: "fixed"`), "Thuộc phần duyệt" (4 lựa chọn khớp `requireDecisionNote`). Loại dữ liệu giới hạn 9 loại hợp lý cho nhập nhanh lúc duyệt (không có bảng/tệp/công thức/chọn người/chọn phòng ban).
- [x] 3.4 Validate ở API PATCH nhóm (`app/api/groups/[id]/route.ts`): chặn trùng (`approverStepCode`, `decisionAction`) giữa 2 field, báo lỗi rõ
- [x] 3.5 Sửa modal thực hiện quyết định ở `RequestDetailView.tsx`: "Chấp thuận" (trước đây bấm 1 lần xong luôn, KHÔNG có modal nào) giờ mở `ApproveConfirmModal` (mới) khi có field khớp; `ReasonModal`/`ForwardModal` (đã có) mở rộng thêm prop `extraField`/`extraFieldByMode` để hiện field khớp ngay trong modal cũ, không tạo modal riêng cho reject/forward. Field control dùng chung (`ApprovalTimeFieldControl.tsx`, mới) cho cả 3 nơi.
- [x] 3.6 Sửa `app/api/requests/[id]/decision/route.ts`: server TỰ xác định lại field khớp từ `current.approverStepMeta` (không tin `body.approvalTimeFieldId`/`approvalTimeValue` của client ngoài giá trị nhập), validate bắt buộc, lưu vào `approvalTimeValues` (merge, không đè `values`)
- [x] 3.7 Hiển thị khu vực riêng "Thông tin phê duyệt" (approvalTimeValues) ở trang chi tiết đề xuất, tách biệt khối "Thông tin khác (mẫu đăng ký đề xuất)" — tra tên field từ `approvalTimeFields` đọc live, hiện "Trường đã xoá" nếu field gốc không còn
- [x] 3.8 Viết test (`lib/approval-logic.test.ts`, thêm — đã tách `isApprovalTimeValueMissing`/`DECISION_TO_APPROVAL_TIME_ACTION` thành hàm thuần dùng chung client+server để test được không cần mock Firestore): quy đổi đúng 4/5 quyết định ✓, field bắt buộc thiếu/đủ đúng các trường hợp biên (0, mảng rỗng, chuỗi rỗng) ✓. **Chưa test được**: phần "hiện đúng lúc đúng bước+hành động" ở UI/route thật (đòi hỏi mock Firestore + toàn bộ luồng canApproverAct — để lại cho kiểm thử thủ công ở 8.3).

## 4. Giải thích trường dữ liệu (helpText)

- [x] 4.1 Thêm `helpText?: string` vào `ProposalField` (`lib/types.ts`) + `sanitizeHelpText()` (`lib/validation.ts`, trim + cắt 300 ký tự) áp dụng ở PATCH nhóm
- [x] 4.2 Thêm ô "Giải thích trường dữ liệu" vào `AddFieldModal.tsx` (mọi loại field, không giới hạn theo dataType)
- [x] 4.3 Hiển thị `helpText` (nếu có) ở `FieldRow` trong `submit/page.tsx`, luôn hiện, không phụ thuộc giá trị đã điền hay chưa

## 5. Phân quyền nhóm (7 cờ thật)

- [x] 5.1 Thêm `GroupPermissionRules` + `DEFAULT_GROUP_PERMISSION_RULES` + `ProposalGroup.permissionRules?: GroupPermissionRules` vào `lib/types.ts` (7 cờ, xem design.md Decision #5)
- [x] 5.2 Đổi trang "Tuỳ chỉnh về phân quyền" (`(settings)/permissions/page.tsx`) từ nội dung tĩnh sang form đọc/ghi 7 cờ qua PATCH nhóm
- [x] 5.3 Áp dụng `permissionRules.lockCommentsAfterFirstDecision`: chặn sửa/xoá bình luận (API `comments/[commentId]/route.ts`) khi đề xuất đã có ít nhất 1 quyết định duyệt — khoá NÀY ĐÈ LÊN mọi quyền khác (kể cả tác giả trong 10 phút, kể cả Owner)
- [x] 5.4 Áp dụng `defaultFollowersCanExportData`/`defaultApproversCanExportData`: ẩn/hiện nút "Xuất Excel" ở `app/request/list/page.tsx`. **Giới hạn phạm vi** (ghi rõ trong code): chỉ áp dụng khi `scope=group` (đang xem đúng 1 nhóm, có 1 bộ cờ rõ ràng để áp) — các scope khác (all/mine/sent-to-me/following, trộn nhiều nhóm) giữ hành vi cũ (luôn hiện nút), vì không có 1 bộ cờ duy nhất áp được cho danh sách trộn nhiều nhóm.
- [x] 5.5 Áp dụng `creatorCanAddButNotRemoveDefaultFollowers`/`autoAddSubtaskAssigneesAsFollowers`/`followersEditableBy` vào submit/page.tsx + `mergeFollowers()`. **Diễn giải cần Sếp xem lại** (không có ảnh Base minh chứng hành vi chính xác): (a) `followersEditableBy=system_owners_only` → người gửi thường chỉ XEM danh sách theo dõi, không sửa được (Owner/Admin vẫn sửa được); (b) `creatorCanAddButNotRemoveDefaultFollowers` → hợp lại người theo dõi mặc định nếu bị bỏ (chưa có UI khoá riêng từng chip, chip vẫn hiện nút xoá nhưng người đó sẽ hiện lại ngay); (c) `autoAddSubtaskAssigneesAsFollowers` → app này không có khái niệm "công việc con" riêng, diễn giải thành field kiểu "user_select" (người được chọn/giao trong đề xuất) tự động thêm vào người theo dõi lúc gửi chính thức.
- [x] 5.6 `approversCanDelegateApproval`: CHỈ lưu cấu hình, không triển khai hành vi thật (xem design.md Open Questions #3) — ghi rõ trong UI là "chưa áp dụng" (nhãn ⏳ ngay dưới câu hỏi)
- [x] 5.7 Viết test (`lib/server/conditions.test.ts`, thêm 3 test cho `mergeFollowers()` tham số mới `autoAddUserSelectAssignees`) — khoá bình luận và ẩn/hiện nút xuất gắn trực tiếp vào route/component (Firestore + session + nhiều state UI), để lại cho kiểm thử thủ công ở 8.3 như phần approval-time-fields (3.8) đã gặp cùng giới hạn

## 6. Thông báo theo nhóm

- [x] 6.1 Thêm `GroupNotificationRules` + `DEFAULT_GROUP_NOTIFICATION_RULES` + `ProposalGroup.notificationRules?: GroupNotificationRules` vào `lib/types.ts` (3 cờ)
- [x] 6.2 Thêm mục sidebar "Thông báo" (`GroupDetailNav.tsx` + `(settings)/notifications/page.tsx`, mới) trong trang cài đặt nhóm — form đọc/ghi 3 cờ qua PATCH nhóm
- [x] 6.3 Ghi rõ trong UI: `emailNotify` chỉ lưu cấu hình, chưa gửi email thật (chưa có hạ tầng)

## 7. Tuỳ chỉnh in (cờ cấu hình + vị trí QR — không tự sinh PDF/QR thật)

- [x] 7.1 Thêm `GroupPrintOptions` + `DEFAULT_GROUP_PRINT_OPTIONS` + `ProposalGroup.printOptions?: GroupPrintOptions` vào `lib/types.ts` (7 cờ + 2 vị trí QR, mặc định mọi cờ `true` khi thiếu)
- [x] 7.2 Thêm khối "Tuỳ chỉnh in đề xuất" vào trang "In đề xuất" (`(settings)/print/page.tsx`) — 7 checkbox + 2 cặp chọn vị trí QR (hiện chỉ 1 giá trị "Trên - Trái", xem Open Questions #2)
- [x] 7.3 Áp dụng cờ vào trang chi tiết đề xuất: dropdown "In theo mẫu" (duy nhất nút in ĐÃ CÓ trong code hiện tại) giờ ẩn khi `printOptions.allowPrintToWord = false` — route `print-templates` GET gộp thêm trả `printOptions` (không tạo route riêng). **Phạm vi thực tế**: 6/7 cờ còn lại (allowPrintProposal, allowPrintProposalWithDiscussion, allowPrintWithQrCode...) CHƯA có nút/menu tương ứng trong code hiện tại — các nút đó thuộc change `add-request-detail-base-parity` (mới lập kế hoạch, CHƯA code) — người triển khai change đó cần đọc lại đúng `group.printOptions` này khi làm, không tạo cờ trùng.
- [x] 7.4 Ghi rõ (UI + code comment) `allowPrintToPdf` chờ capability `pdf-export` (change riêng, đang in-progress) hoàn tất mới có tác dụng thật; QR code thật chưa triển khai trong change này
- [x] 7.5 Không viết test riêng — logic ẩn/hiện nằm trực tiếp trong component (fetch + JSX), cùng giới hạn testability đã gặp ở 3.8/5.7; để lại kiểm thử thủ công ở 8.3

## 8. Xác minh cuối

- [x] 8.1 `npm run build` xanh, không lỗi TypeScript do đổi shape `ApproverStepDef`/thêm field mới
- [x] 8.2 `npm run test -- --run` xanh — 198/198 test pass (191 cũ + 7 mới của change này), `lib/permissions.ts` không đổi, `lib/approval-logic.ts` có thêm hàm mới (không sửa hàm cũ)
- [ ] 8.3 Kiểm thử thủ công trên dev: 1 nhóm có đủ bước fixed (có tên+SLA) + 1 bước linh động rỗng + 1 field Mẫu form phê duyệt + bật vài cờ phân quyền/thông báo/in — gửi 1 đề xuất thật, duyệt qua đủ các bước, xác nhận field phê duyệt hiện đúng lúc, dọn sạch dữ liệu test khỏi Firestore sau khi xong
- [ ] 8.4 Báo cáo rõ với Sếp: phần nào chạy đúng, phần nào dừng ở Open Questions (enum "quyền sửa người theo dõi", enum vị trí QR, ý nghĩa thật của "chuyển quyền duyệt") chưa triển khai đầy đủ vì thiếu thông tin xác nhận — KHÔNG tự ý deploy/push khi chưa được yêu cầu
