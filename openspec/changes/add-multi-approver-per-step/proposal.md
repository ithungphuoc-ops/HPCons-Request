## Why

Hiện tại 1 bước duyệt (`ApproverStepDef`) chỉ gắn được ĐÚNG 1 người — hoặc 1 người cố định (`kind: "fixed"`, `user: TaggedUser` số ít), hoặc tự động lấy quản lý trực tiếp (`kind: "submitter_manager"`). Sếp muốn: ngoài người mặc định (quản lý trực tiếp hoặc người @tag cố định), có thể **thêm người khác cùng duyệt trong CÙNG 1 bước** — tức 1 bước có thể có nhiều hơn 1 người, không phải thêm 1 bước mới (bước mới đã làm được từ trước, đây là nhu cầu khác: gộp nhiều người vào cùng 1 hàng/bước).

**Trạng thái xác nhận (15/08/2026):** Đã tra trực tiếp trong code (`lib/types.ts` — `ApproverStepDef`) và xác nhận: khả năng "nhiều người trong 1 bước" **CHƯA tồn tại**.

**16/08/2026 — Sếp đã chốt Open Question 1:** khi 1 bước có nhiều người, **TẤT CẢ phải duyệt mới qua bước đó** (chặt chẽ hơn). Được phép thiết kế + code.

## What Changes

- Bước duyệt `kind: "fixed"` gắn được NHIỀU người (mảng `users`), giữ nguyên `user` (người đầu tiên) để tương thích dữ liệu cũ
- `ApproverStepsEditor.tsx`: ô @tag của bước "Người cố định" cho chọn nhiều người thay vì tự thay người cũ khi chọn người mới
- `resolveApproverStepsDetailed`/`resolveApproverSteps`: bước fixed nhiều người mở rộng thành nhiều dòng người duyệt trong danh sách phẳng — với quy trình "Xử lý đồng thời"/"Lần lượt" sẵn có, TẤT CẢ những người này đều phải duyệt (đúng lựa chọn của Sếp), KHÔNG cần đổi `lib/approval-logic.ts`
- Trang thay người duyệt hàng loạt (`app/request/groups/page.tsx`) xử lý cả mảng `users`

## Capabilities

### New Capabilities
- `multi-approver-step`: 1 bước duyệt cố định chứa nhiều người, tất cả đều phải duyệt

## Impact

- `lib/types.ts` (`ApproverStepDef` — thêm `users?`, giữ `user`)
- `components/request/ApproverStepsEditor.tsx` (Draft type + UI @tag nhiều người)
- `lib/server/requests.ts` (`resolveApproverStepsDetailed` mở rộng bước fixed nhiều người)
- `app/request/groups/page.tsx` (thay người duyệt hàng loạt)
- `app/request/groups/[groupId]/submit/page.tsx` (key React của dòng preview người duyệt)
- KHÔNG đổi `lib/approval-logic.ts` (danh sách người duyệt phẳng sẵn có đã cho đúng ngữ nghĩa "tất cả phải duyệt" với quy trình đồng thời/lần lượt)

## Open Questions còn lại (đã chọn mặc định an toàn, không chặn)

2. Người thêm vào cùng 1 bước: **cố định** (đúng nhu cầu Sếp mô tả — @tag thêm người cụ thể). Bước "Quản lý trực tiếp" tự động giữ nguyên 1 người như cũ; muốn thêm người cùng duyệt với quản lý thì thêm vào bước fixed liền kề hoặc đổi bước đó sang fixed nhiều người.
3. Hiển thị chi tiết đề xuất: danh sách người duyệt vốn là danh sách phẳng từng người (mỗi người 1 dòng trạng thái duyệt riêng) — giữ nguyên, nhiều người trong 1 bước hiện thành nhiều dòng liền nhau theo thứ tự.
