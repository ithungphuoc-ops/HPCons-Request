## Context

Sếp chốt 16/08/2026: 1 bước duyệt cố định được gắn nhiều người, TẤT CẢ phải duyệt mới qua. Hệ thống hiện resolve `approverSteps` thành 1 danh sách NGƯỜI phẳng (`approversSnapshot: TaggedUser[]`) tại thời điểm gửi, rồi `lib/approval-logic.ts` tính trạng thái trên danh sách phẳng đó theo `approvalFlow` của nhóm ("concurrent" = tất cả phải duyệt bất kể thứ tự; "sequential" = tất cả phải duyệt theo thứ tự; "single" = 1 người là đủ).

## Goals / Non-Goals

- Goals: bước fixed nhiều người; tương thích ngược 100% dữ liệu `approverSteps` cũ (chỉ có `user` số ít); không đổi logic duyệt lõi.
- Non-Goals: KHÔNG thêm ngữ nghĩa "chỉ cần 1 trong nhóm" cho từng bước (Sếp đã chọn tất-cả-phải-duyệt; quy trình "single" cấp nhóm vẫn hoạt động như cũ); KHÔNG cho bước "submitter_manager" nhiều người (giữ 1 quản lý trực tiếp như cũ).

## Decisions

1. **Shape dữ liệu — THÊM `users?: TaggedUser[]`, GIỮ `user: TaggedUser`**: bước fixed mới lưu cả 2 (`user` = người đầu tiên, `users` = đủ danh sách). Dữ liệu cũ không có `users` → helper `fixedStepUsers(step)` trả `step.users?.length ? step.users : [step.user]`. Mọi code cũ đọc `step.user` vẫn chạy đúng (lấy người đầu tiên) — không cần migration.
2. **Ngữ nghĩa "tất cả phải duyệt" đạt được MIỄN PHÍ nhờ danh sách phẳng**: `resolveApproverStepsDetailed` mở rộng bước fixed nhiều người thành nhiều phần tử kết quả (cùng `index` bước) → `approversSnapshot` chứa đủ từng người → `getRequestStatus` flow concurrent/sequential sẵn có yêu cầu MỌI người trong danh sách approved. KHÔNG sửa `lib/approval-logic.ts`. (Lưu ý biết trước: nhóm đặt quy trình "single" thì 1 người bất kỳ duyệt là xong toàn đề xuất — đó là cấu hình cấp nhóm có sẵn, không phải bug của change này.)
3. **UI editor**: `DraftApproverStep` fixed đổi `user: TaggedUser | null` → `users: TaggedUser[]`; `TagUserInput` vốn multi-select, bỏ `.slice(-1)[0]` là xong. `toApproverSteps` chặn bước fixed 0 người.
4. **`ensureApproverStepCodes`** giữ nguyên slug theo `user.name` (người đầu tiên) — code bước đã có không đổi.
5. **`dedupeApprovers`** sẵn có xử lý người trùng giữa các bước (giữ lần xuất hiện sau cùng) — dùng luôn, không viết thêm.

## Risks / Trade-offs

- [Rủi ro] Code nào đó chỉ đọc `step.user` sẽ chỉ thấy người đầu tiên → Mitigation: grep toàn repo, cập nhật 4 chỗ dùng thật (requests.ts, editor, groups/page.tsx thay người hàng loạt, submit preview key); còn lại (`ensureApproverStepCodes`, mock-data) cố ý giữ người đầu tiên.
- [Trade-off] Preview người duyệt trên form gửi hiện mỗi người 1 dòng (bước 2 người = 2 dòng liền nhau) thay vì gộp 1 dòng 2 thẻ tên — chấp nhận để không đụng cấu trúc `ResolvedApproverStep`/màn hình duyệt; tinh chỉnh sau nếu Sếp muốn.
