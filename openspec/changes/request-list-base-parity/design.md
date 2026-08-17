## Context

API danh sách (`GET /api/requests`) đã trả về nguyên `RequestInstance` — có sẵn `fieldsSnapshot` + `values` (đủ để hiện thông tin phụ), `approversSnapshot` (danh sách người duyệt) + `approvers` (quyết định từng người). Chỉ THIẾU ảnh đại diện thật. App tổng hpcons-portal lưu `users/{uid}.avatarUrl` (ảnh tự tải lên R2, URL công khai) — app request đã có sẵn kết nối đọc project hpcore (`getHpcoreDb()`, đang dùng tra tên/chức danh).

## Goals / Non-Goals

- Goals: dòng danh sách nhiều thông tin như Base.vn; ảnh thật từ app tổng; giữ nguyên phong cách thiết kế + hiệu ứng hover vừa làm (change trước cùng ngày).
- Non-Goals: KHÔNG làm ngôi sao "đánh dấu quan trọng" (app chưa có tính năng đánh dấu — không vẽ nút giả); KHÔNG làm thanh tab lọc trạng thái/tìm kiếm của Base trong change này (sidebar đã có các scope tương ứng); KHÔNG đổi API list.

## Decisions

1. **API avatar tách riêng, client ghép** (`GET /api/directory/avatars?uids=a,b,c`, tối đa 100 uid/lần, đọc batch `getAll`): tránh phình API list (đang trả nguyên RequestInstance ở 7 scope khác nhau — enrich từng scope sẽ lặp code 7 chỗ); avatar là dữ liệu trang trí, tải sau không chặn danh sách hiện ra.
2. **Thông tin phụ lấy từ field của CHÍNH đề xuất**: lọc `fieldsSnapshot` theo `dataType` thuộc {single_choice, department_select, date, datetime, integer, decimal, currency}, bỏ field thuộc `TITLE_FIELD_CODES`, lấy tối đa 3 field ĐÃ CÓ GIÁ TRỊ theo `order`, hiện "Tên field: giá trị". Không hard-code tên field nào — nhóm nào cũng tự ra đúng thông tin của nhóm đó (khớp yêu cầu "mẫu dùng chung" Sếp dặn trước đây).
3. **Cụm người duyệt**: avatar tròn 24px chồng nhau (-ml), tối đa 3 + "+N"; chấm trạng thái nhỏ đè góc (xanh ✓ đã duyệt / đỏ ✕ từ chối / xám chờ) — màu + icon, không chỉ dựa màu. Ẩn cụm này trên màn hình < md (chật, đã có badge trạng thái tổng).
4. **Ảnh thật + fallback chữ cái**: component `Avatar` nhỏ dùng `<img>` với `onError` rơi về chữ cái đầu — URL R2 cũ có thể hỏng, không để ô vỡ ảnh.

## Risks / Trade-offs

- [Rủi ro] Nhiều uid → 1 request avatars mỗi lần đổi scope; chấp nhận (100 uid/lần, chỉ chạy khi danh sách đổi, có cache Map trong phiên).
- [Trade-off] Thông tin phụ chọn theo dataType (không cho admin cấu hình field nào hiện) — đơn giản trước, đúng triết lý dự án; nếu Sếp cần tuỳ chỉnh sẽ mở rộng sau.
