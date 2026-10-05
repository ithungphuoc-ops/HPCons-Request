## Why

"Điều chỉnh đề nghị sau duyệt" (`AdjustmentControl`, `app/api/requests/[id]/adjustment/route.ts`) hiện chỉ cho CHÍNH người gửi đề xuất thao tác, và lưu thẳng vào `history` ngay lập tức — không ai kiểm lại nội dung trước khi nó có hiệu lực (và trước khi hệ thống tự báo sang Kho công trình + Thu mua, theo đợt "Liên kết 4 app" 03/10/2026). Sếp muốn mở rộng quyền (người theo dõi theo phòng ban cũng điều chỉnh được) nhưng bắt qua duyệt trước khi có hiệu lực. Bản đầu (PR #67, đã đóng 05/10/2026) hard-code đúng 2 phòng ban "Thi công"/"Thu mua cung ứng" trong code — khi phát sinh thêm 1 trường hợp mới ("phòng ban khác" cũng cần điều chỉnh được, nhưng cần CẢ 2 người duyệt), Sếp yêu cầu tổng quát hoá: Admin tự cấu hình bảng điều kiện theo từng nhóm đề xuất, không cần sửa code mỗi khi đổi quy tắc.

Demo đã duyệt 05/10/2026: https://claude.ai/artifact/HdnXPcDXcwGmoFZWFnnx98 (version 2) — `tong-quan-demo/base-request-app/dieu-chinh-sau-duyet-dieu-kien-cau-hinh-2026-10-05/index.html`.

## What Changes

- Thêm tab cài đặt MỚI "Điều chỉnh sau duyệt" RIÊNG theo từng nhóm đề xuất (`ProposalGroup.adjustmentApprovalRules`) — nhóm nào KHÔNG bật thì giữ nguyên hành vi cũ hoàn toàn (chỉ submitter, lưu thẳng ngay), không bắt buộc nhóm nào cũng phải cấu hình.
- Admin tự thêm "nhánh" (xét theo thứ tự, giống "Tự động ghép giá trị"): điều kiện = phòng ban của người điều chỉnh (submitter hoặc follower), kết quả = danh sách người PHẢI duyệt (AND — mọi người đều phải duyệt mới có hiệu lực). Người duyệt chỉ có 2 vai trò ĐỘNG: "Chỉ huy trưởng" (người duyệt bước 1 gốc của chính đề xuất) hoặc "Trưởng phòng [1 phòng ban]" (tra động theo `leaderId` hiện tại) — KHÔNG có lựa chọn 1 người cố định theo tên (đổi người xử lý dùng nút "Chuyển tiếp" lúc đang chờ duyệt).
- 1 cờ "Cho phép người theo dõi cũng bấm Điều chỉnh" + 1 "nhánh mặc định" (catch-all) áp dụng riêng cho FOLLOWER không khớp nhánh nào ở trên — đúng yêu cầu mới: phòng ban khác vẫn điều chỉnh được nhưng cần đủ người duyệt cấu hình ở nhánh mặc định.
- Người gửi điều chỉnh (submitter) không khớp nhánh nào LUÔN LUÔN lưu thẳng ngay — không đọc nhánh mặc định (nhánh đó chỉ áp dụng cho follower).
- Nếu 2 yêu cầu duyệt trong cùng 1 nhánh hoá ra là CÙNG 1 người thật (vd Chỉ huy trưởng và Trưởng phòng Thu mua cung ứng trùng người) → tự động gộp còn 1 lượt duyệt, không bắt bấm 2 lần.
- Người duyệt có 3 hành động cho ĐÚNG slot của mình: Duyệt, Từ chối (1 người từ chối = huỷ hẳn toàn bộ, không ghi gì vào `history`), Chuyển tiếp (tự chọn người khác xử lý thay slot của mình khi vắng mặt).
- Dời thời điểm báo Kho/Thu mua (`taoViecDongBo`/`guiCacViec`) sang SAU KHI đủ mọi người duyệt, cho nhánh cần duyệt.
- Thiếu dữ liệu để xác định người duyệt (phòng chưa có trưởng phòng, đề xuất chưa có "Chỉ huy trưởng") → rơi về hành vi cũ (direct cho submitter, none cho follower), KHÔNG chặn tính năng.

## Capabilities

### New Capabilities
- `adjustment-approval-conditions`: toàn bộ luật cho hành động "Điều chỉnh đề nghị sau duyệt" khi nhóm đề xuất có cấu hình bảng nhánh — xác định người duyệt theo phòng ban (nhánh + nhánh mặc định), gộp người trùng, trạng thái chờ ĐỦ người duyệt (AND), 3 hành động Duyệt/Từ chối/Chuyển tiếp theo từng slot, và field "người duyệt bước 1 gốc" lưu cố định trên đề xuất. Capability `post-approval-supplement` hiện có (nối dòng bảng, đính tài liệu) KHÔNG đổi — tách biệt với "Điều chỉnh", vẫn chỉ submitter, vẫn lưu thẳng ngay như cũ.

### Modified Capabilities
<!-- Không có — hành vi nối dòng bảng/đính tài liệu của post-approval-supplement giữ nguyên. -->

## Impact

- `lib/types.ts`: `RequestInstance` thêm `originalFirstApprover`, `pendingAdjustment` (dạng mới — danh sách approver, mỗi người có `approvedAt` riêng); `ProposalGroup` thêm `adjustmentApprovalRules`; type mới `AdjustmentApproverRef`/`AdjustmentApprovalBranch`/`AdjustmentApprovalRules`.
- `lib/server/adjustment-approval-rules.ts` (mới): hạt nhân xét nhánh + resolve người duyệt thật + gộp người trùng — hàm thuần test được riêng, tách khỏi phần đọc Firestore.
- `lib/server/adjustment.ts` (mới): `buildAdjustmentHistoryPatch()` (thuần) + `ghiDieuChinhVaoLichSu()` (transaction) — dùng chung cho nhánh "direct" và lúc nhánh "gated" đủ người duyệt cuối cùng.
- `app/api/requests/[id]/adjustment/route.ts`: rẽ nhánh direct/gated theo cấu hình nhóm.
- `app/api/requests/[id]/adjustment/decision/route.ts` (mới): Duyệt/Từ chối/Chuyển tiếp theo slot, AND nhiều người.
- `app/api/requests/[id]/route.ts` (GET): tính thêm `viewerAdjustmentAccess` cho người xem hiện tại — không lưu Firestore.
- `app/api/requests/route.ts` + `app/api/requests/[id]/route.ts` (PATCH submit draft): ghi `originalFirstApprover` đúng 1 lần lúc `approversSnapshot` dựng lần đầu.
- `components/request/GroupDetailNav.tsx` + `app/request/groups/[groupId]/(settings)/adjustment-approval/page.tsx` (mới): UI Admin cấu hình bảng nhánh theo nhóm.
- `components/request/RequestDetailView.tsx`/`AdjustmentControl`: hiển thị checklist nhiều người duyệt, nút Duyệt/Từ chối/Chuyển tiếp theo đúng slot của người xem.
- `components/request/modals/AdjustmentForwardModal.tsx` (mới): chọn người thay thế cho 1 slot.
- KHÔNG đụng: `lib/permissions.ts` (`canSupplementAfterApproval`), `app/api/requests/[id]/table-supplement/route.ts`, `app/api/requests/[id]/attachments/route.ts`, `app/api/requests/[id]/decision/route.ts` (luồng duyệt chính).
