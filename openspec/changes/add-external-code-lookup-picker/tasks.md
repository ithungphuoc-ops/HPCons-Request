## 1. Kiểu dữ liệu + registry nền tảng

- [x] 1.1 Thêm `ExternalCodeSourceId`, `ExternalCodeLookupConfig` vào `lib/types.ts`; thêm `ProposalField.externalCodeLookup?: ExternalCodeLookupConfig`; đánh dấu `ProposalField.contractCodeLookup` là `@deprecated` (giữ nguyên field, không xoá).
- [x] 1.2 Tạo `lib/external-code-sources.ts`: định nghĩa `ExternalCodeRecord`, `ExternalCodeSourceDef`, và hàm `resolveExternalCodeLookup(field)` xử lý tương thích ngược (Decision 8 design.md).

## 2. Nguồn dữ liệu (lib/congno.ts)

- [x] 2.1 Thêm hàm `loadSubcontractorCodeSuggestions()` (cache 5 phút, `unstable_cache`, cùng kiểu `loadContractCodeSuggestions`) — đọc collection `subcontractors`, CHỈ forward `ma`, `mst`, `ten`, `diaChi`; lọc bỏ bản ghi không có cả `ma` lẫn `mst`.
- [x] 2.2 Trong `lib/external-code-sources.ts`, đăng ký `EXTERNAL_CODE_SOURCES` với đúng 2 mục: `congno_contracts` (bọc `loadContractCodeSuggestions`, map `{codeValues:[code], display:{project,work,customerNameShort}}`) và `congno_subcontractors` (bọc hàm mới ở 2.1, map `{codeValues:[ma,mst].filter(Boolean), display:{ten,mst,diaChi}}`).
- [x] 2.3 Viết unit test cho 2 hàm loader mới/bọc lại (mock Firestore) — xác nhận KHÔNG có field nào ngoài danh sách cho phép lọt vào record trả về (đặc biệt `totalAfterTax` không xuất hiện). (`lib/congno.test.ts`, 3 test)

## 3. Server dùng chung (validate + route gợi ý)

- [x] 3.1 Đổi `findInvalidContractCodeFields` (lib/server/requests.ts) thành `findInvalidExternalCodeFields(fields, values)`: lọc field qua `resolveExternalCodeLookup`, gom theo `sourceId` (tránh gọi `loadRecords()` trùng), kiểm tra khớp OR theo `codeValues` (Decision 3, 4).
- [x] 3.2 Cập nhật 2 nơi gọi (`app/api/requests/route.ts:348`, `app/api/requests/[id]/route.ts:199`) sang tên hàm mới — KHÔNG đổi vị trí/thời điểm gọi trong luồng.
- [x] 3.3 Đổi route `app/api/groups/[id]/contract-code-suggestions/route.ts` thành `app/api/groups/[id]/external-code-suggestions/route.ts`: nhận `?fieldId=`, đọc `sourceId` qua `resolveExternalCodeLookup`, trả `{records: ExternalCodeRecord[]}`. Có thêm `?sourceId=` (thay `?fieldId=`) cho bước xem trước lúc CHƯA lưu field (AddFieldModal, mục 4) — field chưa tồn tại nên không tra được qua fieldId; `sourceId` được validate chặt (chỉ 2 giá trị đã đăng ký).
- [x] 3.4 Cập nhật test hiện có của `findInvalidContractCodeFields` (nếu có trong `lib/server/requests.test.ts`) sang hàm mới, thêm test case cho `subcontractors` (khớp theo `ma` HOẶC `mst`). (9 test, gồm cả field cũ `contractCodeLookup` lẫn field mới `externalCodeLookup`)

## 4. UI Admin — AddFieldModal.tsx (Phương án B — Decision 6)

- [x] 4.1 Thay checkbox "Bắt buộc khớp Số Hợp Đồng CĐT" bằng checkbox tổng quát "Bắt buộc khớp 1 mã tham chiếu ngoài" — bật lên mới hiện panel chọn nguồn.
- [x] 4.2 Panel bước 1: hiện đúng 2 thẻ nguồn từ `EXTERNAL_CODE_SOURCE_ID_LIST`/`EXTERNAL_CODE_SOURCE_LABELS` (client-safe, `lib/external-code-source-labels.ts`) — không có bước chọn project, không liệt kê collection khác.
- [x] 4.3 Bấm 1 thẻ → gọi route `external-code-suggestions?sourceId=&sample=1` (thêm ở 3.3) → hiện bảng xem trước CHỈ ĐỌC (không cho tick field), có xử lý lỗi tải (không chặn xác nhận nếu tải mẫu lỗi).
- [x] 4.4 Bấm "Xác nhận" → lưu `externalCodeLookup: {sourceId}` cho field đang sửa, hiện lại dạng tóm tắt (chip "Đã ràng buộc: <label>") kèm nút "Đổi lại" quay về bước chọn thẻ.
- [x] 4.5 Khi mở "Sửa trường" cho field đã có `contractCodeLookup: true` (chưa migrate) hoặc đã có `externalCodeLookup`, phải tự hiện đúng dạng tóm tắt đã chọn sẵn (qua `resolveExternalCodeSourceId` bản client-safe) — không bắt Admin chọn lại từ đầu mỗi lần mở sửa.

