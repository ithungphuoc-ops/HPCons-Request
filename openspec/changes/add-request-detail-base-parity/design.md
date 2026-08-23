## Context

`RequestDetailView.tsx` hiện có: header (tiêu đề + badge trạng thái), dòng nút hành động ("In theo mẫu" dropdown, "Sửa và gửi lại", "Thêm" — chỉ Nhân bản/Xóa), 4 nút quyết định (khi đang là người duyệt tới lượt), card "Thông tin đề xuất", card "Thông tin khác (mẫu đăng ký đề xuất)" (field theo `fieldsSnapshot`), card "Thảo luận" (đang được nâng cấp riêng ở change `add-comment-mentions-realtime`, KHÔNG đụng ở đây). Sidebar: card "Người xét duyệt" (đầy đủ), card "Người theo dõi" (danh sách dọc, chỉ hiện khi `followers.length > 0`), card "Lịch sử hoạt động" (timeline).

`app/api/requests/[id]/route.ts` PATCH hiện tại chỉ cho sửa khi `found.status` là "draft"/"returned"/"pending" VÀ `found.submittedBy.uid === session.uid` — đây là API "sửa nội dung nháp", không phải API tổng quát. Các thay đổi mới ở change này (bookmark, thêm followers, thêm attachments cấp đề xuất) phải hoạt động ĐƯỢC kể cả khi đề xuất đã "approved"/"rejected" xong (ví dụ đánh dấu 1 đề xuất cũ đã xong để dễ tìm lại, hoặc thêm người theo dõi vào 1 đề xuất đã duyệt để họ xem lịch sử) — không thể tái dùng PATCH hiện có, cần endpoint hẹp phạm vi riêng cho từng hành động.

Field kiểu "table"/"base_table" chỉ có UI NHẬP LIỆU ở `app/request/groups/[groupId]/submit/page.tsx` (dòng ~873-958) — đây là nơi người GỬI đề xuất tự nhập tay từng dòng/cột theo `field.tableColumns` (cấu hình cột thuộc về `ProposalGroup.fields`, dùng chung cho MỌI đề xuất của nhóm đó, không phải riêng từng đề xuất). `RequestDetailView.tsx` chỉ HIỂN THỊ lại giá trị đã nhập (`TableValueView`), không cho sửa.

App đã có `xlsx@^0.18.5` trong `package.json` — chưa xác nhận đã dùng ở đâu trong app (cần kiểm tra lúc code, nhưng đủ để không cần thêm dependency mới cho việc sinh/đọc file Excel).

## Goals / Non-Goals

**Goals:**
- 5 phần UI mới trên trang chi tiết đề xuất (bookmark, menu mở rộng, tài liệu đính kèm, followers dạng avatar, hành động chính) hoạt động độc lập với trạng thái đề xuất (dùng được cả khi đã duyệt/từ chối xong).
- Field bảng hỗ trợ nhập nhanh từ file Excel/CSV lúc soạn đề xuất (submit flow), giảm việc gõ tay từng dòng.
- Tái dùng tối đa cơ chế đã có: `/api/uploads` (R2), `FilePreviewModal`, `xlsx`, `printTemplates`/export Word hiện có.

**Non-Goals:**
- Không implement export PDF thật (thuộc `add-pdf-export`, đang blocked chờ Sếp chọn hạ tầng) — 2 dòng menu liên quan PDF chỉ là placeholder disabled.
- Không dựng hạ tầng webhook cho request — dòng menu "Lịch sử webhook" chỉ là placeholder disabled.
- Không đổi hành vi `NotificationBell`/thông báo — dù thêm followers có thể về lý thuyết liên quan tới thông báo, giữ nguyên nguyên logic thông báo hiện tại (Sếp chưa chốt quyết định sửa notification).
- Không đổi bất kỳ phần nào của card "Thảo luận" — thuộc `add-comment-mentions-realtime`.
- Không cho phép sửa NỘI DUNG field bảng đã có qua import (chỉ NỐI THÊM dòng mới, không ghi đè/xóa dòng cũ).

## Decisions

