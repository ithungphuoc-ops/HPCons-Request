## Why

Trang chi tiết 1 đề xuất (`RequestDetailView.tsx`) đang thiếu nhiều phần so với trang tương ứng của Base.vn thật (ảnh mẫu Sếp gửi 23/08/2026): không có sao đánh dấu, menu "⋯ Thêm" quá sơ sài (2 dòng), không có mục riêng cho tài liệu đính kèm cấp đề xuất, "Người theo dõi" hiển thị dạng danh sách dọc rời rạc, và không có điểm nhấn cho sự kiện tạo đề xuất. Ngoài ra, field kiểu "Bảng" trong form đề xuất chỉ nhập tay từng dòng, không hỗ trợ nhập nhanh từ file Excel/CSV như cách làm việc thực tế của phòng kế toán/kỹ thuật. Đã demo bằng HTML tĩnh cho Sếp xem qua nhiều vòng (23-24/08/2026), đã chốt — change này ghi lại thành đặc tả thật để triển khai code.

## What Changes

- **Sao đánh dấu đề xuất**: icon ☆/★ cạnh badge trạng thái, bấm để toggle, lưu theo từng người xem (không phải cờ chung của đề xuất). Có lối tắt trong menu "⋯ Thêm".
- **Mở rộng menu "⋯ Thêm"**: từ 2 dòng (Nhân bản, Xóa) lên đủ 10 dòng chia 5 nhóm — sao chép đường dẫn, xem tab mới, in đề xuất/in kèm thảo luận (đơn giản qua `window.print()`), in theo mẫu Word (gộp cơ chế đã có), in theo mẫu PDF (**đặt chỗ UI, disabled** — phần triển khai thật thuộc `add-pdf-export`, không làm ở đây), đánh dấu đề xuất, lịch sử webhook (**đặt chỗ UI, disabled** — chưa có hạ tầng webhook cho request), thêm người theo dõi, xuất dữ liệu (CSV đơn giản), nhân bản, xóa.
- **Card "Tài liệu đính kèm"** mới — tài liệu ở cấp đề xuất (không gắn field cụ thể), thêm được bằng nút trong card (tái dùng `/api/uploads`), xem trước qua `FilePreviewModal` đã có.
- **"Người theo dõi"** đổi cách hiển thị: từ danh sách dọc sang avatar chồng ngang + nút "+" thêm người theo dõi ngay tại đây (không cần vào sửa nháp).
- **Card "Hành động chính"** mới trong sidebar, trên "Lịch sử hoạt động" — nêu bật sự kiện tạo đề xuất (`submittedAt`/`submittedBy`), không cần dữ liệu mới.
- **Field kiểu "Bảng"/"base_table"** trong form nhập đề xuất: thêm nút "⬇ Tải file mẫu" (sinh Excel đúng cột đang cấu hình) và "+ Thêm file" (đọc file đã điền, map cột khớp tên, nối thêm dòng, và — **quyết định cần Sếp xác nhận, xem Open Questions** — tự thêm cột mới vào cấu hình field nếu file có cột lạ).

## Capabilities

### New Capabilities
- `request-bookmark`: Đánh dấu 1 đề xuất là quan trọng, theo từng người xem, hiển thị icon sao + lối tắt trong menu.
- `request-detail-actions-menu`: Menu "⋯ Thêm" đầy đủ trên trang chi tiết đề xuất — sao chép link, mở tab mới, các kiểu in, webhook (placeholder), thêm người theo dõi, xuất dữ liệu, nhân bản, xóa.
- `request-level-attachments`: Tài liệu đính kèm ở cấp đề xuất (khác tài liệu đính kèm theo từng field), thêm/xem qua UI riêng.
- `request-followers-management`: Thêm người theo dõi vào 1 đề xuất đã tồn tại (kể cả đã duyệt/từ chối xong) — hiện tại chỉ sửa được followers khi đề xuất còn ở trạng thái nháp/bị trả lại/đang chờ duyệt của chính chủ, cần mở rộng.
- `table-field-file-import`: Tải file mẫu Excel theo đúng cột đang cấu hình của field bảng, và nhập nhanh dữ liệu bảng từ file đã điền (thêm dòng, tự nhận diện/thêm cột).

### Modified Capabilities
*(`openspec/specs/` hiện chỉ có `conditional-approval-rules`, không liên quan trực tiếp — các phần còn lại của trang chi tiết đề xuất (hiển thị "Người theo dõi", card "Hành động chính") là thay đổi HIỂN THỊ thuần trong `RequestDetailView.tsx`, chưa có capability riêng nào được spec hóa trước đó để "modify" — đưa vào New Capabilities tương ứng ở trên cho rõ ràng.)*

## Impact

- `lib/types.ts` — thêm `bookmarkedByUids?: string[]` và `attachments?: RequestAttachment[]` vào `RequestInstance`.
- `components/request/RequestDetailView.tsx` — sao đánh dấu, menu "⋯ Thêm" mở rộng, card "Tài liệu đính kèm", avatar chồng cho followers, card "Hành động chính".
- `app/api/requests/[id]/route.ts` — PATCH hiện tại CHỈ cho phép sửa khi đề xuất còn nháp/bị trả lại/đang chờ duyệt CỦA CHÍNH CHỦ (không đủ cho bookmark/followers/attachments trên đề xuất đã xong hoặc không phải của mình) → cần endpoint(s) mới, hẹp phạm vi, tách riêng khỏi PATCH sửa nội dung nháp hiện có.
- `app/request/groups/[groupId]/submit/page.tsx` — khối render field kiểu "table"/"base_table" (dòng ~873-958): thêm 2 nút tải/nhập file.
- `package.json` — KHÔNG thêm dependency mới, tái dùng `xlsx` (`^0.18.5`) đã có sẵn cho cả sinh file mẫu và đọc file import.
- Không đụng `add-pdf-export` (chỉ đặt chỗ UI disabled), không đụng `add-comment-mentions-realtime` (bình luận xử lý ở change khác), không đổi `NotificationBell.tsx`/hành vi thông báo (chưa có quyết định từ Sếp).