## 5. Client — submit/page.tsx (autocomplete)

- [x] 5.1 Đổi `ShortTextWithContractCodeLookup` thành `ShortTextWithExternalCodeLookup` nhận danh sách `ExternalCodeRecord[]` (gọi route mới ở 3.3) — lọc theo `codeValues` (1 dòng gợi ý/1 mã, 1 record có thể sinh nhiều dòng), cột phụ nối TẤT CẢ field trong `display` bằng " · " (không hard-code tên field nào — Decision 7).
- [x] 5.2 Giữ nguyên hành vi UX đang có: lọc ưu tiên khớp đầu chuỗi, `mismatch` khi rời ô không khớp, tối đa 30 gợi ý, hiện dòng phụ khi khớp chính xác 1 mã (tổng quát cho mọi nguồn, không riêng "hạng mục" của contracts).
- [x] 5.3 Cập nhật điều kiện hiện component này trong `switch (field.dataType)` để dùng `resolveExternalCodeSourceId(field)` (bản client-safe, `lib/external-code-source-labels.ts`) thay vì đọc trực tiếp `field.contractCodeLookup`.

## 6. Tương thích ngược dữ liệu cũ

- [x] 6.1 Xác nhận `resolveExternalCodeLookup`/`resolveExternalCodeSourceId` được gọi ở ĐỦ 4 nơi: validate server (3.1), route gợi ý (3.3), AddFieldModal lúc mở sửa (4.2), submit/page.tsx (5.3) — grep xác nhận không nơi nào khác đọc thẳng `field.contractCodeLookup`/`field.externalCodeLookup`.
- [x] 6.2 Test xác nhận field mẫu có `contractCodeLookup: true` (không có `externalCodeLookup`) vẫn bị chặn gửi đúng khi giá trị không khớp Số Hợp Đồng CĐT thật — `lib/server/requests.test.ts` (`contractCodeField()` dùng cờ cũ, 6 test đầu của describe block).
- [x] 6.3 Không viết script migrate dữ liệu Firestore hàng loạt (theo Decision 8 — cố ý không làm ở đợt này).

## 7. Kiểm chứng an toàn dữ liệu

- [x] 7.1 Rà lại toàn bộ response của route `external-code-suggestions` (cả 2 nguồn) — route chỉ JSON-serialize nguyên `records` từ `loadRecords()`, không có transform nào khác; `lib/congno.test.ts` xác nhận 2 hàm loader (nguồn thật cho `loadRecords()`) KHÔNG trả `totalAfterTax`/`nguon`/`hopDong` hay field nào ngoài danh sách cho phép.
- [x] 7.2 Grep toàn bộ code mới/sửa (`lib/congno.ts`, `lib/external-code-sources.ts`, route mới) — chỉ gọi `.collection("contracts")`, `.collection("subcontractors")` (2 nguồn cho phép) và `.collection("groups")` (collection RIÊNG của base-request-app, không phải Công nợ) — không có tên nào trong danh sách cấm.
- [x] 7.3 `EXTERNAL_CODE_SOURCES` là hằng số module-level trong `lib/external-code-sources.ts` (object literal, không đọc từ Firestore/biến môi trường/request nào) — route `external-code-suggestions` chỉ nhận `sourceId` qua query param và validate chặt bằng `isKnownSourceId` (chỉ 2 giá trị literal), không có đường nào thêm nguồn thứ 3 mà không sửa code.

## 8. Xác minh cuối

- [x] 8.1 `npx tsc --noEmit` sạch (chỉ còn 3 lỗi CÓ SẴN từ trước ở `lib/server/print-engine.test.ts`, không liên quan change này).
- [x] 8.2 `npm run build` sạch.
- [x] 8.3 `npx vitest run` — 364/364 pass (357 gốc + 7 mới `lib/congno.test.ts` + 4 mới `lib/server/requests.test.ts`, trừ 3 test cũ đổi tên theo hàm mới).
- [ ] 8.4 Kiểm chứng thật (Playwright, tài khoản test): field "Số Hợp Đồng CĐT" hiện có trên production vẫn hoạt động đúng sau deploy; tạo 1 field mới ràng buộc "Mã nhà thầu phụ", thử gõ đúng `ma` và đúng `mst` của cùng/khác nhà thầu, xác nhận cả 2 đều được chấp nhận, gõ sai bị chặn khi gửi chính thức. **CHƯA LÀM ĐƯỢC ở máy local** — thiếu biến môi trường `CONGNO_FIREBASE_SERVICE_ACCOUNT` (chỉ có trên Vercel), và phiên đăng nhập SSO thật (cookie domain `.hpcore.vn`) không hoạt động qua `localhost`. Cần làm SAU khi PR merge + deploy lên Vercel (đúng quy trình đã dùng cho các thay đổi trước của change này).

