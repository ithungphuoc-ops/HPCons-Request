## Why

Cơ chế điều kiện dùng chung hiện tại (`ConditionRule`) chỉ hỗ trợ **1 field – 1 toán tử – 1 giá trị**, và chỉ nhận field kiểu rời rạc (`single_choice`/`multiple_choice`/`department_select`) làm điều kiện. Đây là giới hạn có chủ đích từ change `add-base-vn-group-settings-parity` ("chưa có bằng chứng Base.vn thật cần điều đó"), nhưng thực tế nghiệp vụ hiện đã cần vượt qua giới hạn này ở 2 điểm cụ thể:

1. Cần kết hợp **nhiều điều kiện** cho cùng 1 field/bước duyệt/người theo dõi (ví dụ: chỉ hiện field "Số tài khoản ngân hàng" khi Phương thức thanh toán = Chuyển khoản **và** Nhóm đề xuất = Thanh toán).
2. Cần điều kiện dựa trên **ngưỡng số/ngày** (ví dụ: đơn hàng trên 20 triệu thì thêm bước duyệt cấp cao hơn) — hiện không làm được vì field số/tiền/ngày bị loại hoàn toàn khỏi danh sách field đủ điều kiện làm trigger.

## What Changes

- Đổi `ConditionRule` (1 rule) → `ConditionGroup` (mảng `ConditionRule[]` + `conjunction: "all" | "any"`), dùng chung cho cả 3 nơi tiêu thụ hiện có (`field.visibleWhen`, `approverStep.condition`, `followersConditional[].condition`). **BREAKING**: đổi kiểu dữ liệu lưu trong Firestore của 3 trường này — cần migration.
- Thêm 3 toán tử so sánh số/ngày vào `ConditionRule["operator"]`: `greater_than`, `less_than`, `between`.
- Mở `CONDITION_ELIGIBLE_TYPES` để nhận thêm `integer`, `decimal`, `currency`, `date` (giữ nguyên 3 loại cũ).
- `evaluateCondition()` (đổi tên/chữ ký cho phù hợp mảng) thêm nhánh ép kiểu số (parse `Number`) và ngày (parse `Date`) trước khi so sánh với `greater_than`/`less_than`/`between`; toán tử `equals`/`not_equals`/`includes` giữ nguyên hành vi so sánh string/array như cũ.
- Cập nhật UI `ConditionEditor` (dùng chung cho field/approver-step) và `FollowersConditionalEditor`: thêm nút "+ điều kiện", chọn `all`/`any` khi có ≥ 2 điều kiện, hiện input giá trị phù hợp theo operator (1 ô cho equals/greater_than/less_than, 2 ô cho between).
- Bổ sung validate `fieldCode` tồn tại khi lưu nhóm (API `PATCH /api/groups/[id]`) cho **cả 3 nơi** dùng `ConditionRule` (hiện chỉ validate `approverSteps.condition`, thiếu `field.visibleWhen` và `followersConditional`).
- Đồng bộ lại spec cũ (`conditional-approval-rules`): câu "ghi log cảnh báo phía server" khi field bị xoá không khớp code thật (không có log) — sửa 1 trong 2 cho khớp (chọn: bổ sung `console.warn` vào `evaluateCondition` khi field không tìm thấy, để giữ đúng cam kết spec gốc).
- Viết script migration 1 lần: mọi `ConditionRule` object đơn hiện có trong Firestore (field.visibleWhen, approverStep.condition, followersConditional[].condition) → bọc thành `{ conjunction: "all", rules: [rule] }` để không phá dữ liệu cũ.

## Capabilities

### New Capabilities
(không có capability hoàn toàn mới — đây là mở rộng của capability đã tồn tại)

### Modified Capabilities
- `conditional-approval-rules` (định nghĩa tại `openspec/changes/add-base-vn-group-settings-parity/specs/conditional-approval-rules/spec.md` — dự án chưa từng archive nên chưa có baseline ở `openspec/specs/`, đây là spec delta gốc cần viết tiếp delta chồng lên): thêm yêu cầu nhiều điều kiện (AND/OR) và toán tử so sánh số/ngày; sửa lại yêu cầu về log cảnh báo cho khớp hành vi thật.

## Impact

- **Kiểu dữ liệu**: `lib/types.ts` — `ConditionRule`, và kiểu lưu trữ của `ProposalField.visibleWhen`, `ApproverStepDef.condition`, `ProposalGroup.followersConditional[].condition`.
- **Logic**: `lib/server/conditions.ts` (`evaluateCondition`, `filterApplicableSteps`, `mergeFollowers`) và test đi kèm `lib/server/conditions.test.ts`.
- **UI**: `components/request/ApproverStepsEditor.tsx` (`CONDITION_ELIGIBLE_TYPES`, `ConditionEditor`), `components/request/FollowersConditionalEditor.tsx`, `components/request/modals/AddFieldModal.tsx` (nơi dùng `ConditionEditor` cho `visibleWhen`).
- **API**: `app/api/groups/[id]/route.ts` (validate field tồn tại khi lưu — mở rộng ra cả 3 nơi), `app/api/requests/route.ts` và `app/api/requests/[id]/route.ts` (nơi gọi `mergeFollowers`).
- **Nơi tiêu thụ không cần sửa** (đã xác nhận qua khảo sát code): `app/request/groups/[groupId]/submit/page.tsx` (`isFieldVisible`) và `lib/server/requests.ts` (`findMissingRequiredFields`, `resolveApproverStepsDetailed`) chỉ gọi hàm `evaluateCondition`/`filterApplicableSteps` mà không biết cấu trúc bên trong rule — thay đổi kiểu dữ liệu không ảnh hưởng các nơi này.
- **Dữ liệu Firestore hiện có**: cần migration 1 lần cho mọi `ProposalGroup` đã lưu (bọc rule đơn thành `ConditionGroup` 1 phần tử) — xem `migration-plan` trong `design.md`.