1. **3 endpoint hẹp phạm vi mới, KHÔNG dùng chung PATCH sửa nháp hiện có.**
   - `POST /api/requests/[id]/bookmark` — toggle bookmark cho `session.uid` hiện tại (thêm/bỏ khỏi `bookmarkedByUids`). Chỉ cần `canView()` (đã xem được đề xuất là bookmark được), không cần là chủ/đang ở trạng thái nào.
   - `POST /api/requests/[id]/followers` — thêm 1 `TaggedUser` vào `followers` của đề xuất (không phân biệt trạng thái). Quyền: `canView()` + (đề xuất chưa `deletedAt`). Không có endpoint xóa follower ở đây (ngoài phạm vi — Base.vn thật cũng chỉ cho "thêm", không thấy nút bỏ theo dõi người khác trên UI này).
   - `POST /api/requests/[id]/attachments` — thêm 1 `RequestAttachment` (đã tải lên qua `/api/uploads` trước) vào `attachments` cấp đề xuất. Quyền: `isOwnRequest || canManageGroupsAtAppScope(session.role)` (submitter hoặc Owner/Admin) — người xem thường không tự thêm tài liệu vào đề xuất người khác.
   - Lý do tách 3 endpoint nhỏ thay vì 1 PATCH tổng: mỗi hành động có ĐIỀU KIỆN QUYỀN khác nhau (bookmark: ai xem được cũng bookmark được; followers: ai xem được cũng thêm được; attachments: chỉ chủ/Owner/Admin) — nhập chung 1 PATCH sẽ phải if/else phức tạp hơn tách riêng, và tách riêng giữ đúng nguyên tắc "mỗi route làm 1 việc" đã thấy trong codebase (`/duplicate`, `/restore`, `/decision` đều là POST riêng theo hành động, không phải PATCH tổng).

2. **Bookmark theo từng người xem (`bookmarkedByUids: string[]`), không phải cờ chung.** Vì "Đánh dấu đề xuất" trên Base.vn là hành động cá nhân (đánh dấu ĐỀ XUẤT NÀY quan trọng VỚI TÔI), không phải thuộc tính chung ai xem cũng thấy giống nhau. UI đọc `bookmarkedByUids?.includes(currentUid)` để quyết định ☆ hay ★.

3. **Thêm người theo dõi qua card "Người theo dõi" hoặc menu "Thêm" — dùng lại `TagUserInput`/`/api/directory` đã có** (không tạo cơ chế tìm người mới) — mở 1 modal nhỏ chọn 1 người, gọi `POST /api/requests/[id]/followers`. Đây LÀ capability mới `request-followers-management` vì hiện KHÔNG có cách thêm follower vào 1 đề xuất ĐÃ GỬI (chỉ sửa được lúc còn nháp/bị trả lại/đang chờ, và chỉ chủ đề xuất mới sửa được) — mở rộng thật, không phải chỉ đổi UI.

4. **Tài liệu đính kèm cấp đề xuất — tái dùng đúng luồng `/api/uploads` (R2), lưu vào field mới `attachments` trên `RequestInstance`** (khác `RequestAttachment[]` đã lưu TRONG `values[fieldId]` của field kiểu "Tệp tin" — đây là mảng RIÊNG ở cấp đề xuất, không liên quan field nào). Xem trước bằng `FilePreviewModal` đã có, không sửa component đó (chỉ truyền thêm attachment từ nguồn mới).

5. **Menu "⋯ Thêm" mở rộng — 2 dòng in đơn giản dùng `window.print()` thuần + CSS `@media print`, KHÔNG dựng hệ thống in mới.** "In đề xuất" = in đúng phần cột trái (thông tin đề xuất + field) ẩn sidebar/nút bấm qua `@media print { .no-print { display: none } }`; "In đề xuất và thảo luận" = giống vậy nhưng KHÔNG ẩn card Thảo luận. Đây là in HTML trực tiếp qua trình duyệt (Ctrl+P), khác hẳn "In theo mẫu Word/PDF" (sinh file thật từ template .docx) — 2 khái niệm khác nhau, không được nhầm.

6. **"Xuất dữ liệu cho bảng" — CSV thuần phía client, không gọi server, không thêm dependency.** Ghép `fieldsSnapshot` + `values` của ĐÚNG 1 đề xuất này thành 1 dòng CSV (header = tên field, 1 dòng dữ liệu), tạo `Blob` + `<a download>` phía client. Tên gọi "cho bảng" trong ảnh mẫu Base.vn có thể ý là xuất để dán vào Google Sheet/Excel — CSV thuần đáp ứng đủ nhu cầu này, không cần xlsx cho việc này (khác với mục 9 dùng xlsx cho field bảng).

7. **"Sao chép đường dẫn" / "Xem ở trong tab mới" — thuần client, dùng `navigator.clipboard.writeText(window.location.href)` và `window.open(window.location.href, '_blank')`.** Không cần endpoint nào.

8. **"In theo mẫu Word" trong menu mới = ĐÚNG danh sách `printTemplates` đang hiển thị ở dropdown "In theo mẫu" hiện có** — gộp vào menu "Thêm" dưới dạng submenu/vẫn giữ dropdown riêng ở dòng nút hành động (quyết định UI cụ thể để lúc code chọn 1 trong 2 cách, không tạo logic tải template thứ 2). "In theo mẫu PDF" chỉ hiện 1 dòng disabled với tooltip "Chờ hạ tầng xuất PDF (add-pdf-export)".

