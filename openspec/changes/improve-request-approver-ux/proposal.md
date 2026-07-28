## Why

Hai điểm cọ xát trong luồng tạo/xem đề xuất: (1) trang xem chi tiết hiển thị ô "tài liệu đính kèm" trống bằng 1 dấu gạch ngang trơn, dễ bị hiểu nhầm là lỗi hiển thị thay vì "chưa có tệp nào"; (2) bước duyệt "Quản lý phòng ban của người gửi" (`submitter_manager`) lúc điền form chỉ hiện 1 dòng chữ tĩnh, không cho người gửi xem trước/xác nhận/chọn lại quản lý trực tiếp của mình — nếu phòng ban chưa gán `leaderId` hoặc auto-resolve sai người thì không có cách nào sửa ngay tại form.

## What Changes

- Ô tài liệu đính kèm trên trang chi tiết đề xuất: khi rỗng, hiện chữ nhỏ màu xám "Chưa có tệp nào" thay cho dấu gạch ngang `—`.
- Bước duyệt `submitter_manager` trên form tạo đề xuất: đổi từ dòng chữ tĩnh sang 1 field tương tác thật sự — dùng lại `TagUserInput` (label "Quản lý trực tiếp *", placeholder "Sử dụng @ để tag quản lý trực tiếp"), tự điền sẵn giá trị auto-resolve được (nếu có) từ `department.leaderId` của người gửi, kèm nút "Chọn quản lý trực tiếp" mở picker tìm kiếm.
- Picker chọn quản lý trực tiếp: danh sách bị lọc chỉ còn người hiện đang là `leaderId` của ≥1 phòng ban (không phải toàn bộ directory công ty), suy trực tiếp từ dữ liệu `department.leaderId` có sẵn — không tạo bảng/nhóm mới.
- Giá trị cuối cùng vẫn lưu theo đúng cấu trúc `ApproverStepDef` hiện có (không đổi schema backend), chỉ đổi trải nghiệm nhập liệu phía client.

## Capabilities

### New Capabilities
- `request-manager-picker`: Cho phép người gửi đề xuất xem trước/xác nhận/chọn lại quản lý trực tiếp của mình ngay trên form, giới hạn lựa chọn trong nhóm người đang là trưởng phòng/đơn vị.
- `request-attachment-display`: Hiển thị rõ ràng trạng thái "chưa có tệp nào" khi ô tài liệu đính kèm trên trang chi tiết đề xuất đang rỗng.

### Modified Capabilities
(không có capability cũ nào trong `openspec/specs/` đang mô tả 2 hành vi này để cần sửa — cả 2 đều là hành vi mới)

## Impact

- `components/request/RequestDetailView.tsx` (hàm `FileValueView`): sửa nhánh render khi `attachments.length === 0`.
- `app/request/groups/[groupId]/submit/page.tsx` và/hoặc component con render bước duyệt: đổi UI hiển thị bước `submitter_manager`.
- `components/shared/TagUserInput.tsx`: tái sử dụng, có thể cần thêm prop tuỳ biến nguồn dữ liệu gợi ý (giới hạn theo nhóm trưởng phòng) thay vì luôn gọi `/api/directory` mặc định.
- API: cần 1 endpoint (mới hoặc mở rộng endpoint directory hiện có) trả về danh sách người đang là `leaderId` của ≥1 phòng ban.
- Không đổi `lib/types.ts` `ApproverStepDef` (giữ nguyên cấu trúc lưu trữ).
