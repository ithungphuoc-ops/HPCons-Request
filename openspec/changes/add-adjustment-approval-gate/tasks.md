## 1. Kiểu dữ liệu mới

- [x] 1.1 `lib/types.ts`: thêm `originalFirstApprover?: TaggedUser | null` và `pendingAdjustment?: {...} | null` vào `RequestInstance` (đúng shape ở design.md).

## 2. Ghi "người duyệt bước 1 gốc" (Chỉ huy trưởng)

- [x] 2.1 `app/api/requests/route.ts`: ngay sau khi gán `approversSnapshot` (nhánh không-nháp), thêm `originalFirstApprover: approversSnapshot[0] ?? null` vào object request mới.
- [x] 2.2 `app/api/requests/[id]/route.ts`: chỉ ghi khi `found.status === "draft"` (submit lần đầu) ở cả 2 nhánh (nhóm + đề xuất trực tiếp) — "pending"/"returned" KHÔNG đụng field này (giữ nguyên giá trị gốc).
- [ ] 2.3 Test: KHÔNG viết unit test riêng — route handler phụ thuộc Firestore Admin SDK nặng, đúng quy ước repo (không unit-test route .ts, chỉ unit-test hàm thuần ở `lib/`). Cần xác nhận bằng Playwright/thủ công thật (gộp vào 7.5).
- [ ] 2.4 Test: tương tự 2.3 — xác nhận `originalFirstApprover` bất biến sau `forward_then_approve` cần kiểm tra thật trên production (gộp vào 7.5), không unit-test được dễ dàng (cần dựng đủ state đề xuất + 2 lượt gọi API thật).

## 3. Tra phòng ban + xác định người duyệt gate

- [x] 3.1 `lib/server/adjustment-gate.ts` (file mới): `resolveGateDepartment(uid)` — chuẩn hoá so khớp tên "Thi công"/"Thu mua cung ứng" (không phân biệt hoa/thường, khoảng trắng dư), trả `"thi_cong" | "thu_mua_cung_ung" | "other"`, KHÔNG throw, `console.warn` khi không tìm thấy tên phòng kỳ vọng.
- [x] 3.2 `resolveAdjustmentApprover(department, request)` — trả `{approverUid, approverName} | null`.
- [x] 3.3 Test thuần (`lib/server/adjustment-gate.test.ts`, mock `getCachedDepartments`/`getScopeMembership`/`getHpcoreDb`) — 10 test, đủ case tên phòng khớp/khác hoa-thường/kiêm nhiệm/lỗi mạng/thiếu leaderId/thiếu originalFirstApprover. **Đã chạy xanh.**

## 4. Hàm quyền mới

- [x] 4.1 `lib/permissions.ts`: `resolveAdjustmentAccess(request, uid, department)` — hàm THUẦN. KHÔNG sửa `canSupplementAfterApproval`.
- [x] 4.2 Test (`lib/permissions.test.ts`) — 7 case đủ submitter/follower × phòng gate/khác, người ngoài, đề xuất chưa duyệt. **Đã chạy xanh.**

## 5. Route `adjustment/route.ts` — rẽ nhánh

- [x] 5.1 Gọi `resolveGateDepartment` + `resolveAdjustmentAccess` trước khi xử lý thân route hiện có.
- [x] 5.2 `access === "none"` → 403.
- [x] 5.3 `access === "direct"` → tách thành hàm dùng chung `ghiDieuChinhVaoLichSu` (`lib/server/adjustment.ts`), HÀNH VI giữ nguyên y hệt (đã kiểm bằng đọc lại code, không đổi logic đếm "lần N"/transaction).
- [x] 5.4 `access === "gated"`: 409 nếu đã có `pendingAdjustment`; fallback "direct" nếu thiếu approver; ghi `pendingAdjustment` trong transaction, không ghi `history`, không gọi dong-bo.
- [ ] 5.5 Test tsc/vitest: ĐÃ xác nhận `npx tsc --noEmit` + `npx vitest run` (491 test) sạch toàn repo — nhưng đây là kiểm biên dịch + hồi quy các hàm thuần liên quan, KHÔNG phải test trực tiếp route này (route handler không unit-test theo quy ước repo). Case thật (gửi điều chỉnh qua UI, 2 nhánh + fallback) cần Playwright/thủ công (7.5).

