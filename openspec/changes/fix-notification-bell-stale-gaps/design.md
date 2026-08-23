## Context

`NotificationBell.tsx` tính 5 loại thông báo bằng cách gọi lại `/api/requests?scope=...` mỗi lần mở chuông, không lưu trạng thái "đã đọc" nào. 3 trong 5 loại (được nhắc tên, đang theo dõi, đã xử lý xong phần mình) không có cách nào để "tự hết hiện" sau khi người dùng đã biết — demo tĩnh Sếp xem đã mô phỏng đúng hành vi này và chỉ ra rõ.

## Goals / Non-Goals

**Goals:**
- 1 cơ chế DUY NHẤT (`viewedAt` theo uid, ghi trên chính `RequestInstance`) giải quyết đồng thời cả 3 lỗ hổng — không cần 3 cách làm riêng.
- Không đổi hành vi bất kỳ scope nào đang được trang khác (ngoài chuông) dùng.

**Non-Goals:**
- Không làm hệ thống "đã đọc" đầy đủ kiểu mạng xã hội (đọc từng thông báo riêng, đánh dấu tất cả đã đọc...) — chỉ đủ để giải quyết 3 lỗ hổng cụ thể Sếp xác nhận.
- Không đổi cách tính `pendingCount` (số đỏ trên chuông) — vẫn chỉ tính theo `approver_pending` như hiện tại, không cộng thêm 3 loại còn lại (giữ đúng hành vi demo đã mô tả: "Số đỏ trên chuông trong thực tế chỉ đếm số đề xuất đang chờ chính bạn duyệt").

## Decisions

1. **`viewedAt` lưu trên chính document đề xuất** (không tạo collection riêng) — nhất quán với cách `bookmarkedByUids` đã làm (theo từng người xem), tránh 1 round-trip Firestore riêng lúc tính chuông.
2. **Hành động (duyệt/từ chối/chuyển tiếp/bình luận) TỰ bump `viewedAt` của người thực hiện** — tránh tự báo lại chính hành động của mình (vd người vừa bình luận không cần thấy thông báo "có bình luận mới" do chính họ tạo ra).
3. **Phát hiện thêm 1 lỗi có sẵn**: route `POST .../comments` không bump `updatedAt` từ trước — nếu không sửa, toàn bộ cơ chế `hasUnseenUpdate` (dựa vào so sánh `updatedAt` vs `viewedAt`) sẽ KHÔNG bắt được trường hợp "có bình luận mới" (đúng là 1 trong 2 kịch bản chính Sếp muốn sửa) — sửa kèm trong change này vì không sửa thì change này không đạt được mục tiêu đề ra.
4. **Tách `scope=following-unseen` khỏi `scope=following`** — vì `scope=following` đang được `/request/list` dùng làm tab "Đang theo dõi" (phải hiện ĐỦ, không lọc theo trạng thái xem). `scope=mentioned` an toàn lọc trực tiếp vì chỉ chuông dùng (đã kiểm tra toàn repo, không có nơi khác gọi).
5. **`scope=approver-followup` lấy hết rồi lọc bằng code** (không Firestore query lọc `approvers` lồng) — nhất quán với cách 3 scope tương tự (`sent-to-me`/`following`/`all`/`manager-bypassed`) đã làm, đã có tiền lệ "chấp nhận được với quy mô công ty hiện tại".

## Risks / Trade-offs

- [Rủi ro] Người dùng ở trang chi tiết đề xuất LÂU (không tải lại trang) rồi mới bình luận — `viewedAt` ghi lúc MOUNT trang, không refresh liên tục, có thể có khoảng trễ ngắn khiến chính họ vẫn thấy thông báo về hành động của mình lần kế tiếp mở chuông TRƯỚC KHI bump lại → Mitigation: route `decision`/`comments` cũng tự bump `viewedAt` ngay lúc thao tác (Decision #2), không phụ thuộc hoàn toàn vào lúc mount.
- [Rủi ro] Thêm 1 field ghi (`viewedAt`) mỗi lần mở trang chi tiết → tăng nhẹ số lượt viết Firestore → Mitigation: đây là ghi đơn giản 1 field nhỏ (`update()` với dot-path, không đọc lại `get()` trước), quy mô công ty hiện tại (theo ghi chú có sẵn trong code) chấp nhận được, không cần cache/debounce ở lần đầu này.

## Migration Plan

- Không cần backfill dữ liệu cũ — đề xuất chưa có `viewedAt[uid]` được `hasUnseenUpdate()` coi là "chưa từng xem" → luôn hiện 1 lần đầu (đúng ý nghĩa, không phải lỗi).
