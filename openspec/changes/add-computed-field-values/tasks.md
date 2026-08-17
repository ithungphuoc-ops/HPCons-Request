## 1. Sửa hiển thị tiêu đề đề xuất (việc 1 — nhanh, làm trước)

- [x] 1.1 Tạo `lib/request-title.ts` — export `TITLE_FIELD_CODES` (Set dùng chung) và hàm `resolveRequestTitle(request)`
- [x] 1.2 Cập nhật `lib/print-template.ts` — xoá bản `TITLE_FIELD_CODES`/`resolveNameValue` cục bộ, import từ `lib/request-title.ts`
- [x] 1.3 Cập nhật `app/api/requests/[id]/export/route.ts` — dùng `resolveRequestTitle`/`TITLE_FIELD_CODES` dùng chung thay vì mảng mã hard-code riêng
- [x] 1.4 Cập nhật `lib/qlkctr-sync.ts` — dùng `TITLE_FIELD_CODES` dùng chung thay vì bản copy riêng
- [x] 1.5 Cập nhật `app/request/list/page.tsx` (dòng ~124-126, ~144-146) — dùng `resolveRequestTitle(r)` thay vì `r.groupNameSnapshot` trực tiếp
- [x] 1.6 Cập nhật `components/request/RequestDetailView.tsx` (dòng ~241, ~404) — dùng `resolveRequestTitle(request)` thay vì `request.groupNameSnapshot` trực tiếp (giữ nguyên dòng label "Nhóm đề xuất" ~404 vẫn hiện tên nhóm — đúng ý nghĩa của nhãn đó, không phải bug)
- [x] 1.7 Kiểm tra: `npx tsc --noEmit` sạch (chỉ còn 3 lỗi cũ không liên quan ở print-engine.test.ts)

## 2. Kiểu dữ liệu cho field computed

- [x] 2.1 Thêm `ComputedTemplateBranch`, `ComputedFieldConfig` vào `lib/types.ts`
- [x] 2.2 Thêm `computedFrom?: ComputedFieldConfig` vào `ProposalField`

## 3. Logic tính giá trị (`lib/server/computed-fields.ts`, file mới)

- [x] 3.1 Viết `resolveTemplate(template, values, fields)` — thay thế `${code}`, giữ nguyên chuỗi gốc nếu code không khớp field nào
- [x] 3.2 Viết `resolveComputedValue(config, values, fields)` — lặp branches theo thứ tự, trả về chuỗi của nhánh đầu tiên khớp điều kiện (hoặc không điều kiện), `null` nếu không nhánh nào khớp
- [x] 3.3 Viết `findReferencedComputedFieldCode` (tương đương `hasCircularComputedReference`) — kiểm tra 1 field computed có tham chiếu `${code}` tới field khác cũng có `computedFrom` không, dùng cho validate khi lưu nhóm

## 4. Test cho logic tính giá trị

- [x] 4.1 Test `resolveTemplate`: thay thế đúng nhiều `${code}` trong 1 chuỗi, giữ nguyên `${code}` không khớp field nào
- [x] 4.2 Test `resolveComputedValue`: nhánh đầu tiên khớp được dùng, nhánh sau bị bỏ qua dù cũng khớp
- [x] 4.3 Test `resolveComputedValue`: không nhánh nào khớp → trả `null`
- [x] 4.4 Test `resolveComputedValue`: nhánh không có `condition` luôn khớp (dùng làm mặc định/fallback cuối danh sách)
- [x] 4.5 Test `findReferencedComputedFieldCode`: phát hiện đúng khi field A tham chiếu field B có computedFrom; không báo sai khi field A chỉ tham chiếu field thường (10/10 test pass, `npx vitest run lib/server/computed-fields.test.ts`)

## 5. Validate khi lưu cấu hình nhóm

- [x] 5.1 Cập nhật `app/api/groups/[id]/route.ts` — khi `patch.fields` có field chứa `computedFrom`, validate: (a) điều kiện mỗi nhánh tham chiếu field có thật (tái dùng `validateConditionGroupFieldCodes`), (b) mọi `${code}` trong mẫu chuỗi mỗi nhánh phải tham chiếu field CÓ THẬT trong nhóm, (c) không tham chiếu tới field khác cũng có `computedFrom` (dùng `findReferencedComputedFieldCode`)
- [x] 5.2 Trả lỗi 400 rõ ràng cho từng trường hợp vi phạm ở trên

## 6. Máy chủ tự tính lại khi gửi chính thức (không tin client)

- [x] 6.1 Cập nhật CẢ 2 nơi xử lý gửi chính thức (`app/api/requests/route.ts` POST — gửi mới; `app/api/requests/[id]/route.ts` PATCH — sửa & gửi lại/gửi lại sau khi bị trả về) — với mọi field có `computedFrom`, gọi `resolveComputedValue` và ghi đè vào `values[field.id]` trước khi kiểm tra thiếu trường bắt buộc + lưu, bất kể client gửi gì

