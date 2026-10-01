## Why

Người làm đề xuất chọn "Tên nhà thầu phụ đề xuất" (field bật `externalCodeLookup`, nguồn `congno_subcontractors` — xem change `add-external-code-lookup-picker`) đôi khi gặp nhà thầu phụ CHƯA có trong Công nợ, nên không gõ khớp được, phải dừng lại hỏi người khác thêm thủ công bên Công nợ rồi quay lại — chậm, gián đoạn việc làm đề xuất.

Sếp yêu cầu 01/10/2026 (qua demo HTML + 4 vòng hỏi-đáp, xem
`tong-quan-demo/base-request-app/them-nha-thau-phu-moi-qua-de-xuat-2026-10-01/index.html`): cho phép thêm nhà thầu phụ mới NGAY tại app Đề xuất, ghi THẬT về Firestore Công nợ, kèm 1 ghi chú nhỏ biết ai đã thêm.

## What Changes

- Thêm hàm `createSubcontractorInCongNo` (lib/congno.ts) — GHI MỚI 1 document vào collection `subcontractors` của Công nợ bằng Admin SDK (service account đã có sẵn cho việc đọc) — **lần đầu base-request-app ghi qua app khác**, trước giờ chỉ đọc.
- Thêm API route mới (base-request-app) nhận yêu cầu tạo nhà thầu phụ, validate, gọi hàm ghi, trả về bản ghi mới dạng `ExternalCodeRecord` để client chọn luôn không cần tải lại danh sách.
- Thêm nút "+ Thêm nhà thầu phụ mới" + modal nhập liệu vào `ShortTextWithExternalCodeLookup` (submit/page.tsx) — CHỈ hiện khi `sourceId === "congno_subcontractors"` (không áp dụng cho "Số Hợp Đồng CĐT" — không có khái niệm "thêm hợp đồng mới" tương tự).
- Port nguyên thuật toán `ntpVietTat` (rút gọn tên) từ Công nợ sang `lib/ntp-viet-tat.ts` (file client-safe, dùng chung client+server) để 2 app luôn ra cùng 1 kết quả rút gọn.
- Cache 5 phút của `loadSubcontractorCodeSuggestions` được gắn `tags` để làm mới NGAY sau khi ghi (không đợi hết 5 phút mới chọn được nhà thầu vừa thêm).

## Decisions đã chốt qua demo (01/10/2026)

1. KHÔNG ghi đè field `nguon` cũ của Công nợ (enum `"goc"|"xetduyet"`, dùng cho badge/lọc riêng của họ) — ghi `"goc"` (giống Admin Công nợ tự thêm tay) + 1 field MỚI `ghiChuNguon` (chuỗi tự do, chỉ để ai mở thẳng Firestore thấy nguồn gốc). Sếp xác nhận KHÔNG cần hiện field này ở giao diện Công nợ.
2. "Tên viết tắt" không bắt buộc gõ tay — để trống thì tự tính bằng `ntpVietTat`.
3. Nút này mở cho TẤT CẢ người làm đề xuất (không giới hạn vai trò riêng).
4. Ghi bằng Admin SDK trực tiếp — route POST sẵn có của Công nợ không tự validate gì và đòi hỏi 1 loại token riêng của project đó (phức tạp hơn, không an toàn hơn).

## Out of Scope

- Không sửa giao diện/UI của app Công nợ (repo khác, HPCons-Congno) — field `ghiChuNguon` chỉ lưu, không hiện ở đâu trong Công nợ.
- Không áp dụng cơ chế "thêm mới tại chỗ" cho nguồn `congno_contracts` (Số Hợp Đồng CĐT) hay bất kỳ nguồn nào khác ngoài `congno_subcontractors`.
- Không xử lý trùng lặp (2 người cùng thêm gần như đồng thời 1 tên gần giống) — chấp nhận rủi ro thấp, giống cách Công nợ hiện cũng chỉ cảnh báo trùng MST ở UI của họ, không chặn cứng.
