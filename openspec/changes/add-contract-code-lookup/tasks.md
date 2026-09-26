## 1. Kiểu dữ liệu

- [x] 1.1 Thêm `contractCodeLookup?: boolean` vào `ProposalField` trong `lib/types.ts`, cạnh `suggestFromHistory`, kèm comment giải thích (chỉ short_text, KHÔNG đoán theo tên field)

## 2. Kết nối cross-project app Công nợ

- [x] 2.1 Tạo `lib/congno.ts` — sao chép cấu trúc `lib/hpcore.ts`: Admin App tên `"congno"`, credential từ `CONGNO_FIREBASE_SERVICE_ACCOUNT`, export `getCongNoDb()`
- [x] 2.2 Không tạo bất kỳ hàm ghi nào (chỉ đọc) — `lib/congno.ts` chỉ export `getCongNoDb()` + `loadContractCodeSuggestions()` (đọc), không có `set`/`update`/`delete` nào

## 3. Route gợi ý

- [x] 3.1 Tạo `app/api/groups/[id]/contract-code-suggestions/route.ts` (GET, tham số `fieldId`) — theo mẫu `field-suggestions/route.ts`
- [x] 3.2 Đọc collection `contracts` từ `getCongNoDb()` (qua `loadContractCodeSuggestions()` dùng chung với validate server), map CHỈ `{ code, project }` — KHÔNG forward field nào khác
- [x] 3.3 Bọc bằng `unstable_cache`, revalidate 300 giây
- [x] 3.4 Thiếu `CONGNO_FIREBASE_SERVICE_ACCOUNT`/lỗi kết nối → bắt bởi `apiErrorResponse` (try/catch có sẵn của route), trả JSON lỗi rõ ràng, không crash

## 4. UI Admin — thiết lập mẫu

- [x] 4.1 Thêm state `contractCodeLookup` trong `AddFieldModal.tsx` (đúng mẫu `suggestFromHistory`: load lúc edit, reset lúc tạo mới, chỉ gửi `true` khi short_text + đang bật)
- [x] 4.2 Thêm UI công tắc mới, đặt ngay dưới khối "Gợi ý từ lịch sử" — label "Bắt buộc khớp Số Hợp Đồng CĐT (app Công nợ)" + mô tả phân biệt rõ với "Gợi ý từ lịch sử"

## 5. UI Submit — điền đề xuất

- [x] 5.1 Tạo component `ShortTextWithContractCodeLookup` — gọi route gợi ý, hiện datalist, `onBlur` validate + hiện lỗi đỏ tại chỗ nếu không khớp
- [x] 5.2 Sửa `FieldControl` (case `"short_text"`): `contractCodeLookup` ưu tiên hơn `suggestFromHistory` nếu Admin lỡ bật cả 2 (ghi rõ trong comment code)

## 6. Validate chặn gửi (server)

- [x] 6.1 Thêm hàm `findInvalidContractCodeFields` (async) trong `lib/server/requests.ts`, dùng chung `loadContractCodeSuggestions()` với route gợi ý
- [x] 6.2 Gọi ở `app/api/requests/route.ts`, cùng vị trí `findMissingRequiredFields`/`findBlockedDateLeadTimeFields`, chỉ khi `!isDraft`
- [x] 6.3 Gọi ở `app/api/requests/[id]/route.ts` (gửi từ nháp), cùng điều kiện
- [x] 6.4 Thiếu `CONGNO_FIREBASE_SERVICE_ACCOUNT` lúc validate → lỗi bị bắt bởi try/catch ngoài cùng có sẵn của cả 2 route (`apiErrorResponse`), trả JSON rõ ràng thay vì 500 mơ hồ — xác nhận bằng đọc code, không cần thêm try/catch riêng

## 7. Xác minh cuối

- [x] 7.1 `npm run build` sạch
- [x] 7.2 Xác nhận qua `git status`/đọc lại code: "Tên công trình" và mọi field khác không bị đụng, không có liên kết/tự động điền chéo nào
- [x] 7.3 Viết 6 unit test mới cho `findInvalidContractCodeFields` (mock `loadContractCodeSuggestions`) — khớp đúng/không khớp/cờ tắt/rỗng/field ẩn/kiểu dữ liệu sai — cả 339 test (333 cũ + 6 mới) đều pass. Việc thiếu `CONGNO_FIREBASE_SERVICE_ACCOUNT` **thật** trên máy dev chưa kiểm chứng được bằng cách gọi route thật qua HTTP (cần Sếp cấp key trước — xem nhóm việc CẦN SẾP LÀM bên dưới), nhưng hành vi graceful-fail đã xác nhận qua đọc code (mục 3.4/6.4).
- [ ] 7.4 (Không áp dụng — repo này không có file `.env.example`)

## 8. CẦN SẾP LÀM (ngoài code)

- [ ] 8.1 Cấp `CONGNO_FIREBASE_SERVICE_ACCOUNT` (service account JSON project "hpcons-congno") — thêm vào Vercel (Production + Preview)
- [ ] 8.2 Sau khi có key: vào 1 nhóm đề xuất thật, bật công tắc "Bắt buộc khớp Số Hợp Đồng CĐT" cho field "Số Hợp Đồng CĐT", thử gửi đề xuất thật với mã đúng/mã sai để xác nhận hành vi thật trên production