## 7. UI cấu hình (`AddFieldModal.tsx`)

- [x] 7.1 Thêm mục "Tự động ghép giá trị từ trường khác" cho field kiểu `short_text`/`paragraph` — checkbox bật/tắt + danh sách nhánh, mỗi nhánh: `ConditionEditor` (tái dùng) cho điều kiện (tuỳ chọn) + textarea cho mẫu chuỗi
- [x] 7.2 Nút "+ Thêm nhánh" / xoá nhánh
- [x] 7.3 Gợi ý/liệt kê danh sách mã field (`${code}`) có thể dùng ngay trong mẫu chuỗi (đã lọc bỏ chính field đang sửa + các field tự tính khác), để admin không phải nhớ tay mã trường

## 8. Render trên form Gửi đề xuất

- [x] 8.1 Cập nhật `app/request/groups/[groupId]/submit/page.tsx` — field có `computedFrom`: tính `resolveComputedValue` mỗi khi giá trị field nguồn đổi (useEffect với guard trả nguyên tham chiếu cũ khi không đổi — không vòng lặp), nếu có kết quả thì tự set vào `values[field.id]` + hiển thị input dạng chỉ đọc (nền xám, kèm dòng chú thích); nếu `null` thì cho gõ tay bình thường
- [x] 8.2 QUYẾT ĐỊNH LÚC LÀM (đơn giản hoá so với kế hoạch): KHÔNG tổng quát hoá `conditionFieldIds`/`relevantValuesKey` — cơ chế đó dành cho việc ĐẮT (gọi API preview người duyệt qua mạng), còn tính lại field tự tính chỉ là ghép chuỗi thuần trên client (rẻ, <1ms), chạy mỗi lần values đổi cũng không sao. Tách riêng 1 useEffect có guard chống render thừa là đủ, code dễ hiểu hơn.

## 9. Áp dụng cho dữ liệu thật — nhóm "2. Phiếu đề nghị"

- [x] 9.1 Viết script 1 lần `scripts/configure-computed-ten-de-xuat.ts` (Admin SDK, theo khuôn mẫu migrate-condition-rules.ts, có dry-run + kiểm tra 4 field nguồn tồn tại trước khi ghi) cấu hình `computedFrom` cho field `ten_de_xuat` (groupId `MbSGRaYx0FGGsObPjk4f`): nhánh 1 — điều kiện `lua_chon_de_nghi = "Đề nghị công trình"`, mẫu `"${so_hop_dong}-${ten_cong_trinh}"`; nhánh 2 — điều kiện `lua_chon_de_nghi = "Đề nghị phòng ban"`, mẫu `"Đề nghị ${bo_phan}"`
- [x] 9.2 Đã chạy thật 16/08/2026, script tự đọc lại Firestore sau khi ghi và xác nhận đủ 2 nhánh đúng nội dung

## 11. Danh sách toàn màn hình, box nội dung chỉ hiện khi bấm (Sếp bổ sung 16/08/2026, sau khi test bản deploy đầu)

- [x] 11.1 `app/request/list/page.tsx` — bỏ tự chọn sẵn đề xuất đầu tiên; chưa chọn gì thì danh sách chiếm toàn chiều rộng, không render khung nội dung
- [x] 11.2 Bấm 1 đề xuất → danh sách thu về cột trái 320px + box nội dung hiện bên phải (màn hình nhỏ ẩn cột danh sách để box đủ chỗ đọc); nút "Đóng" (X) quay lại danh sách toàn màn hình
- [x] 11.3 Dòng danh sách hiện đủ: tên đề xuất (đậm) + dòng phụ "Nhóm đề xuất · người gửi · ngày đề nghị" (Sếp chốt 17/08/2026; áp dụng cả dòng nháp)
- [x] 11.4 Mã đề nghị đổi từ 6 → 9 chữ số (`nextCounterCode` padStart 9; Sếp chốt 17/08/2026) — mã cũ đã cấp trong đề xuất đã gửi GIỮ NGUYÊN, chỉ mã cấp mới theo 9 số; cập nhật test validation.test.ts

## 10. Kiểm tra tổng thể trước khi archive

- [x] 10.1 `npx tsc --noEmit` sạch (ngoài 3 lỗi có sẵn không liên quan ở `print-engine.test.ts`)
- [x] 10.2 `npx vitest run` toàn bộ pass — 149/149 (9 file test, gồm 10 test mới của computed-fields)
- [x] 10.3 `npx next build` sạch
- [x] 10.4 `openspec validate add-computed-field-values --strict` pass
