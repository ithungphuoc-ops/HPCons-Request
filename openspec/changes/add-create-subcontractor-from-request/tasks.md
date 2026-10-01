## 1. Thuật toán rút gọn tên dùng chung

- [x] 1.1 Port `ntpVietTat` từ `HPCons-Congno/lib/subcontractors.ts:118-154` sang `lib/ntp-viet-tat.ts` (client-safe, không `import "server-only"`).
- [x] 1.2 Xác nhận port đúng bằng 2 ví dụ thật trong comment gốc Công nợ ("COMIN AN AN HÒA" → "AN AN HÒA", "...ĐẠI VIỆT" → "ĐẠI VIỆT") — đã test bằng scratch test, xoá sau khi xác nhận.

## 2. Hàm ghi (lib/congno.ts)

- [x] 2.1 Thêm `createSubcontractorInCongNo(input)` — validate `ten`/`mst` non-empty, `tenVietTat` fallback qua `ntpVietTat` nếu trống, ghi `nguon: "goc"` + field mới `ghiChuNguon`, KHÔNG đụng ý nghĩa `nguon` cũ.
- [x] 2.2 Gắn `tags: ["subcontractor-code-suggestions"]` vào `unstable_cache` của `loadSubcontractorCodeSuggestions`; gọi `revalidateTag` ngay sau khi ghi thành công.
- [x] 2.3 Cập nhật comment đầu file (không còn "CHỈ ĐỌC") phản ánh đúng thực tế có 1 hàm ghi.

## 3. API route mới

- [ ] 3.1 Tạo `app/api/groups/[id]/congno-subcontractors/route.ts` (POST): `requireSession()`, đọc field theo `fieldId`, xác nhận `resolveExternalCodeLookup(field)?.sourceId === "congno_subcontractors"`, kiểm `isWithinUsedForScope`.
- [ ] 3.2 Validate `nhom` chỉ nhận literal `"THẦU PHỤ"|"TỔ ĐỘI"`; lấy `nguoiThem` từ `session.name` (không nhận từ body).
- [ ] 3.3 Gọi `createSubcontractorInCongNo`, trả `{ id, record: { fields } }` đúng shape `ExternalCodeRecord` đã dùng ở route `external-code-suggestions`.

## 4. UI submit/page.tsx

- [ ] 4.1 Thêm dòng "+ Thêm nhà thầu phụ mới" vào dropdown gợi ý của `ShortTextWithExternalCodeLookup`, CHỈ khi `sourceId === "congno_subcontractors"` và ô đang có nội dung gõ.
- [ ] 4.2 Thêm modal (dùng `Modal` + `form-styles` có sẵn): Tên nhà cung cấp*, Tên viết tắt (không bắt buộc, gợi ý tự rút gọn qua `ntpVietTat` lúc đang gõ), MST hoặc CCCD* (ghi chú "điền đúng bằng số"), Nhóm (mặc định Thầu phụ), Địa chỉ (không bắt buộc). Ghi chú đầu modal theo đúng demo đã duyệt.
- [ ] 4.3 Ghi thành công → đóng modal, chọn luôn bản ghi mới (`onChange`), đẩy vào state `records` cục bộ (không gọi lại API) để autofill chéo field hoạt động ngay.
- [ ] 4.4 Ghi thất bại → hiện lỗi trong modal, giữ dữ liệu đã nhập, không đóng modal.

## 5. Kiểm chứng

- [ ] 5.1 `npx tsc --noEmit`, `npm run build`, `npx vitest run` sạch.
- [ ] 5.2 Viết/cập nhật test cho `createSubcontractorInCongNo` (mock Firestore) — xác nhận không đụng `nguon` cũ, có `ghiChuNguon`, fallback `tenVietTat` đúng khi để trống.
- [ ] 5.3 Thử ghi 1 bản ghi TEST thật qua Preview deployment (Vercel, cùng biến môi trường Production) — xác nhận service account có quyền ghi thật (rủi ro IAM chưa xác nhận được bằng code, xem design.md). Xoá bản ghi test sau khi xác nhận (qua giao diện Công nợ).
- [ ] 5.4 Kiểm chứng thật trên production sau deploy: thêm 1 nhà thầu phụ mới qua app Đề xuất bằng tài khoản thật, xác nhận chọn được ngay (không cần đợi 5 phút), mở Công nợ xác nhận bản ghi đúng field, không có badge/lọc nào bị ảnh hưởng.
