## 1. Tách hàm Excel dùng chung (Decision 4)

- [x] 1.1 Tách `downloadTemplateFile`/`importTableFile` từ `app/request/groups/[groupId]/submit/page.tsx` thành 2 hàm dùng chung (tham số hoá `columns`/`rows`/callback ghi kết quả, không đóng cứng theo `onChange` cục bộ của trang soạn)
- [x] 1.2 Sửa `submit/page.tsx` gọi lại 2 hàm dùng chung này — xác nhận hành vi trang soạn không đổi (test tay lại luồng tải mẫu/import cũ)

## 2. Route nối dòng bảng sau duyệt (Decision 1, 3)

- [x] 2.1 Tạo `app/api/requests/[id]/table-supplement/route.ts` — `POST`, `requireSession()`
- [x] 2.2 Kiểm tra `found.status === "approved"` và `found.submittedBy.uid === session.uid` — sai 1 trong 2 → 403
- [x] 2.3 Validate body `{ fieldId, newRows, newColumns? }` — tìm đúng field trong `fieldsSnapshot`, xác nhận `dataType` là "table"/"base_table" — sai → 400
- [x] 2.4 Ghép cột mới (dedupe theo tên chuẩn hoá, cùng logic `normalize` ở `submit/page.tsx`), bù ô trống cho dòng cũ, nối dòng mới vào cuối — KHÔNG sửa/xoá dòng cũ dưới bất kỳ hình thức nào
- [x] 2.5 Ghi `values[fieldId]` (qua `toWireTableRows`) + `fieldsSnapshot[i].tableColumns` (chỉ trên snapshot của đề xuất này — không đụng field config của group)
- [x] 2.6 Đếm số lần bổ sung từ `history` (lọc theo tiền tố action), ghi dòng `history` mới đúng định dạng thiết kế ở design.md
- [x] 2.7 Trả về `RequestInstance` đã cập nhật, cùng cấu trúc response với `PATCH /api/requests/[id]`

## 3. Siết quyền đính kèm khi đã duyệt (Requirement 3)

- [x] 3.1 Sửa `app/api/requests/[id]/attachments/route.ts` `POST` — khi `found.status === "approved"`, chỉ chấp nhận `isOwnRequest`, từ chối `canManageGroupsAtAppScope` (Owner/Admin) — giữ nguyên hành vi cũ cho các trạng thái khác
- [x] 3.2 Ghi 1 dòng `history` khi đính file thành công lúc `status === "approved"` (đếm lần riêng theo tiền tố action khác với mục 2.6)

## 4. UI trang chi tiết đề xuất (Decision 2)

- [x] 4.1 Thêm khu vực "Bổ sung sau duyệt" cạnh mỗi field bảng trong `RequestDetailView.tsx` (gần `TableValueView`, dòng ~821-825) — chỉ hiện khi `request.status === "approved" && isOwnRequest`
- [x] 4.2 Nút "Tải file mẫu"/"Thêm file" gọi 2 hàm dùng chung (mục 1) + `POST /api/requests/[id]/table-supplement`, cập nhật lại state hiển thị bảng sau khi thành công
- [x] 4.3 Hiện nhãn "Bổ sung sau duyệt · lần N · <thời điểm>" dưới bảng — suy ra N/thời điểm từ `history` (đếm dòng khớp tiền tố action)
- [x] 4.4 Sửa điều kiện nút "Thêm tài liệu" ở khu vực đính kèm — khi `status === "approved"` chỉ hiện cho `isOwnRequest`, ẩn với Owner/Admin dù `canManage`
- [x] 4.5 Hiện nhãn tương tự mục 4.3 cho các file đính kèm sau duyệt

## 5. Kiểm thử & xác minh

- [x] 5.1 `tsc --noEmit`, `eslint`, `next build` sạch
- [x] 5.2 `openspec validate add-post-approval-supplement --strict` sạch
- [x] 5.3 Test Playwright + SSO thật: submitter nối dòng bảng (kể cả trường hợp file có cột lạ), xác nhận dòng cũ không đổi, nhãn "lần N" hiện đúng
- [x] 5.4 Test Playwright: Owner/Admin KHÔNG thấy nút bổ sung/đính file trên đề xuất người khác đã duyệt
- [x] 5.5 Test Playwright: đính file khi đề xuất chưa duyệt vẫn cho Owner/Admin làm như cũ (không bị siết nhầm)
- [ ] 5.6 Dọn dữ liệu test sau khi xong, deploy production, xác nhận lại qua SSO thật