## 6. Route mới — Duyệt / Từ chối / Chuyển tiếp điều chỉnh

- [x] 6.1 Tạo `app/api/requests/[id]/adjustment/decision/route.ts` — POST `{decision, target?}`.
- [x] 6.2 Quyền: 403 nếu không đúng `pendingAdjustment.approverUid` hoặc không có `pendingAdjustment`.
- [x] 6.3 `"approved"`: dùng `ghiDieuChinhVaoLichSu(..., {extraPatch: {pendingAdjustment: null}})`, sau đó gọi dong-bo.
- [x] 6.4 `"rejected"`: transaction chỉ xoá `pendingAdjustment`.
- [x] 6.5 `"forward"`: validate target, transaction chỉ đổi `approverUid`/`approverName`.
- [ ] 6.6 Test tsc/vitest: như 5.5 — tsc/build sạch, nhưng 3 hành động thật cần Playwright/thủ công (7.5), không unit-test route trực tiếp.

## 7. Giao diện (`RequestDetailView.tsx` / `AdjustmentControl`)

- [x] 7.1 `GET /api/requests/[id]/route.ts` tính `viewerAdjustmentAccess` (chỉ gọi `resolveGateDepartment` khi thật sự cần — status approved + là submitter/follower), trả kèm `request` trong JSON, KHÔNG lưu Firestore. Trang chi tiết (`app/request/requests/[id]/page.tsx`) nhận và truyền prop xuống. List-preview (`app/request/list/page.tsx`) KHÔNG truyền prop này — `RequestDetailView` tự fallback về hành vi cũ (`canSupplementAfterApproval` ? "direct" : "none"), không bị regression.
- [x] 7.2 `AdjustmentControl` nhận `submitLabel` — "Gửi duyệt điều chỉnh" khi gated, "Cập nhật điều chỉnh" khi direct.
- [x] 7.3 Banner "⏳ Đang chờ {approverName} duyệt điều chỉnh" khi có `pendingAdjustment` và người xem không phải approver.
- [x] 7.4 Khung Duyệt/Từ chối/Chuyển tiếp khi đúng approver — "Chuyển tiếp" mở `AdjustmentForwardModal` (component mới, dùng `TagUserInput` giống `AddFollowerModal`).
- [ ] 7.5 **CHƯA LÀM** — cần tài khoản test thật thuộc phòng "Thi công" và 1 tài khoản là Trưởng phòng "Thu mua cung ứng" thật (hoặc người duyệt bước 1 của 1 đề xuất thật) để kiểm toàn bộ luồng trên production. Tài khoản `claude.test@hpcore.internal` hiện không rõ thuộc phòng ban nào — cần Sếp xác nhận/chỉ định tài khoản phù hợp trước khi kiểm chứng được bằng Playwright. Đây là phần CHƯA kiểm chứng thật, không tự ý bỏ qua.

## 8. Dọn & kiểm chứng an toàn cuối

- [x] 8.1 Rà lại `canSupplementAfterApproval` ở `table-supplement/route.ts` + `attachments/route.ts` — xác nhận KHÔNG đổi (grep xác nhận, không có diff).
- [x] 8.2 Rà `taoViecDongBo`/`guiCacViec` — xác nhận mỗi route (adjustment trực tiếp, adjustment/decision) chỉ gọi đúng 1 lần ở đúng 1 nhánh (grep xác nhận).
- [x] 8.3 `npx tsc --noEmit` sạch (trừ 3 lỗi pre-existing không liên quan ở `print-engine.test.ts`, xác nhận bằng `git diff` không đụng file đó) + `npx vitest run` 491/491 test xanh + `npm run build` thành công.
- [x] 8.4 `openspec validate add-adjustment-approval-gate --strict` → "Change is valid".
