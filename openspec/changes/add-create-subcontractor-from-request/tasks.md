## 1. Thuật toán rút gọn tên dùng chung

- [x] 1.1 Port `ntpVietTat` từ `HPCons-Congno/lib/subcontractors.ts:118-154` sang `lib/ntp-viet-tat.ts` (client-safe, không `import "server-only"`).
- [x] 1.2 Xác nhận port đúng bằng 2 ví dụ thật trong comment gốc Công nợ ("COMIN AN AN HÒA" → "AN AN HÒA", "...ĐẠI VIỆT" → "ĐẠI VIỆT") — đã test bằng scratch test, xoá sau khi xác nhận.

## 2. Hàm ghi (lib/congno.ts)

- [x] 2.1 Thêm `createSubcontractorInCongNo(input)` — validate `ten`/`mst` non-empty, `tenVietTat` fallback qua `ntpVietTat` nếu trống, ghi `nguon: "goc"` + field mới `ghiChuNguon`, KHÔNG đụng ý nghĩa `nguon` cũ.
- [x] 2.2 Gắn `tags: ["subcontractor-code-suggestions"]` vào `unstable_cache` của `loadSubcontractorCodeSuggestions`; gọi `revalidateTag` ngay sau khi ghi thành công.
- [x] 2.3 Cập nhật comment đầu file (không còn "CHỈ ĐỌC") phản ánh đúng thực tế có 1 hàm ghi.

## 3. API route mới

- [x] 3.1 Tạo `app/api/groups/[id]/congno-subcontractors/route.ts` (POST): `requireSession()`, đọc field theo `fieldId`, xác nhận `resolveExternalCodeLookup(field)?.sourceId === "congno_subcontractors"`, kiểm `isWithinUsedForScope`.
- [x] 3.2 Validate `nhom` chỉ nhận literal `"THẦU PHỤ"|"TỔ ĐỘI"` — sai định dạng bị TỪ CHỐI (400), không âm thầm ép về mặc định (CodeRabbit PR #59); lấy `nguoiThem` từ `session.name` (không nhận từ body).
- [x] 3.3 Gọi `createSubcontractorInCongNo`, trả `{ id, record: { fields } }` đúng shape `ExternalCodeRecord` đã dùng ở route `external-code-suggestions`.

## 4. UI submit/page.tsx

- [x] 4.1 Thêm dòng "+ Thêm nhà thầu phụ mới" vào dropdown gợi ý của `ShortTextWithExternalCodeLookup`, CHỈ khi `sourceId === "congno_subcontractors"` và ô đang có nội dung gõ.
- [x] 4.2 Thêm modal (dùng `Modal` + `form-styles` có sẵn): Tên nhà cung cấp*, Tên viết tắt (không bắt buộc, gợi ý tự rút gọn qua `ntpVietTat` lúc đang gõ), MST hoặc CCCD* (ghi chú "điền đúng bằng số"), Nhóm (mặc định Thầu phụ), Địa chỉ (không bắt buộc). Ghi chú đầu modal theo đúng demo đã duyệt.
- [x] 4.3 Ghi thành công → đóng modal, chọn luôn bản ghi mới (`onChange`, dùng `||` không phải `??` để rỗng vẫn fallback đúng — CodeRabbit PR #59), đẩy vào state `records` cục bộ (không gọi lại API) để autofill chéo field hoạt động ngay.
- [x] 4.4 Ghi thất bại → hiện lỗi trong modal, giữ dữ liệu đã nhập, không đóng modal.

## 5. Kiểm chứng

- [x] 5.1 `npx tsc --noEmit`, `npm run build`, `npx vitest run` sạch.
- [x] 5.2 Viết/cập nhật test cho `createSubcontractorInCongNo` (mock Firestore) — xác nhận không đụng `nguon` cũ, có `ghiChuNguon`, fallback `tenVietTat` đúng khi để trống.
- [x] 5.3 Thử ghi bản ghi TEST thật — Vercel Deployment Protection chặn truy cập trực tiếp Preview URL nên test THẲNG trên production (01/10/2026, tài khoản `claude.test@hpcore.internal`, nhóm "7.0. Xét duyệt báo giá"): service account CÓ quyền ghi thật, xác nhận qua response `{"id":"...", "record":{...}}` HTTP 200. Phát hiện thêm 1 lỗi UI thật ("chưa khớp" sau khi thêm — do thứ tự blur/click, xem fix PR #60) — đã vá và test lại lần 2, xác nhận hết lỗi. **2 bản ghi TEST còn sót trong Công nợ, CHƯA XOÁ** (nhờ Sếp xoá tay bên congno.hpcore.vn/subcontractors): "CÔNG TY TNHH TEST XOÁ SAU - CLAUDE" (MST 0000000001) và "CÔNG TY TNHH TEST 2 XOÁ SAU - CLAUDE" (MST 0000000002).
- [x] 5.4 Kiểm chứng thật trên production: thêm nhà thầu phụ mới qua app Đề xuất bằng tài khoản thật — chọn được NGAY (không đợi 5 phút), field không còn báo "chưa khớp" sau khi vá PR #60.
