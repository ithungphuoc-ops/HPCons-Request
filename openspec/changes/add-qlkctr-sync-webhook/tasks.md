## 1. Xác nhận trước khi code (đã chốt ở phiên làm việc trước với "Sếp")

- [x] 1.1 Xác nhận không cần thêm field mới — dùng lại "Tên đề xuất" + "Chi tiết" có sẵn, đối chiếu bằng dữ liệu thật (đề xuất #000012, nhóm "2. Phiếu đề nghị")
- [x] 1.2 Xác nhận không lọc theo `groupId` — chấp nhận đề xuất không liên quan công trình sẽ nằm chờ Admin xử lý tay bên QLK CTR
- [x] 1.3 Xác nhận điểm kích hoạt: `status === "approved"` tại `app/api/requests/[id]/decision/route.ts` (đọc code thật, không suy đoán)
- [x] 1.4 Xác nhận không cần trao đổi thêm với người giữ repo này trước khi code (đã được xác nhận trực tiếp)

## 2. Trích xuất dữ liệu

- [x] 2.1 Viết `lib/qlkctr-sync.ts::trichXuatPayload()` — tìm field theo `code` quen thuộc + fallback theo tên hiển thị
- [x] 2.2 Tra vị trí cột bảng "Chi tiết" theo TÊN cột (`tableColumns`), không theo số thứ tự cố định
- [x] 2.3 Lọc bỏ dòng vật tư thiếu tên hoặc số lượng ≤ 0

## 3. Gọi API + nối vào luồng duyệt

- [x] 3.1 Viết `lib/qlkctr-sync.ts::guiSangQlkCtr()` — POST kèm `x-api-key`, timeout 8s, không throw ra ngoài
- [x] 3.2 Sửa `app/api/requests/[id]/decision/route.ts` — gọi đồng bộ khi `status === "approved"`, bọc try/catch riêng
- [x] 3.3 Ghi kết quả đồng bộ (thành công/thất bại) vào `history`
- [x] 3.4 Thêm `QLKCTR_API_URL`/`QLKCTR_API_KEY` vào `.env.local.example`

## 4. Test

- [ ] 4.1 Test `trichXuatPayload()` với `RequestInstance` dựng tay: đúng field theo code, field đổi tên nhưng đúng code, cột bị đảo thứ tự, thiếu bảng chi tiết → `null`
- [ ] 4.2 Test `guiSangQlkCtr()` khi chưa cấu hình `QLKCTR_API_URL` → không lỗi, trả `ok:false` êm
- [ ] 4.3 Test gọi thật vào QLK CTR đang chạy `npm run dev` cục bộ, xác nhận tạo đúng đề nghị
- [ ] 4.4 `npx tsc --noEmit` sạch

## 5. Trước khi merge vào `main` (chưa làm — chờ Sếp duyệt riêng)

- [ ] 5.1 Sếp xác nhận domain thật + tạo `QLKCTR_API_KEY`, điền vào Vercel env của app này
- [ ] 5.2 Merge nhánh `add-qlkctr-sync-webhook` vào `main` (KHÔNG tự ý push/merge khi chưa có xác nhận rõ ràng)
