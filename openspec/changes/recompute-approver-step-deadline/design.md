## Context

`resolveInitialSlaHours()` tính `deadlineAt` đúng 1 lần lúc gửi. Với luồng "Lần lượt" nhiều bước, mỗi bước có `slaHours` riêng (bật qua `approverSlaEnabled`), hạn xử lý thật sự nên hiểu là "mỗi bước có đồng hồ đếm ngược RIÊNG tính từ lúc tới lượt", không phải 1 đồng hồ chung tính từ lúc gửi theo SLA của bước đầu tiên áp dụng suốt.

## Goals / Non-Goals

**Goals:**
- Khi 1 người duyệt xong (hoặc bị chuyển tiếp) và đề xuất chuyển sang bước kế tiếp, `deadlineAt` được tính lại theo SLA của bước MỚI, từ THỜI ĐIỂM CHUYỂN BƯỚC.
- Không đổi hành vi khi `approverSlaEnabled` tắt hoặc luồng không phải "Lần lượt" (giữ đúng hành vi hiện tại — 1 deadline chung tính lúc gửi).

**Non-Goals:**
- Không tính lại deadline cho luồng "Đồng thời"/"Chỉ cần 1 người" — mọi người đã cùng bắt đầu từ lúc gửi, không có khái niệm "lượt kế tiếp" để tính lại.
- Không đổi cách tính "Quá hạn" (`isOverdue()`) — badge này vẫn so `deadlineAt` hiện tại với giờ đọc, không đổi công thức.
- Không xử lý "trả lại" (`returned`) — reset về pending toàn bộ, deadline cũ giữ nguyên cho tới khi người gửi gửi lại (đi qua lại đúng luồng tính deadline LÚC GỬI đã có sẵn, không thuộc phạm vi thay đổi bước).

## Decisions

1. **Tính lại ngay trong route quyết định** (`decision/route.ts`), không tách endpoint riêng — dùng đúng dữ liệu nhóm ĐÃ TẢI SẴN cho việc khác (requireDecisionNote/approvalTimeFields) trong cùng request, không thêm round-trip Firestore.
2. **`recomputeDeadlineForNextStep()` trả `undefined` để phân biệt "không đổi gì"** với `null` ("có tính, nhưng nhóm không đặt SLA nào cho bước này") — nơi gọi chỉ ghi đè field `deadlineAt` khi giá trị trả về KHÁC `undefined`, tránh vô tình xoá deadline hợp lệ trong các trường hợp không thuộc phạm vi (luồng khác, đã xong...).
3. **Phát hiện lỗi lệch mảng `approverStepMeta`** trong lúc làm — vá NGAY trong change này (không tách change riêng) vì nếu không vá, `recomputeDeadlineForNextStep()` sẽ đọc SAI SLA của bước kế tiếp sau bất kỳ lần chuyển tiếp nào (mục tiêu chính của change này sẽ sai ngay từ lần chuyển tiếp đầu tiên).

## Risks / Trade-offs

- [Rủi ro] Đổi giá trị `deadlineAt` giữa chừng có thể khiến "thời gian còn lại" hiển thị trên UI nhảy đột ngột (từ hạn cũ sang hạn mới của bước kế tiếp) — đây là hành vi ĐÚNG THEO Ý ĐỊNH Sếp xác nhận (mỗi bước có đồng hồ riêng), không phải lỗi, nhưng cần lưu ý khi test để không nhầm là bug.
- [Rủi ro] Đề xuất đã "Quá hạn" ở bước hiện tại, sau đó người duyệt (dù trễ) vẫn duyệt và chuyển sang bước kế tiếp → deadline MỚI tính từ bây giờ, không còn "Quá hạn" nữa (không cộng dồn phần trễ của bước trước) → Mitigation: đây là hệ quả tự nhiên của "mỗi bước có đồng hồ riêng", đã nêu rõ trong Goals; nếu Sếp muốn cộng dồn thời gian trễ thì cần 1 quyết định khác, chưa nằm trong phạm vi lần này.

## Migration Plan

Không cần backfill — đề xuất đang "pending" từ trước khi deploy change này sẽ dùng `deadlineAt` cũ (tính lúc gửi) cho tới lần quyết định TIẾP THEO xảy ra SAU khi deploy, lúc đó mới áp dụng công thức mới.
