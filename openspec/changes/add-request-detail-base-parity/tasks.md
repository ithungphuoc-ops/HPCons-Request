## 1. Dữ liệu

- [x] 1.1 Thêm `bookmarkedByUids?: string[]` vào `RequestInstance` (`lib/types.ts`)
- [x] 1.2 Thêm `attachments?: RequestAttachment[]` vào `RequestInstance` (`lib/types.ts`) — tái dùng type `RequestAttachment` đã có, KHÔNG tạo type mới

## 2. API — bookmark / followers / attachments (3 endpoint hẹp phạm vi, không đụng PATCH sửa nháp hiện có)

- [x] 2.1 `POST /api/requests/[id]/bookmark`: toggle uid hiện tại trong `bookmarkedByUids`; chỉ cần `canView()`, không phân biệt trạng thái đề xuất
- [x] 2.2 `POST /api/requests/[id]/followers`: thêm 1 `TaggedUser` vào `followers`; chỉ cần `canView()`; loại trùng nếu người đó đã có trong danh sách
- [x] 2.3 `POST /api/requests/[id]/attachments`: thêm 1 `RequestAttachment` (đã tải qua `/api/uploads`) vào `attachments`; quyền = `isOwnRequest || canManageGroupsAtAppScope(session.role)`. **Phát hiện + vá 1 sự cố trong lúc làm**: route này ĐÃ TỒN TẠI SẴN (chỉ có `GET`, stream file qua signed R2 URL) — bước đầu vô ý ghi đè mất `GET` cũ, đã phát hiện qua `git status`/`git diff` và khôi phục đúng bản gốc + thêm `POST` mới vào CÙNG file. Đồng thời sửa luôn 1 lỗ hổng phát sinh: `collectAttachmentPaths()` cũ chỉ quét `values` (file theo field) — nếu không mở rộng, file đính kèm CẤP ĐỀ XUẤT mới sẽ không xem được (bị 404) — đã thêm quét thêm `found.attachments`.
- [x] 2.3b **Vá 1 lỗ hổng bảo mật CodeRabbit phát hiện lúc review PR #3 (23/08/2026, mức 🔴 Critical)**: `POST` ở 2.3 lưu thẳng `body.attachment.path` từ client mà KHÔNG xác minh path đó do CHÍNH người gọi tải lên qua `/api/uploads` — 1 người sửa được đề xuất có thể gõ tay path CỦA NGƯỜI KHÁC (đề xuất khác, hoặc `print-templates/{groupId}/...`), khiến ai xem được đề xuất này cũng lấy được link tải file đó. Đã vá bằng `isOwnUploadPath()` (`lib/server/uploads.ts`, có test riêng `lib/server/uploads.test.ts`) — chỉ chấp nhận path bắt đầu đúng `requests/{uid người gọi}/`; đồng thời validate `name`/`size` (dùng chung hằng số `MAX_UPLOAD_FILE_SIZE` với `/api/uploads`, đặt ở `lib/constants.ts` vì Next.js chặn route.ts export thêm hằng số ngoài GET/POST/config đã biết).

## 3. UI trang chi tiết đề xuất (`components/request/RequestDetailView.tsx`)

- [x] 3.1 Icon sao ☆/★ cạnh badge trạng thái — đọc `bookmarkedByUids`, bấm gọi `POST .../bookmark`, cập nhật UI tối ưu rồi đồng bộ lại theo response (rollback nếu lỗi)
- [x] 3.2 Mở rộng menu "⋯ Thêm" theo đúng thứ tự spec: 5 nhóm — (1) sao chép link/tab mới, (2) 3 kiểu in + PDF placeholder, (3) đánh dấu + webhook placeholder, (4) thêm người theo dõi + xuất CSV, (5) nhân bản/xoá (giữ nguyên)
- [x] 3.3 "Sao chép đường dẫn" — `navigator.clipboard.writeText`
- [x] 3.4 "Xem ở trong tab mới" — `window.open(..., '_blank')`
- [x] 3.5 "In đề xuất"/"In đề xuất và thảo luận" — `window.print()` + class `.print-hide` (CSS `@media print`, qua `<style jsx global>`) ẩn sidebar/nút bấm; card Thảo luận thêm class này có điều kiện khi in KHÔNG kèm thảo luận, tự bỏ lại sau khi in xong (event `afterprint`)
- [x] 3.6 "In đề xuất theo mẫu ra file Word" — mở lại đúng dropdown "In theo mẫu" đã có (không tạo luồng tải mẫu mới)
- [x] 3.7 "In đề xuất theo mẫu ra file PDF" — dòng disabled, tooltip "Chờ hạ tầng xuất PDF (add-pdf-export)"
- [x] 3.8 "Đánh dấu đề xuất" trong menu — gọi đúng hành động ở 3.1
- [x] 3.9 "Lịch sử webhook" — dòng disabled, tooltip "Chưa có hạ tầng webhook cho từng đề xuất"
- [x] 3.10 "Xuất dữ liệu cho bảng" — CSV thuần phía client (`fieldsSnapshot`+`values`), `Blob`+`<a download>`, không gọi server
- [x] 3.11 Card "Tài liệu đính kèm" — sau card "Thông tin khác"/"Thông tin phê duyệt", trước "Thảo luận"; nút thêm chỉ hiện `isOwnRequest || canManage`; bấm 1 file mở `FilePreviewModal` đã có
- [x] 3.12 Card "Người theo dõi" — avatar chồng ngang (margin-left âm) + nút "+" tròn mở `AddFollowerModal` (mới, tái dùng `TagUserInput`) gọi `POST .../followers`; card hiện cả khi rỗng
- [x] 3.13 Card "Hành động chính" — trong sidebar, TRÊN "Lịch sử hoạt động"; hiện `submittedAt`+`submittedBy`, không cần dữ liệu mới

