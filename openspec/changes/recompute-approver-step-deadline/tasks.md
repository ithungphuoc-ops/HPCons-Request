## 1. Logic thuần (có test)

- [x] 1.1 `recomputeDeadlineForNextStep()` trong `lib/server/requests.ts`
- [x] 1.2 5 test case trong `lib/server/requests.test.ts` (tắt cờ, luồng khác, đã xong, tính đúng SLA bước kế, fallback SLA nhóm)

## 2. API

- [x] 2.1 `app/api/requests/[id]/decision/route.ts` — tải thêm `approverSlaEnabled`/`slaByWorkCalendar`/`slaHours` của nhóm
- [x] 2.2 Nối vào nhánh quyết định thường (approved/rejected)
- [x] 2.3 Nối vào nhánh chuyển tiếp (approve_and_forward/forward_then_approve)
- [x] 2.4 **Phát hiện + vá lỗi có sẵn**: `approverStepMeta` không được chèn phần tử khi chuyển tiếp thêm người — đã vá cùng lúc (chèn `{}` đúng vị trí)
- [x] 2.5 **Vá thêm theo góp ý CodeRabbit lúc review PR #3 (23/08/2026, mức 🟠 Major)**: bản vá 2.4 chỉ chặn được lệch mảng cho các lần "Chuyển tiếp" TỪ SAU KHI vá — đề xuất nào từng bị "Chuyển tiếp" TRƯỚC bản vá (nếu có, do local dev suốt phiên làm việc luôn nối Firestore thật) vẫn có thể đang mang `approverStepMeta` bị lệch. Đã thêm lớp bảo vệ thứ 2: `recomputeDeadlineForNextStep()` VÀ chỗ tra "Mẫu form phê duyệt" (`decision/route.ts`) đều chỉ tin `approverStepMeta` khi độ dài KHỚP ĐÚNG `approvers` — lệch độ dài thì coi như không có, rơi về `groupSlaHours`/bỏ qua field an toàn, không đoán nhầm bước.

## 3. Kiểm thử

- [x] 3.1 `npm run build` sạch
- [x] 3.2 `npx vitest run` — 211/211 pass
- [ ] 3.3 Kiểm thủ công trên local: tạo nhóm luồng "Lần lượt" bật SLA riêng bước, 2+ bước có SLA khác nhau, duyệt bước 1 rồi xác nhận "Thời gian còn lại" trên trang chi tiết nhảy sang đúng hạn của bước 2 tính từ lúc vừa duyệt — CẦN SẾP TỰ TEST, chưa thể tự làm
