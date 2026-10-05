## 1. Kiểu dữ liệu mới

- [x] 1.1 `lib/types.ts`: `AdjustmentApproverRef`, `AdjustmentApprovalBranch`, `AdjustmentApprovalRules`; `ProposalGroup.adjustmentApprovalRules?: AdjustmentApprovalRules | null`; `RequestInstance.originalFirstApprover`/`pendingAdjustment` (dạng mới — `approvers: {uid,name,approvedAt}[]`).

## 2. Ghi "người duyệt bước 1 gốc" (Chỉ huy trưởng)

- [x] 2.1 `app/api/requests/route.ts`: ghi `originalFirstApprover: approversSnapshot[0] ?? null` ngay sau khi gán `approversSnapshot` (nhánh không-nháp).
- [x] 2.2 `app/api/requests/[id]/route.ts`: CHỈ ghi khi `found.status === "draft"` (submit lần đầu) ở cả 2 nhánh (nhóm + đề xuất trực tiếp) — "pending"/"returned" không đụng field này.
- [ ] 2.3/2.4 Không unit-test route trực tiếp (quy ước repo: route handler phụ thuộc Firestore Admin SDK nặng, không unit-test) — cần Playwright/thủ công thật (gộp vào 7.x).

## 3. Hạt nhân xét nhánh + resolve người duyệt

- [x] 3.1 `lib/server/adjustment-approval-rules.ts` (mới): `matchAdjustmentBranch()` + `planAdjustmentApproval()` — hàm THUẦN, không đụng Firestore.
- [x] 3.2 `resolveActorDepartmentIds()`, `resolveApproverRefs()` (gộp người trùng theo uid), `resolveAdjustmentPlanForActor()` (gộp plan + resolve + fallback), `loadAdjustmentApprovalRules()`.
- [x] 3.3 Test thuần `lib/server/adjustment-approval-rules.test.ts` — 17 test: khớp nhánh theo thứ tự, allowFollowers, catchAll, submitter luôn direct khi không khớp, gộp người trùng, fallback khi thiếu leaderId/originalFirstApprover. **Đã chạy xanh.**

## 4. Route `adjustment/route.ts` — rẽ nhánh theo cấu hình nhóm

- [x] 4.1 Tải `adjustmentApprovalRules` của nhóm (null nếu đề xuất trực tiếp, không có `groupId`).
- [x] 4.2 Gọi `resolveAdjustmentPlanForActor` — "none" → 403; "direct" → `ghiDieuChinhVaoLichSu` (hành vi cũ y nguyên) + báo dong-bo; "gated" → ghi `pendingAdjustment` (transaction, chặn chồng 2 điều chỉnh), KHÔNG ghi history/báo dong-bo.

## 5. Route mới — Duyệt / Từ chối / Chuyển tiếp (AND nhiều người)

- [x] 5.1 Tạo `app/api/requests/[id]/adjustment/decision/route.ts`.
- [x] 5.2 Quyền theo SLOT: chỉ người có `approvers[i].uid === session.uid && approvedAt === null`.
- [x] 5.3 "approved": đánh dấu `approvedAt` của đúng slot; nếu ĐỦ mọi slot → ghi `history` (dùng `buildAdjustmentHistoryPatch`, hàm thuần tách khỏi `ghiDieuChinhVaoLichSu` để gọi được trong CÙNG transaction, không lồng `runTransaction`), xoá `pendingAdjustment`, rồi mới báo dong-bo NGOÀI transaction.
- [x] 5.4 "rejected": 1 người đang chờ từ chối = huỷ hẳn toàn bộ, không đụng history/attachments.
- [x] 5.5 "forward": đổi đúng 1 slot, gộp nếu người mới đã có mặt ở slot khác.
- [ ] 5.6 Test tsc/build sạch xác nhận — case thật (AND nhiều người, từ chối, chuyển tiếp) cần Playwright/thủ công (7.x), không unit-test route trực tiếp.

## 6. UI Admin — bảng nhánh theo nhóm

- [x] 6.1 `components/request/GroupDetailNav.tsx`: thêm mục "Điều chỉnh sau duyệt".
- [x] 6.2 `app/request/groups/[groupId]/(settings)/adjustment-approval/page.tsx` (mới): toggle bật/tắt nhóm (gửi `null` để tắt), toggle `allowFollowers`, danh sách `BranchCard` (chip phòng ban OR + chip người duyệt AND, chỉ 2 loại chip động), nút "+ Thêm nhánh", card "Nhánh mặc định" cố định (catchAllApprovers).
- [x] 6.3 Dùng `/api/directory/departments` (đã có sẵn) để liệt kê phòng ban — không cần route mới.

## 7. Giao diện trang chi tiết đề xuất

- [x] 7.1 `GET /api/requests/[id]/route.ts`: tính `viewerAdjustmentAccess` (chỉ gọi khi status approved + là submitter/follower), trả kèm `request`, KHÔNG lưu Firestore.
- [x] 7.2 `app/request/requests/[id]/page.tsx`: nhận + truyền `viewerAdjustmentAccess`. List-preview (`app/request/list/page.tsx`) KHÔNG truyền prop này — tự fallback về hành vi cũ, không regression.
- [x] 7.3 `AdjustmentControl` nhận `submitLabel` ("Gửi duyệt điều chỉnh" khi gated, "Cập nhật điều chỉnh" khi direct).
- [x] 7.4 Checklist nhiều approver khi có `pendingAdjustment` (✓ đã duyệt / … chưa duyệt), nút Duyệt/Từ chối/Chuyển tiếp CHỈ hiện cho đúng slot của người xem. "Chuyển tiếp" mở `AdjustmentForwardModal` (dùng `TagUserInput`).
- [ ] 7.5 **CHƯA LÀM** — cần tài khoản test thật để kiểm toàn bộ luồng trên production (1 submitter/follower thuộc phòng có cấu hình nhánh, xác nhận đúng người duyệt được tra ra, thử AND 2 người, thử Từ chối, thử Chuyển tiếp). Tài khoản `claude.test@hpcore.internal` hiện không rõ thuộc phòng ban nào — cần Sếp xác nhận/chỉ định tài khoản phù hợp, và cấu hình thật 1 nhóm đề xuất qua UI Admin trước khi kiểm được.

## 8. Dọn & kiểm chứng an toàn cuối

- [x] 8.1 Rà `canSupplementAfterApproval` ở `table-supplement/route.ts` + `attachments/route.ts` — xác nhận KHÔNG đổi (grep xác nhận).
- [x] 8.2 Rà `taoViecDongBo`/`guiCacViec` — mỗi route (adjustment trực tiếp, adjustment/decision) chỉ gọi đúng 1 lần ở đúng 1 nhánh (grep xác nhận).
- [x] 8.3 `npx tsc --noEmit` sạch (trừ 3 lỗi pre-existing ở `print-engine.test.ts`, không liên quan, xác nhận bằng `git diff` không đụng file đó) + `npx vitest run` 491/491 xanh + `npm run build` thành công.
- [x] 8.4 `openspec validate add-adjustment-approval-conditions --strict` sạch.
