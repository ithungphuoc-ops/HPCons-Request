## ADDED Requirements

### Requirement: Đánh dấu đã xem khi mở trang chi tiết
Khi 1 người dùng mở trang chi tiết 1 đề xuất, hệ thống SHALL ghi lại thời điểm đó vào `viewedAt[uid]` của đề xuất.

#### Scenario: Mở trang chi tiết
- **WHEN** người dùng mở `/request/requests/{id}`
- **THEN** hệ thống gọi `POST /api/requests/{id}/view` và ghi `viewedAt[uid]` = thời điểm hiện tại

### Requirement: Hành động trên đề xuất cũng tính là đã xem
Khi 1 người dùng duyệt, từ chối, chuyển tiếp, trả lại, hoặc bình luận trên 1 đề xuất, hệ thống SHALL ghi `viewedAt[uid]` của chính người đó cùng lúc, để không tự báo lại hành động của họ.

#### Scenario: Bình luận
- **WHEN** người dùng gửi 1 bình luận mới trên đề xuất
- **THEN** `updatedAt` của đề xuất được cập nhật, VÀ `viewedAt[uid]` của người bình luận cũng được ghi cùng thời điểm

### Requirement: Người đã xử lý xong vẫn được báo khi có biến động mới
Người đã ra quyết định (không còn "pending") trên 1 đề xuất SHALL vẫn nhận được thông báo nếu đề xuất có cập nhật mới (bình luận, hoặc bước sau từ chối) kể từ lần họ xem/thao tác gần nhất.

#### Scenario: Có bình luận mới sau khi đã duyệt xong
- **GIVEN** người dùng đã duyệt xong phần mình trên 1 đề xuất
- **WHEN** có người khác bình luận thêm vào đề xuất đó, sau thời điểm `viewedAt[uid]` của người này
- **THEN** `GET /api/requests?scope=approver-followup` (với session của người này) trả về đề xuất đó

### Requirement: Người theo dõi được báo khi có biến động mới, không chỉ lúc gửi
Người theo dõi 1 đề xuất SHALL được báo khi có cập nhật mới kể từ lần họ xem gần nhất, không chỉ đúng 1 lần lúc đề xuất được gửi.

#### Scenario: Đề xuất theo dõi có cập nhật sau khi đã xem
- **GIVEN** người dùng đang theo dõi 1 đề xuất và đã xem nó trước đó
- **WHEN** đề xuất có biến động mới (bình luận/quyết định) sau lần xem đó
- **THEN** `GET /api/requests?scope=following-unseen` trả về đề xuất đó; sau khi người dùng mở lại trang chi tiết, lần gọi tiếp theo KHÔNG còn trả về đề xuất đó nữa (trừ khi có biến động mới hơn)

### Requirement: Thông báo @tag tự hết khi đã xem
Thông báo "được nhắc tới" cho 1 đề xuất SHALL không còn xuất hiện sau khi người được nhắc đã mở trang chi tiết đề xuất đó (kể từ sau thời điểm nhắc/cập nhật gần nhất).

#### Scenario: Mở lại đề xuất sau khi được tag
- **GIVEN** người dùng được @tag trong 1 bình luận của 1 đề xuất
- **WHEN** người đó mở trang chi tiết đề xuất đó
- **THEN** lần gọi `GET /api/requests?scope=mentioned` tiếp theo không còn trả về đề xuất đó, trừ khi có bình luận/cập nhật mới sau đó

### Requirement: Không ảnh hưởng trang danh sách theo dõi
Việc lọc theo trạng thái đã xem cho chuông thông báo SHALL không làm thay đổi dữ liệu trả về cho trang danh sách "Đang theo dõi" (`scope=following`) — trang đó vẫn hiện đủ mọi đề xuất đang theo dõi bất kể trạng thái xem.

#### Scenario: Trang danh sách vẫn hiện đủ
- **WHEN** người dùng mở trang danh sách đề xuất, tab "Đang theo dõi"
- **THEN** hệ thống vẫn gọi `scope=following` (không lọc theo `viewedAt`) và hiện đủ mọi đề xuất đang theo dõi
