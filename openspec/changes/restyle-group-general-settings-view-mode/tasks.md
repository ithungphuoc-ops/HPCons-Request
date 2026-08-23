## 1. Thẻ "Thông tin chung" + modal sửa

- [x] 1.1 Viết component `GeneralInfoCard` (view-mode: Tên, Tạo bởi, Phân loại, Thời hạn xử lý, Sử dụng cho, Trạng thái) + nút "Chỉnh sửa"
- [x] 1.2 Modal sửa (tái dùng `Modal` component có sẵn): Tên nhóm đề xuất, Mô tả (ngắn), Phân loại, Thời hạn xử lý, Sử dụng cho (`TagUserInput`), "Mẫu form đề xuất?", Mô tả nhóm đề xuất (`RichTextEditor`), Trạng thái
- [x] 1.3 Validate giữ nguyên (`validateGroupName`, `validateSlaHours`), lưu qua `updateGroup()` đang có

## 2. Thẻ "Người duyệt"

- [x] 2.1 View-mode: danh sách bước rút gọn (avatar, tên/badge LINH ĐỘNG, mã, hạn xử lý riêng nếu `approverSlaEnabled`)
- [x] 2.2 "+ Thêm" đổi từ 3 nút rời → 1 dropdown menu (Cố định · Quản lý trực tiếp · Linh động) — gộp "Thêm người duyệt theo điều kiện" vào mục "Cố định" (bật sẵn checkbox điều kiện), KHÔNG tạo kind mới
- [x] 2.3 Bấm 1 bước → hiện lại đúng phần sửa đầy đủ hiện có trong `ApproverStepsEditor` tại chỗ (không viết lại logic thêm/sửa/xoá/validate bước)

## 3. Thẻ "Luồng phê duyệt" (mở rộng ngoài demo — xem design.md)

- [x] 3.1 View-mode: tóm tắt Quy trình xử lý (giá trị hiện tại)
- [x] 3.2 Modal sửa: Quy trình xử lý, Thời hạn xử lý riêng từng bước duyệt, Thời hạn xử lý theo lịch làm việc, Bắt buộc nhập ý kiến phê duyệt (4 checkbox), Báo quản lý trực tiếp

## 4. Thẻ "Người theo dõi" (mở rộng ngoài demo — xem design.md)

- [x] 4.1 View-mode: danh sách người theo dõi mặc định (tái dùng kiểu avatar-chồng đã làm ở `RequestDetailView.tsx` nếu hợp lý) + số lượng điều kiện đang cấu hình
- [x] 4.2 Modal sửa: `TagUserInput` cho danh sách mặc định + `FollowersConditionalEditor` đang có

## 5. Sidebar + dọn dẹp

- [x] 5.1 `GroupDetailNav.tsx`: đổi nhãn "Mẫu biểu đề xuất" → "Mẫu form đề xuất"
- [x] 5.2 `GroupDetailNav.tsx`: đổi thứ tự tab "Thông báo" xuống dưới "Bộ đếm"
- [x] 5.3 Xoá code/state không dùng nữa của form cũ trong `general/page.tsx` sau khi viết lại xong

## 6. Kiểm thử

- [x] 6.1 `npm run build` sạch — đã xác nhận (build thành công, route `/request/groups/[groupId]/general` compile OK)
- [x] 6.2 `npx vitest run` — 198/198 pass, không hồi quy
- [ ] 6.3 Kiểm thủ công trên local dev: xem 4 thẻ, sửa từng modal, thêm/sửa bước duyệt qua menu mới, xác nhận dữ liệu lưu đúng như trước khi đổi giao diện — CẦN SẾP TỰ TEST TRÊN LOCAL, chưa thể tự làm (cần browser thật)