## 9. Kiến trúc V3 (30/09/2026 — xem "Cập nhật 30/09/2026" trong design.md)

Sau khi mục 1-8 lên production, Sếp phát hiện thiếu khớp theo tên + hồi quy hiển thị Số Hợp Đồng CĐT, rồi yêu cầu đổi hẳn từ "khớp OR nhiều field" sang "Admin chọn tường minh ĐÚNG 1 field", cộng thêm khả năng tự động điền chéo field. PR #56 (vá tạm OR-matching) bị đóng không merge, thay bằng đợt việc này.

- [x] 9.1 `lib/types.ts`: `ExternalCodeLookupConfig` thêm `matchField: string` (bắt buộc); thêm `AutofillFromLookupConfig { sourceFieldId, pullField }` + `ProposalField.autofillFromLookup?`.
- [x] 9.2 `lib/external-code-source-labels.ts` (file MỚI, client-safe): `EXTERNAL_CODE_SOURCE_FIELDS` (danh sách field hard-code mỗi nguồn, dùng chung cho chọn matchField VÀ chọn pullField autofill), `resolveExternalCodeLookup(field)` bản client-safe trả `{sourceId, matchField}` (fallback field mặc định cho field cũ chưa có `matchField`).
- [x] 9.3 `lib/external-code-sources.ts`: đổi `ExternalCodeRecord` từ `{codeValues, display}` sang `{fields: Record<string,string>}`; `loadRecords()` map phẳng toàn bộ field cho phép của nguồn.
- [x] 9.4 `lib/congno.ts`: thêm field thật `tenVietTat` (Firestore mới, xác nhận qua `git pull` repo Công nợ) vào `SubcontractorCodeSuggestion` + loader; cập nhật `lib/congno.test.ts`.
- [x] 9.5 `lib/server/requests.ts` `findInvalidExternalCodeFields`: đổi từ khớp OR nhiều `codeValues` sang so đúng `record.fields[matchField]`; cập nhật `lib/server/requests.test.ts` (`subcontractorCodeField(matchField, ...)` nhận tham số field cụ thể, thêm test riêng cho từng matchField: `ma`/`mst`/`ten`/`tenVietTat`, cộng test "khớp field A mà gõ đúng giá trị field B → vẫn báo lỗi").
- [x] 9.6 `app/request/groups/[groupId]/submit/page.tsx`: `ShortTextWithExternalCodeLookup` viết lại theo `matchField`; thêm `computeSecondary`/`computeMatchedNote` (curated display theo `sourceId`, thay bảng `DISPLAY_UI` tạm ở PR #56); thêm callback `onAutofillMatch`/`onMatchedFieldsChange` xuyên suốt `FieldRow`→`FieldControl`→component, cộng logic ở component cha tìm field có `autofillFromLookup.sourceFieldId` trỏ tới field vừa khớp để tự set giá trị.
- [x] 9.7 `components/request/modals/AddFieldModal.tsx`: mở rộng luồng chọn nguồn (Decision 6 cũ) từ 2 lên 3 bước (thêm bước chọn matchField, bảng xem trước tô nổi bật dòng đã chọn); thêm Row mới "Tự động điền từ trường khác" (chọn field nguồn trong nhóm đã có `externalCodeLookup`, chọn field dữ liệu muốn kéo sang) — 2 checkbox `lookupEnabled`/`autofillEnabled` tự tắt lẫn nhau.
- [x] 9.8 `npx tsc --noEmit` sạch, `npm run build` sạch, `npx vitest run` 374/374 pass.
- [ ] 9.9 Đóng PR #56 (`fix/external-code-lookup-display-and-name-match`) — không merge, ghi rõ lý do superseded bởi đợt việc này.
- [ ] 9.10 Kiểm chứng thật trên production sau deploy (giống 8.4, mở rộng thêm): field "Tên nhà thầu phụ đề xuất" khớp theo tên đúng chuẩn, field "MST Nhà thầu phụ" tự điền đúng theo tên vừa chọn (và vẫn sửa tay đè được), "Số Hợp Đồng CĐT" hiện lại đúng dạng cũ (chỉ `customerNameShort` + ghi chú hạng mục, không còn nối chuỗi generic).
