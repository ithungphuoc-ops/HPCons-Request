## 1. Kiểu dữ liệu

- [x] 1.1 Thêm `ConditionGroup` vào `lib/types.ts` (`{ conjunction: "all" | "any"; rules: ConditionRule[] }`)
- [x] 1.2 Mở rộng `ConditionRule["operator"]` thêm `"greater_than" | "less_than" | "between"`, thêm field tùy chọn `valueTo?: string`
- [x] 1.3 Đổi kiểu `ProposalField.visibleWhen`, `ApproverStepDef.condition`, `ProposalGroup.followersConditional[].condition` từ `ConditionRule | undefined` sang `ConditionGroup | undefined`
- [x] 1.4 Cập nhật JSDoc comment ở các kiểu trên cho khớp hành vi mới (nhiều rule, AND/OR, toán tử số/ngày)

## 2. Logic đánh giá điều kiện (`lib/server/conditions.ts`)

- [x] 2.1 Viết hàm nội bộ `evaluateRule(rule, values, fields)` — giữ nguyên logic 3 toán tử cũ (equals/not_equals/includes), thêm nhánh `greater_than`/`less_than`/`between` với ép kiểu số/ngày, trả `false` khi không ép kiểu được
- [x] 2.2 Thêm log cảnh báo (`console.warn`) khi `rule.fieldCode` không tìm thấy trong `fields` (đồng bộ lại với yêu cầu spec đã có sẵn nhưng code cũ thiếu)
- [x] 2.3 Viết `evaluateConditionGroup(group, values, fields)` — lặp `group.rules` bằng `evaluateRule`, gộp theo `conjunction` (`every`/`some`); nhóm rỗng trả `true`
- [x] 2.4 Cập nhật `filterApplicableSteps` và `mergeFollowers` để gọi `evaluateConditionGroup` thay vì `evaluateCondition`
- [x] 2.5 Cập nhật mọi nơi import `evaluateCondition` (`app/request/groups/[groupId]/submit/page.tsx`, `lib/server/requests.ts`) sang `evaluateConditionGroup`

## 3. Test

- [x] 3.1 Cập nhật `lib/server/conditions.test.ts`: sửa fixture rule đơn cũ thành `ConditionGroup` 1 rule, xác nhận mọi test case cũ vẫn pass với hành vi giống hệt
- [x] 3.2 Thêm test: nhóm AND với 2+ rule (thoả/không thoả)
- [x] 3.3 Thêm test: nhóm OR với 2+ rule (thoả/không thoả)
- [x] 3.4 Thêm test: `greater_than`/`less_than`/`between` với field số hợp lệ
- [x] 3.5 Thêm test: `greater_than`/`less_than`/`between` khi giá trị không ép kiểu số được → trả `false`, không throw
- [x] 3.6 Thêm test: nhóm điều kiện rỗng (`rules: []`) → luôn trả `true`
- [x] 3.7 Thêm test: log cảnh báo được gọi đúng 1 lần khi field không tồn tại (spy `console.warn`)

## 4. Migration dữ liệu Firestore

- [x] 4.1 Viết script `scripts/migrate-condition-rules.ts` (Admin SDK, theo đúng khuôn mẫu script trước đây trong dự án) — quét mọi `ProposalGroup`, phát hiện rule đơn cũ (có `fieldCode`, không có `rules`) ở `fields[].visibleWhen`, `approverSteps[].condition`, `followersConditional[].condition`
- [x] 4.2 Bọc mỗi rule đơn cũ tìm thấy thành `{ conjunction: "all", rules: [rule] }`, ghi lại Firestore
- [x] 4.3 Log ra số lượng field/bước duyệt/follower đã migrate theo từng nhóm để đối chiếu tay
- [x] 4.4 Chạy thử script ở chế độ dry-run (chỉ log, không ghi) trước khi chạy thật — ĐÃ CHẠY THẬT trên dữ liệu production thật (chỉ đọc): phát hiện 2/15 nhóm cần migrate, 6 field `visibleWhen` (khớp đúng ví dụ "Thiết bị..." trong code gốc), 0 bước duyệt/follower cần migrate. Phát sinh phụ: phải cài thêm `server-only` làm devDependency + chạy với `NODE_OPTIONS="--conditions=react-server"` thì script (và cả `seed-groups.ts` có sẵn) mới chạy được qua tsx — đây là gap có sẵn từ trước, không phải do thay đổi của change này.
- [x] 4.5 Backup dữ liệu Firestore liên quan trước khi chạy migration thật trên production — đã backup 15 nhóm ra JSON (ngoài repo) trước khi ghi. **ĐÃ CHẠY MIGRATION THẬT** (Sếp xác nhận 15/08/2026): 2/15 nhóm, 6 field `visibleWhen` đã chuyển đúng sang `ConditionGroup`. Xác nhận bằng: (a) dry-run lại sau đó ra 0/15 thay đổi còn sót, (b) đọc trực tiếp 1 nhóm ("1. PDN Thiết Bị IT") thấy đúng 4 field "Thiết bị..." đã có `visibleWhen: {conjunction:"all", rules:[...]}` khớp ví dụ gốc trong code.

## 5. Validate API khi lưu nhóm

