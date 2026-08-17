## 1. Kiểu dữ liệu + helper

- [x] 1.1 `lib/types.ts`: thêm `users?: TaggedUser[]` vào biến thể "fixed" của `ApproverStepDef` (giữ `user`)
- [x] 1.2 Thêm helper `fixedStepUsers(step)` (đặt ở `lib/approval-logic.ts`) trả về danh sách người thật của 1 bước fixed (users ?? [user])

## 2. Server resolve

- [x] 2.1 `lib/server/requests.ts` `resolveApproverStepsDetailed`: bước fixed mở rộng thành 1 phần tử kết quả cho MỖI người trong `fixedStepUsers` (cùng `index`)

## 3. UI cấu hình nhóm

- [x] 3.1 `components/request/ApproverStepsEditor.tsx`: `DraftApproverStep` fixed đổi sang `users: TaggedUser[]`; `fromApproverSteps`/`toApproverSteps` chuyển đổi 2 chiều (lưu `user` = users[0] + `users` đủ); TagUserInput cho chọn nhiều; chặn bước 0 người
- [x] 3.2 `app/request/groups/page.tsx` (thay người duyệt hàng loạt): map cả `users` (tiện thể sửa luôn lỗi cũ: thay người làm MẤT code/condition của bước — giờ giữ nguyên qua spread)

## 4. UI form gửi

- [x] 4.1 `app/request/groups/[groupId]/submit/page.tsx`: key React của dòng preview đổi sang `${index}-${user.id}` (bước nhiều người sinh nhiều dòng cùng index)

## 6. Thêm người cùng duyệt tại hàng "Quản lý trực tiếp" trên form gửi (Sếp bổ sung 16/08/2026 sau khi test)

- [x] 6.1 `lib/server/requests.ts`: `managerOverrides` nhận `string | string[]` (người đầu = quản lý, sau = người thêm), xác thực TỪNG uid qua `resolveManagerOverride`, mở rộng thành nhiều dòng người duyệt cùng bước
- [x] 6.2 `app/api/requests/route.ts` + `app/api/requests/[id]/route.ts`: nới kiểu `managerOverrides` (tương thích ngược string đơn)
- [x] 6.3 `app/request/groups/[groupId]/submit/page.tsx`: state `extraApprovers` + TagUserInput "Gõ @ để thêm người cùng duyệt" ngay dưới thẻ quản lý; payload gộp `[managerId, ...extraIds]` loại trùng

## 5. Test + kiểm tra

- [x] 5.1 Test `fixedStepUsers`: bước cũ (chỉ user) → [user]; bước mới (users 2 người) → đủ 2; users rỗng → fallback [user]
- [x] 5.2 Test `getRequestStatus` với bước 2 người: chỉ 1 người duyệt → pending, cả 2 duyệt → approved (concurrent) — 33/33 pass
- [x] 5.3 `npx tsc --noEmit` sạch (3 lỗi cũ không liên quan), `npx vitest run` 154/154 pass, `npx next build` sạch