## 4. Field bảng — tải file mẫu + nhập từ file (`app/request/groups/[groupId]/submit/page.tsx`)

- [x] 4.1 Xác nhận cách dùng `xlsx` hiện có — đã dùng ở `app/request/list/page.tsx` (xuất Excel danh sách) theo pattern `await import("xlsx")` (tải lười lúc bấm) — tái dùng ĐÚNG pattern này, không thêm cách mới
- [x] 4.2 Nút "Tải file mẫu": sinh `.xlsx` 1 sheet, dòng đầu = `field.tableColumns` hiện tại
- [x] 4.3 Nút "+ Thêm file": đọc bằng `XLSX.read` + `sheet_to_json({header:1})`, lấy dòng đầu làm tiêu đề cột
- [x] 4.4 Map cột khớp tên (không phân biệt hoa/thường, trim) → nối dòng dữ liệu vào cuối bảng hiện tại, giữ nguyên dòng cũ (dòng cũ tự bù ô trống cho cột mới nếu có)
- [x] 4.5 **Đã xác nhận qua chỉ đạo "làm đầy đủ hết" của Sếp** — cột KHÔNG khớp tên nào có sẵn tự thêm vào `field.tableColumns` của GROUP (qua `updateField()` có sẵn trong `RequestContext`) — áp dụng ĐÚNG NHƯ THIẾT KẾ GỐC (không giới hạn riêng cho Owner/Admin, vì bản demo có hành vi này đã được xem và không bị phản đối)
- [x] 4.6 File rỗng (chỉ tiêu đề, không dòng dữ liệu) → thông báo rõ trong khung trạng thái nhỏ cạnh 2 nút, không throw lỗi

## 5. Kiểm thử thủ công

- [ ] 5.1 Đánh dấu 1 đề xuất đã "approved" xong — xác nhận đánh dấu được, tài khoản khác không thấy bị ảnh hưởng
- [ ] 5.2 Mở menu "Thêm" — xác nhận đủ 10 dòng, đúng 5 nhóm, đúng thứ tự
- [ ] 5.3 Sao chép đường dẫn, dán ra chỗ khác — xác nhận đúng URL đề xuất đang xem
- [ ] 5.4 In đề xuất và in đề xuất kèm thảo luận — xác nhận bản in không có sidebar/nút bấm, đúng có/không có khung Thảo luận
- [ ] 5.5 Thêm tài liệu vào card "Tài liệu đính kèm" bằng tài khoản chủ đề xuất → thành công, xem trước được ngay; bằng tài khoản người xem thường (không phải chủ/Owner/Admin) → nút không hiện/bị từ chối
- [ ] 5.6 Thêm người theo dõi vào 1 đề xuất đã duyệt xong — xác nhận thêm được, hiển thị avatar chồng đúng
- [ ] 5.7 Tải file mẫu 1 field bảng, điền 2 dòng đúng cột, "+ Thêm file" lại — xác nhận 2 dòng được nối vào cuối bảng, dòng cũ không mất
- [ ] 5.8 Thử file có 1 cột lạ, xác nhận cột mới xuất hiện cả ở đề xuất khác cùng nhóm tạo sau đó
- [x] 5.9 `npm run build` sạch — xác nhận xong (build + `npx vitest run` 198/198 test pass, không hồi quy)