9. **Field bảng — nút "Tải file mẫu" sinh file `.xlsx` bằng `xlsx` (thư viện đã có), 1 sheet, dòng đầu là `field.tableColumns` hiện tại.** Nút "+ Thêm file" đọc lại bằng `XLSX.read`, dòng đầu file = tiêu đề cột: cột nào TRÙNG TÊN (so sánh chuỗi, có thể chuẩn hoá bỏ khoảng trắng/hoa-thường) với `field.tableColumns` hiện có → map thẳng; cột KHÔNG TRÙNG → coi là cột mới. Mỗi dòng còn lại (sau dòng tiêu đề) → 1 dòng dữ liệu mới, NỐI vào cuối giá trị bảng hiện tại của field đó trong `values[field.id]` (giữ nguyên dòng cũ).

10. **[QUYẾT ĐỊNH CẦN SẾP XÁC NHẬN LẠI — xem Open Questions] Cột mới phát hiện từ file import: mặc định PATCH LUÔN vào `field.tableColumns` của GROUP (ảnh hưởng chung, mọi đề xuất sau này của nhóm đó cũng thấy cột mới)**, vì cấu hình cột thuộc về field của GROUP (không có khái niệm "cột riêng của 1 đề xuất"). Đây là hành vi có tác dụng phụ rộng hơn 1 đề xuất đơn lẻ — đã ghi rõ ở Open Questions, KHÔNG tự triển khai phần "tự thêm cột" nếu Sếp chưa xác nhận lại khi đọc tới đây; ưu tiên làm trước phần "nối thêm dòng cho cột đã khớp tên" (an toàn, không có tác dụng phụ ngoài đề xuất đang soạn) trong lần code đầu tiên.

## Risks / Trade-offs

- **[Risk]** 3 endpoint mới (`bookmark`/`followers`/`attachments`) đều là "sửa 1 đề xuất đã tồn tại, bất kể trạng thái" — cần cẩn thận KHÔNG cho các endpoint này vô tình mở đường sửa các field khác (`values`, `approvers`...) qua nhầm route. Mitigation: mỗi endpoint chỉ nhận payload rất hẹp (1 uid, hoặc 1 TaggedUser, hoặc 1 RequestAttachment), `adminDb...update()` chỉ set đúng 1 field liên quan, không nhận `values`/`status` trong body.
- **[Risk]** Tự động thêm cột vào `field.tableColumns` của GROUP từ hành động của 1 người đang soạn 1 đề xuất — có thể gây bất ngờ cho admin nhóm (cấu hình form bị người khác âm thầm đổi). → Mitigation: xem Decision #10, cần Sếp xác nhận rõ trước khi làm phần này; có thể đổi thành "chỉ Owner/Admin của nhóm mới được thêm cột mới, người gửi thường chỉ nối được dòng vào cột đã có" nếu Sếp muốn an toàn hơn.
- **[Trade-off]** "In đề xuất"/"In đề xuất và thảo luận" dùng `window.print()` thuần — layout in phụ thuộc CSS `@media print` tự viết, có thể không đẹp bằng in theo mẫu Word/PDF thật; chấp nhận vì đây chỉ là in nhanh tham khảo, không phải bản chính thức (bản chính thức luôn nên dùng "In theo mẫu").

## Migration Plan

- `bookmarkedByUids`/`attachments` là field mới, optional — đề xuất cũ không có field này coi như rỗng, không cần migrate dữ liệu.
- Không có bước deploy đặc biệt (không đổi hạ tầng, không có Firestore rules mới — mọi ghi vẫn qua Admin SDK ở server như hiện tại).
- Rollback: revert code, dữ liệu `bookmarkedByUids`/`attachments` nếu đã có vẫn nằm im trong Firestore, không gây lỗi cho code cũ (field lạ bị bỏ qua).

## Open Questions

- **Cột mới tự thêm vào field bảng khi import (Decision #10)**: có nên giới hạn hành động này chỉ cho Owner/Admin (không phải bất kỳ ai soạn đề xuất), để tránh 1 nhân viên thường vô tình đổi cấu hình chung của cả nhóm? Cần Sếp xác nhận trước khi code phần "tự thêm cột" — phần "nối thêm dòng vào cột đã khớp tên" thì an toàn, có thể làm ngay không cần chờ.
- **"In đề xuất" nên gộp vào dropdown "In theo mẫu" hiện có hay để riêng trong menu "Thêm"?** Cả 2 đều hợp lý về UI — quyết định lúc code theo không gian còn lại, không ảnh hưởng spec.
- **Bỏ theo dõi (unfollow)**: change này chỉ thêm "Thêm người theo dõi", không có nút "Bỏ theo dõi" cho follower tự rút — có cần thêm không, hay để đúng như Base.vn thật (dường như cũng không có nút bỏ theo dõi công khai)?