- [x] 5.1 Viết hàm dùng chung `validateConditionGroupFieldCodes(group: ConditionGroup, knownFieldCodes: Set<string>)` trong `lib/server/conditions.ts` (hoặc file validate riêng), trả về `fieldCode` đầu tiên không hợp lệ nếu có
- [x] 5.2 Áp dụng hàm trên cho `patch.approverSteps[].condition` trong `app/api/groups/[id]/route.ts` (thay logic validate cũ chỉ check 1 field)
- [x] 5.3 Áp dụng hàm trên cho `patch.fields[].visibleWhen` (hiện chưa được validate)
- [x] 5.4 Áp dụng hàm trên cho `patch.followersConditional[].condition` (hiện chưa được validate)
- [x] 5.5 Trả lỗi 400 với thông báo rõ field/nơi cấu hình nào tham chiếu field không tồn tại

## 6. UI cấu hình điều kiện

- [x] 6.1 Cập nhật `ConditionEditor` (`components/request/ApproverStepsEditor.tsx`) nhận/trả `ConditionGroup` thay vì `ConditionRule` đơn
- [x] 6.2 Thêm nút "+ điều kiện" để thêm rule con mới vào nhóm
- [x] 6.3 Khi nhóm có ≥ 2 rule con, hiện dropdown chọn kết hợp "và"/"hoặc" (`conjunction`)
- [x] 6.4 Lọc danh sách toán tử hiển thị theo `dataType` của field đang chọn trong mỗi rule con (rời rạc → equals/not_equals/includes; số/ngày → equals/not_equals/greater_than/less_than/between)
- [x] 6.5 Với toán tử `between`, hiện 2 ô nhập giá trị (từ/đến) thay vì 1 ô
- [x] 6.6 Mở `CONDITION_ELIGIBLE_TYPES` thêm `integer`, `decimal`, `currency`, `date`
- [x] 6.7 Cập nhật `components/request/FollowersConditionalEditor.tsx` theo cùng thay đổi (nhiều rule + conjunction + lọc operator theo kiểu field)
- [x] 6.8 Kiểm tra `components/request/modals/AddFieldModal.tsx` (nơi dùng `ConditionEditor` cho `visibleWhen`) vẫn hoạt động đúng sau khi đổi props

## 7. Đồng bộ tài liệu

- [x] 7.1 Xác nhận spec delta (`specs/conditional-approval-rules/spec.md` trong change này) khớp hành vi code thật sau khi implement xong — đối chiếu từng scenario với test suite (32 test đều pass, bao phủ đúng các scenario: AND/OR, ngưỡng số/ngày, nhóm rỗng, log cảnh báo, validate 3 nơi)
- [x] 7.2 Chạy `openspec validate extend-condition-rules --strict` trước khi archive — pass

## 8. Kiểm thử thủ công trước khi archive

- [ ] 8.1 Test thủ công: field "Số tài khoản ngân hàng" chỉ hiện khi "Phương thức thanh toán" = "Chuyển khoản" (ví dụ gốc của Sếp) — xác nhận vẫn hoạt động sau migration
- [ ] 8.2 Test thủ công: tạo 1 nhóm điều kiện AND 2 rule (1 rời rạc + 1 số) cho 1 field mới, xác nhận hiện/ẩn đúng
- [ ] 8.3 Test thủ công: tạo 1 bước duyệt có điều kiện OR 2 rule, xác nhận preview người duyệt đúng
- [ ] 8.4 Test thủ công: lưu 1 điều kiện tham chiếu field đã xoá qua API trực tiếp (không qua UI) — xác nhận bị từ chối 400 ở cả 3 nơi (field/approver-step/follower)
- [ ] 8.5 Test thủ công: chọn toán tử "rỗng"/"không rỗng", xác nhận ô "Giá trị" tự ẩn và lưu/đánh giá đúng

## 9. Bổ sung toán tử "không nằm trong" / "rỗng" / "không rỗng" (15/08/2026)

Rà lại thấy đợt đầu (mục 1-8) mới làm "nhiều điều kiện AND/OR" + "so sánh số/ngày",
CHƯA có đúng 2 nhóm toán tử Sếp liệt kê trong góp ý gốc: "không nằm trong" và
"rỗng"/"không rỗng". Bổ sung nốt cho khớp yêu cầu ban đầu.

- [x] 9.1 Thêm `"not_includes" | "is_empty" | "is_not_empty"` vào `ConditionRule["operator"]` (`lib/types.ts`)
- [x] 9.2 `evaluateRule` (`lib/server/conditions.ts`): `not_includes` (mảng không chứa giá trị; không phải mảng → coi như đúng), `is_empty`/`is_not_empty` (rỗng = undefined/null/""/mảng rỗng) — áp dụng cho MỌI kiểu field, không riêng multiple_choice
- [x] 9.3 `operatorsForField()` + `operatorLabels` ở cả `ApproverStepsEditor.tsx` và `FollowersConditionalEditor.tsx` (2 bản sao, phải sửa đồng bộ) — field rời rạc thêm "không chứa", mọi field thêm "rỗng"/"không rỗng"
- [x] 9.4 Ẩn ô nhập "Giá trị" khi operator là `is_empty`/`is_not_empty` (không cần nhập) — cả 2 file trên
- [x] 9.5 Thêm 8 test case cho 3 toán tử mới vào `conditions.test.ts` (40/40 test pass)
- [x] 9.6 Build + typecheck lại toàn app — sạch (1 lỗi `print-engine.test.ts` có sẵn từ trước, không liên quan)
