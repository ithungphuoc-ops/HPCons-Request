## Why

Sếp đã xem qua nhiều bản demo tĩnh (HTML "BẢN XEM TRƯỚC v2 — Xem Trước Cài Đặt Nhóm") cho tab "Thiết lập chung" của 1 nhóm đề xuất và không yêu cầu sửa gì thêm — theo quy tắc Sếp đặt ra ("cái nào đã demo mà không sửa gì thì đã chốt"), đây là quyết định cuối cần đưa vào code thật. Trang thật hiện tại (`app/request/groups/[groupId]/(settings)/general/page.tsx`) vẫn là 1 form dài luôn hiện sẵn để sửa trực tiếp — khác hẳn cách trình bày trong bản demo: xem tóm tắt trước (dạng thẻ, giống Base.vn thật), chỉ mở modal khi bấm "Chỉnh sửa".

**Toàn bộ dữ liệu cần thiết đã có sẵn trong `lib/types.ts`** (`name`, `description`, `descriptionHtml`, `category`, `slaHours`, `usedFor`, `requiresSubmissionForm`, `status`, `approverSteps`, `approvalFlow`, `approverSlaEnabled`, `slaByWorkCalendar`, `requireDecisionNote`, `notifyManager`, `followers`, `followersConditional`) — đây thuần là việc đổi CÁCH TRÌNH BÀY (view-mode + modal) của 1 trang đã có, không cần model dữ liệu mới, không cần API mới.

## What Changes

- Tab "Thiết lập chung": đổi từ 1 form dài luôn sửa được → mặc định hiện **chế độ xem** (3 thẻ), bấm "Chỉnh sửa" mới mở modal/khu vực sửa tương ứng — không chuyển trang.
  - Thẻ **"Thông tin chung"**: Tên nhóm đề xuất, Tạo bởi, Phân loại, Thời hạn xử lý, Sử dụng cho, Trạng thái (chỉ xem) + nút "Chỉnh sửa" mở modal chứa: Tên nhóm đề xuất, Phân loại, Thời hạn xử lý, Sử dụng cho, "Mẫu form đề xuất?", Mô tả (ngắn), Mô tả nhóm đề xuất (rich text — tái dùng `RichTextEditor` đã có), Trạng thái.
  - Thẻ **"Người duyệt"**: danh sách bước duyệt dạng xem (avatar tròn, tên bước/badge LINH ĐỘNG khi chưa gán người, mã bước, hạn xử lý riêng nếu có) + nút "+ Thêm" mở dropdown menu (Cố định / Quản lý trực tiếp / Linh động) thay cho 3 nút rời hiện tại; bấm vào 1 bước mở lại đúng phần sửa (tên bước, người, hạn xử lý, điều kiện) đang có trong `ApproverStepsEditor`.
  - Thẻ **"Luồng phê duyệt"**: hiện tóm tắt Quy trình xử lý (Duyệt lần lượt/song song/1 người) + nút "Chỉnh sửa" mở modal gộp các cấu hình còn lại chưa có chỗ trong bản demo (Quy trình xử lý, Thời hạn xử lý riêng từng bước, Thời hạn xử lý theo lịch làm việc, Bắt buộc nhập ý kiến phê duyệt, Báo quản lý trực tiếp) — **phần này KHÔNG có trong demo gốc, tự bổ sung hợp lý để không mất tính năng đang có**, xem design.md.
  - Thẻ **"Người theo dõi"** (không có trong demo, tự bổ sung để không mất tính năng đang có): danh sách mặc định + điều kiện, mở modal sửa tương tự các thẻ trên.
- Đổi nhãn tab sidebar "Mẫu biểu đề xuất" → **"Mẫu form đề xuất"** (khớp chữ trong demo).
- Đổi thứ tự tab "Thông báo" xuống dưới "Bộ đếm" (khớp thứ tự demo) — thuần đổi vị trí, không đổi nội dung.
- **KHÔNG đổi**: dữ liệu, API, logic tính toán — chỉ đổi lớp trình bày của đúng 1 trang.

## Capabilities

### New Capabilities
- `group-settings-view-mode`: Cách trình bày xem-trước-rồi-sửa-qua-modal cho toàn bộ tab "Thiết lập chung" của 1 nhóm đề xuất (thay cho form dài luôn sửa được).

### Modified Capabilities
(none — không đổi spec hành vi dữ liệu nào, chỉ đổi UI của 1 trang đã có)

## Impact

- **UI**: `app/request/groups/[groupId]/(settings)/general/page.tsx` (viết lại hoàn toàn), `components/request/ApproverStepsEditor.tsx` (bọc lại phần hiển thị bước duyệt thành dạng xem + trigger sửa, giữ nguyên logic thêm/sửa/xoá bước bên trong), `components/request/GroupDetailNav.tsx` (đổi nhãn tab + thứ tự).
- **Component mới**: modal "Chỉnh sửa Thông tin chung" (tái dùng `RichTextEditor`, `TagUserInput` đã có), có thể tách modal "Chỉnh sửa Luồng phê duyệt"/"Chỉnh sửa Người theo dõi" riêng để modal không quá dài.
- **Không đổi**: `lib/types.ts`, mọi API route, `lib/server/requests.ts`, logic duyệt — 0 rủi ro hồi quy hành vi nghiệp vụ, chỉ rủi ro UI/UX.
- **Test**: các test hiện có (`lib/approval-logic.test.ts`, `lib/server/requests.test.ts`, `lib/server/conditions.test.ts`) không cần đổi vì không đụng logic — chỉ cần `npm run build` sạch + kiểm thủ công UI mới.
