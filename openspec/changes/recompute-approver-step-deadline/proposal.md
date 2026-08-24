## Why

Change `add-base-vn-approver-and-approval-form-parity` cố ý CHƯA làm việc "tính lại hạn xử lý (deadlineAt) khi đề xuất chuyển sang bước duyệt tiếp theo" (chỉ tính 1 lần lúc gửi, dùng SLA của bước đầu tiên) vì đây là quyết định hành vi ảnh hưởng badge "Quá hạn" đang chạy thật, cần Sếp xác nhận trước. Sếp đã xác nhận 23/08/2026: **có, cần tính lại mỗi khi qua bước tiếp theo**.

## What Changes

- Thêm `recomputeDeadlineForNextStep()` (`lib/server/requests.ts`) — tính lại `deadlineAt` dựa trên SLA riêng của bước duyệt SẮP TỚI LƯỢT, TỪ THỜI ĐIỂM VỪA CHUYỂN BƯỚC (không cộng dồn từ lúc gửi ban đầu). CHỈ áp dụng khi: `group.approverSlaEnabled` bật, luồng xử lý là "Lần lượt" (concurrent/single không có khái niệm "lượt kế tiếp" — mọi người cùng bắt đầu từ lúc gửi), và đề xuất còn "pending" (chưa xong hoàn toàn).
- Nối vào `app/api/requests/[id]/decision/route.ts` — cả nhánh quyết định thường (approved/rejected) VÀ nhánh chuyển tiếp (approve_and_forward/forward_then_approve).
- **Phát hiện + vá 1 lỗi có sẵn phát sinh khi làm việc này**: `approverStepMeta` (mảng tên/mã/SLA riêng từng bước) trước đây KHÔNG được chèn thêm phần tử khi 1 người bị chèn vào giữa danh sách duyệt qua hành động chuyển tiếp — khiến mảng này lệch thứ tự/độ dài so với `approvers`/`approversSnapshot` ngay sau lần chuyển tiếp đầu tiên, làm sai lệch MỌI tra cứu theo index sau đó (kể cả "Mẫu form phê duyệt" đã có từ trước). Đã vá: chèn 1 phần tử rỗng `{}` cùng vị trí.

## Capabilities

### New Capabilities
- `approver-step-deadline-recompute`: tính lại `deadlineAt` khi đề xuất chuyển sang bước duyệt tiếp theo (luồng "Lần lượt", mỗi bước có SLA riêng).

### Modified Capabilities
(none — không có spec cũ archive cho phần approver-steps SLA để viết delta chuẩn; coi là bổ sung hành vi mới cho `resolveInitialSlaHours`/`deadlineAt` đã có, không đổi shape dữ liệu)

## Impact

- **Logic thuần** (có test): `lib/server/requests.ts` (`recomputeDeadlineForNextStep`), `lib/server/requests.test.ts` (5 test case mới).
- **API**: `app/api/requests/[id]/decision/route.ts` — tải thêm `approverSlaEnabled`/`slaByWorkCalendar`/`slaHours` của nhóm (đã tải nhóm sẵn cho việc khác), tính + ghi `deadlineAt` khi có thay đổi; vá `approverStepMeta` splice ở nhánh chuyển tiếp.
- **Không đổi**: `deadlineAt` field type (`string | null`, giữ nguyên), badge "Quá hạn" (`isOverdue()`) không đổi cách tính — chỉ đổi GIÁ TRỊ `deadlineAt` được ghi vào khi chuyển bước.
