## Why

`add-base-vn-group-settings-parity` (đã complete) cố tình loại 4 mục khỏi phạm vi vì lúc đó chưa có ảnh tham khảo thật: "In đề xuất kiểu Base, Tuỳ chỉnh phân quyền kiểu Base, Chữ ký điện tử, Thông báo theo nhóm". Sếp vừa cung cấp đủ ảnh chụp thật (9 ảnh, nhóm "14.3. Thanh toán HĐ khác (HP Cons)" trên request.base.vn) — đủ cơ sở để làm phần 2, đồng thời lộ ra thêm nhiều khoảng cách khác chưa từng ghi nhận ở "Người duyệt" (tên bước, kiểu bước "linh động", thời hạn xử lý riêng từng bước) và 1 khái niệm hoàn toàn mới "Mẫu form phê duyệt" (field chỉ hiện cho người duyệt lúc xử lý). Sếp xác nhận những khoảng cách này "ảnh hưởng đến người dùng nhiều" và muốn làm đủ 1 lần.

## What Changes

- Mở rộng `ApproverStepDef`: thêm `name?: string` (nhãn hiển thị, vd "QL BP", "KTTCH" — khác `code` là mã máy) cho mọi kind hiện có; thêm `slaHours?: number` riêng từng bước (khác `ProposalGroup.slaHours` chung và cờ `approverSlaEnabled` cũ). **BREAKING**: đổi shape `ApproverStepDef`, cần backfill ngầm giống cách `code` đã làm.
- Thêm **1 kind bước duyệt mới**: `flexible_approver` — 1 "vai trò/nhóm duyệt" do Admin tự gán tay nhiều người (giống cơ chế `users[]` của bước `fixed` đã có), nhưng CHO PHÉP `users: []` (rỗng) = trạng thái "Chưa cài đặt danh sách duyệt" (đúng trạng thái thật thấy ở Base). `ApproverStepsEditor.tsx` thêm đủ 5 lựa chọn khi bấm "+ Thêm" (cố định / nhiều người cố định / quản lý trực tiếp / **linh động** [mới] / theo điều kiện).
- Thêm `ProposalGroup.createdBy: { uid, name }` — "Tạo bởi", set 1 lần lúc tạo nhóm (field cũ = không có, hiển thị "—").
- Thêm khái niệm mới **"Mẫu form phê duyệt"**: field tuỳ chỉnh gắn vào (1 bước duyệt × 1 hành động duyệt cụ thể: chấp thuận/từ chối/chuyển tiếp/chấp thuận và chuyển tiếp) — chỉ hiện ra cho đúng người xử lý đúng bước đó khi họ thực hiện đúng hành động đó. Ban đầu chỉ áp dụng cho bước kiểu `fixed` (đúng như Base ghi rõ "chỉ áp dụng cho khối người duyệt cố định" — xem Open Questions).
- Thêm `ProposalField.helpText?: string` — "Giải thích trường dữ liệu": 1 dòng chữ giải thích LUÔN HIỂN THỊ (khác `placeholder`, biến mất khi gõ).
- Thêm 7 cờ **phân quyền nhóm thật** (`ProposalGroup.permissionRules`), thay hẳn phần hiện đang hiển thị tĩnh 4 câu mô tả cố định ở tab "Tuỳ chỉnh về phân quyền".
- Thêm cấu hình **thông báo theo nhóm** (`ProposalGroup.notificationRules`, 3 cờ) — khái niệm mới, khác "Cài đặt thông báo" cá nhân người dùng đã có (`/request/settings/notifications`). Cờ "Thông báo email" chỉ lưu cấu hình, KHÔNG có hạ tầng gửi email thật trong change này.
- Thêm 7 cờ **tuỳ chỉnh loại in** (`ProposalGroup.printOptions`) + cấu hình vị trí QR code — CHỈ lưu cấu hình/kiểm soát hiển thị nút, KHÔNG bao gồm logic sinh PDF thật (thuộc change riêng `add-pdf-export`, đang chờ chốt hạ tầng) hay logic chèn QR thật vào file in (ngoài phạm vi, xem Non-Goals ở design.md).
- **KHÔNG đưa vào change này**: "Chữ ký điện tử" (Sếp xác nhận chưa cần, chỉ ghi nhận tab này có thật bên Base để dành sau), import field từ Excel (thấy có thật ở Base nhưng ngoài yêu cầu ban đầu của Sếp).

