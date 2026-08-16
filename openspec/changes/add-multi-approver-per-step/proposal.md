## Why

Hiện tại 1 bước duyệt (`ApproverStepDef`) chỉ gắn được ĐÚNG 1 người — hoặc 1 người cố định (`kind: "fixed"`, `user: TaggedUser` số ít), hoặc tự động lấy quản lý trực tiếp (`kind: "submitter_manager"`). Sếp muốn: ngoài người mặc định (quản lý trực tiếp hoặc người @tag cố định), có thể **thêm người khác cùng duyệt trong CÙNG 1 bước** — tức 1 bước có thể có nhiều hơn 1 người, không phải thêm 1 bước mới (bước mới đã làm được từ trước, đây là nhu cầu khác: gộp nhiều người vào cùng 1 hàng/bước).

**Trạng thái xác nhận (15/08/2026):** Đã tra trực tiếp trong code (`lib/types.ts` — `ApproverStepDef`) và xác nhận: khả năng "nhiều người trong 1 bước" **CHƯA tồn tại**. Sếp có nhắc đã từng yêu cầu việc này trước đó nhưng không tìm thấy ghi nhận rõ ràng nào khác trong phạm vi đã tra được (phiên làm việc đã qua nhiều lần nén ngữ cảnh) — coi đây là yêu cầu MỚI, chưa từng implement.

## What Changes (dự kiến, CHƯA thiết kế chi tiết)

- Đổi `ApproverStepDef` từ 1 user/bước sang nhiều user/bước (cấu trúc chính xác cần thiết kế thêm)
- Cập nhật `ApproverStepsEditor.tsx` (UI): cho phép @tag thêm người vào cùng 1 "Bước" đã có sẵn quản lý trực tiếp hoặc người cố định
- Cập nhật logic tính "bước đã xong chưa" trong `lib/approval-logic.ts` (đây là phần lõi, ảnh hưởng rộng — SLA, trạng thái đề xuất...)

## Capabilities

### New Capabilities
(chưa xác định — cần explore thêm trước khi chốt tên capability)

### Modified Capabilities
- Có thể là mở rộng của `conditional-approval-rules` hoặc 1 capability riêng cho luồng duyệt (`approver-steps` hoặc tương tự) — cần rà lại `lib/approval-logic.ts` để đặt tên đúng.

## Impact

- `lib/types.ts` (`ApproverStepDef`)
- `lib/approval-logic.ts` (logic tính trạng thái duyệt — ẢNH HƯỞNG LÕI, cần cẩn thận)
- `components/request/ApproverStepsEditor.tsx`
- `lib/server/requests.ts` (`resolveApproverStepsDetailed`, `resolveApproverSteps`)

## Open Questions (BẮT BUỘC trả lời trước khi thiết kế)

1. **Khi 1 bước có nhiều người: cần TẤT CẢ duyệt xong mới qua bước tiếp theo, hay chỉ cần 1 người bất kỳ trong số họ duyệt là đủ?** (Sếp chưa trả lời câu này — đã hỏi ở cuộc trò chuyện trước, chưa có câu trả lời)
2. Khi thêm người vào cùng 1 bước với "Quản lý trực tiếp" (tự động), người thêm vào là cố định hay cũng tự động theo quy tắc nào đó?
3. Hiển thị trên UI đề xuất (khi xem chi tiết 1 đề xuất) thể hiện nhiều người/1 bước như thế nào — liệt kê tên cả 2-3 người cùng hàng?

## Trạng thái

**CHƯA THIẾT KẾ, CHƯA CODE.** Đây là bản ghi nhận ý tưởng (proposal-only) để không bị quên — dừng lại chờ Sếp trả lời Open Questions ở trên rồi mới làm design.md/specs/tasks.
