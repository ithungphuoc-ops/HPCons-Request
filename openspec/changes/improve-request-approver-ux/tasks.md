## 1. Tài liệu đính kèm — hiển thị rõ khi rỗng

- [x] 1.1 `components/request/RequestDetailView.tsx` — sửa `FileValueView`: khi `attachments.length === 0`, render "Chưa có tệp nào" (chữ nhỏ, màu xám) thay cho `—`.

## 2. Danh bạ "quản lý trực tiếp"

- [x] 2.1 Tạo `app/api/directory/managers/route.ts` — query `departments` lấy mọi `leaderId` distinct (bỏ null), map sang `users/{leaderId}` (dùng `getHpcoreDb()` giống `app/api/directory/route.ts`), trả `TaggedUser[]` kèm field mới `title` (tên phòng ban đang lãnh đạo; gộp nếu 1 người lãnh đạo nhiều phòng ban).
- [x] 2.2 `lib/types.ts` — thêm field optional `title?: string` vào `TaggedUser`.

## 3. `TagUserInput` — thêm chế độ "duyệt toàn bộ danh sách"

- [x] 3.1 Thêm prop optional `browseAllLabel?: string` vào `TagUserInput`; khi có, hiện 1 link text dưới ô nhập, bấm vào set `open=true` và nạp `results` = toàn bộ `directory` đã tải (trừ người đã chọn) thay vì đợi gõ query.
- [x] 3.2 Hiện thêm `u.title` (nếu có) làm dòng phụ nhỏ dưới tên, cả trong pill đã chọn và trong item dropdown gợi ý.
- [x] 3.3 Kiểm tra 3 chỗ đang dùng `TagUserInput` hiện tại (approver "fixed", followers, comment mention) không bị ảnh hưởng khi không truyền `browseAllLabel`/không có `title`.

## 4. API xem trước người duyệt — trả chi tiết theo từng bước

- [x] 4.1 Tìm và đọc route approver-preview (đường dẫn thật: `app/api/groups/[id]/approver-preview/route.ts`).
- [x] 4.2 Mở rộng response: cộng thêm field `steps` song song với `approvers` cũ (giữ nguyên `approvers` để không phá vỡ chỗ khác đang dùng) — qua hàm mới `resolveApproverStepsDetailed()` trong `lib/server/requests.ts`.
- [x] 4.3 Với bước `submitter_manager` không resolve được (`MissingApproverError`), set `error` ở đúng phần tử `steps[i]` tương ứng thay vì chỉ throw lỗi chung cho cả request.

## 5. UI submit form — thêm khả năng đổi quản lý trực tiếp

- [x] 5.1 `app/request/groups/[groupId]/submit/page.tsx` — đổi kiểu state `approverPreview` để lưu thêm `steps` từ response mới.
- [x] 5.2 Với mỗi phần tử `steps[i].kind === "submitter_manager"`: hiện pill tên (nếu có `user`) kèm nút nhỏ "Đổi"; bấm vào chuyển sang chế độ sửa dùng `TagUserInput` (`directoryUrl="/api/directory/managers"`, `browseAllLabel="Chọn quản lý trực tiếp"`, single-select qua mảng 0-1 phần tử).
- [x] 5.3 Nếu `steps[i].error` tồn tại (auto-resolve thất bại): hiện thẳng ở chế độ sửa (không có pill để hiện), kèm dòng lỗi hiện có; validate chặn submit nếu bước này bắt buộc mà chưa chọn ai.
- [x] 5.4 Payload submit: gửi kèm lựa chọn override (`managerOverrides: Record<number, string>` theo index bước) cho các bước đã bị đổi tay.

## 6. Server — chấp nhận override có xác thực

- [x] 6.1 `lib/server/requests.ts` — hàm tạo request: nhận thêm `managerOverrides` (optional) trong input.
- [x] 6.2 Với mỗi bước `submitter_manager` có override tương ứng: validate id đó đang là `leaderId` của ≥1 phòng ban (query lại, không tin nguyên giá trị client) — hợp lệ thì dùng, không hợp lệ hoặc thiếu thì rơi về auto-resolve theo `department.leaderId` như cũ.
- [x] 6.3 Đảm bảo không gửi `managerOverrides` (client cũ) vẫn hoạt động y hệt hành vi hiện tại — mặc định `{}` giữ nguyên hành vi cũ (test build/thủ công ở mục 7).

## 7. Kiểm tra

- [x] 7.1 `npm run build` sạch.
- [ ] 7.2 Test thủ công với tài khoản thật: tạo đề xuất ở nhóm có bước `submitter_manager` — trường hợp phòng ban có `leaderId` hợp lệ (thấy pill + đổi được), trường hợp thiếu `leaderId` (bắt buộc chọn tay), và picker "Chọn quản lý trực tiếp" chỉ hiện đúng người đang là trưởng phòng/đơn vị.
- [ ] 7.3 Test ô tài liệu đính kèm trên trang chi tiết — 1 đề xuất chưa có tệp hiện đúng "Chưa có tệp nào".
