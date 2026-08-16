## Why

Hai vấn đề liên quan chặt tới nhau, cùng phát hiện qua nhóm "2. Phiếu đề nghị": (1) danh sách đề xuất và trang chi tiết hiện đang hiện **tên NHÓM** (VD "2. Phiếu đề nghị") làm tiêu đề cho mọi dòng, khiến không phân biệt được đề xuất nào với đề xuất nào — trong khi hệ thống ĐÃ CÓ quy ước đúng (ưu tiên field "Tên đề xuất") nhưng chỉ dùng ở 3 nơi (in file, xuất file, webhook), bị bỏ sót ở đúng 2 nơi người dùng nhìn thấy nhiều nhất (danh sách + chi tiết); (2) field "Tên đề xuất" hiện phải gõ tay, dễ sai chính tả/thiếu nhất quán, trong khi giá trị của nó lẽ ra suy ra được hoàn toàn từ các field khác đã nhập (VD Số hợp đồng + Tên công trình, hoặc Bộ phận) — việc (1) chỉ thực sự hữu ích khi tên đề xuất luôn đúng/nhất quán, nên (2) là điều kiện để (1) phát huy tác dụng đầy đủ.

## What Changes

- Gộp hằng số `TITLE_FIELD_CODES` (hiện bị copy độc lập ở `lib/print-template.ts`, `app/api/requests/[id]/export/route.ts`, `lib/qlkctr-sync.ts`) thành 1 hàm/hằng số dùng chung duy nhất.
- Áp dụng logic "ưu tiên field tên đề xuất, fallback tên nhóm" (đã có, chỉ thiếu áp dụng) cho `app/request/list/page.tsx` và `components/request/RequestDetailView.tsx`.
- Thêm thuộc tính MỚI trên `ProposalField` (tạm gọi `computedFrom`, tên chính thức chốt ở design.md) — áp dụng cho field kiểu `short_text`/`paragraph`: danh sách nhánh, mỗi nhánh có 1 `ConditionGroup` (tái dùng nguyên từ change `extend-condition-rules`) + 1 mẫu chuỗi cú pháp `${code}` (tái dùng cú pháp đã có trong `lib/print-template.ts`). Field có cấu hình này **không đổi `dataType`** (vẫn là `short_text`/`paragraph` như cũ) — chỉ thêm hành vi tự tính + tự khoá không cho gõ tay khi có ít nhất 1 nhánh khớp.
- Cập nhật form Gửi đề xuất (`app/request/groups/[groupId]/submit/page.tsx`): field có `computedFrom` render read-only, tự tính lại real-time theo giá trị field nguồn (tái dùng cơ chế theo dõi field liên quan đã có cho preview người duyệt).
- Cập nhật UI `AddFieldModal.tsx`: thêm mục cấu hình `computedFrom` (danh sách nhánh: điều kiện + mẫu chuỗi), tái dùng `ConditionEditor` đã có cho phần điều kiện.
- Áp dụng cấu hình thật cho nhóm "2. Phiếu đề nghị" (groupId `MbSGRaYx0FGGsObPjk4f`), field "Tên đề xuất" (`ten_de_xuat`): 2 nhánh theo `lua_chon_de_nghi`.
- **Không BREAKING** — field chưa cấu hình `computedFrom` (mọi field hiện có) giữ nguyên hành vi gõ tay như cũ.

## Capabilities

### New Capabilities
- `computed-field-values`: field văn bản tự tính giá trị từ mẫu chuỗi + điều kiện dựa trên field khác trong cùng đề xuất, thay vì gõ tay.
- `request-title-display`: quy tắc thống nhất chọn tiêu đề hiển thị cho 1 đề xuất (ưu tiên field "tên đề xuất" theo `code` quy ước, fallback tên nhóm) — áp dụng nhất quán ở mọi nơi hiển thị (danh sách, chi tiết, in ấn, xuất file, webhook).

### Modified Capabilities
(không có — `conditional-approval-rules` được TÁI DÙNG nguyên vẹn, không đổi yêu cầu của nó)

## Impact

- `lib/types.ts` — thêm thuộc tính mới trên `ProposalField`
- `lib/print-template.ts` — nơi hiện giữ `TITLE_FIELD_CODES` và cú pháp `${code}`, cả 2 sẽ được tái dùng/tách ra dùng chung
- `app/api/requests/[id]/export/route.ts`, `lib/qlkctr-sync.ts` — chuyển sang dùng hằng số `TITLE_FIELD_CODES` dùng chung thay vì bản copy riêng
- `app/request/list/page.tsx`, `components/request/RequestDetailView.tsx` — áp dụng logic chọn tiêu đề đúng
- `components/request/modals/AddFieldModal.tsx` — thêm UI cấu hình `computedFrom`
- `app/request/groups/[groupId]/submit/page.tsx` — render field computed dạng read-only + tự tính real-time
- Dữ liệu thật: field "Tên đề xuất" của nhóm "2. Phiếu đề nghị" (Firestore, groupId `MbSGRaYx0FGGsObPjk4f`) sẽ được cấu hình `computedFrom` sau khi code xong.