## Capabilities

### New Capabilities
- `flexible-approver-step`: bước duyệt kiểu "linh động" — 1 vai trò/nhóm người duyệt Admin tự gán tay, có thể rỗng (chưa gán ai), có tên hiển thị riêng.
- `approval-time-fields`: field tuỳ chỉnh chỉ hiện cho người duyệt lúc xử lý đúng (bước × hành động) cụ thể — "Mẫu form phê duyệt".
- `field-help-text`: dòng giải thích luôn hiển thị cho 1 trường dữ liệu, khác `placeholder`.
- `group-permission-rules`: 7 cờ phân quyền thật ở cấp nhóm đề xuất.
- `group-notification-rules`: cấu hình thông báo ở cấp nhóm đề xuất (khác cài đặt cá nhân).
- `print-customization-options`: 7 cờ tuỳ chỉnh loại in + cấu hình vị trí QR code (chỉ lưu cấu hình/kiểm soát hiển thị, không gồm logic sinh file thật).

### Modified Capabilities
- `approver-steps`: thêm `name` (nhãn hiển thị) cho mọi kind bước duyệt hiện có, thêm `slaHours` riêng từng bước.
- `group-settings`: thêm `createdBy` (Tạo bởi).

## Impact

- **Data model** (`lib/types.ts`): `ApproverStepDef` đổi shape (thêm `name?`, `slaHours?`, thêm case `flexible_approver`); `ProposalGroup` thêm `createdBy`, `permissionRules?`, `notificationRules?`, `printOptions?`; `ProposalField` thêm `helpText?`.
- **API**: `app/api/groups/[id]/route.ts` (PATCH) nhận thêm các field mới; route mới hoặc mở rộng cho field "Mẫu form phê duyệt" (gắn vào bước+hành động).
- **UI**: `components/request/ApproverStepsEditor.tsx` (menu "+ Thêm" đủ 5 lựa chọn, ô thời hạn xử lý/tên riêng từng bước — nhãn hiển thị không dùng chữ "SLA"), `app/request/groups/[groupId]/(settings)/general/page.tsx`, `components/request/modals/AddFieldModal.tsx` (thêm `helpText` + 2 field mới khi ở chế độ "Mẫu form phê duyệt"), trang "Tuỳ chỉnh về phân quyền" (đổi từ tĩnh sang form thật), trang "In đề xuất" (thêm khối 7 cờ + QR), trang "Thông báo" (tab mới trong sidebar cấu hình nhóm).
- **Request submission/decision**: `lib/server/requests.ts` (`resolveApproverStepsDetailed` xử lý `flexible_approver`, bỏ qua bước có `users: []`), `app/api/requests/[id]/decision/route.ts` (đọc field "Mẫu form phê duyệt" đúng bước+hành động đang xử lý).
- **Phụ thuộc ngoài change này**: `add-pdf-export` (đang in-progress, chờ chốt hạ tầng) — cờ "In đề xuất theo mẫu ra file pdf" trong `printOptions` chỉ thật sự có tác dụng khi `add-pdf-export` hoàn tất; change này không tự triển khai lại phần đó.
- **Migration**: `ApproverStepDef.name`/`slaHours` optional, backfill ngầm giống `code` (không cần script chạy tay). `ProposalGroup.createdBy` cho nhóm cũ = `null`/thiếu, hiển thị "—".
- **Test**: không đổi `lib/approval-logic.ts`/`lib/permissions.ts`.
