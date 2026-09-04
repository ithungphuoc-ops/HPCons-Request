## Why

Đề xuất được duyệt xong khi bảng vật tư (field kiểu "table"/"base_table") còn sơ bộ — người làm đề xuất chưa biết đơn giá, nhà cung cấp... Đề xuất tự động đồng bộ sang App Thu Mua (`lib/thumua-sync.ts`), nơi Thu Mua làm việc thật với nhà cung cấp và có được bảng dữ liệu chi tiết hơn hẳn. Hiện không có cách nào đưa dữ liệu chi tiết đó "quay lại" đúng đề xuất gốc làm bằng chứng xác nhận giữa 2 bên, trong khi `PATCH /api/requests/[id]` cố ý chặn tuyệt đối mọi sửa đổi `values` một khi đề xuất đã `"approved"` — khoá này cần giữ nguyên để bảo toàn tính toàn vẹn của dữ liệu đã duyệt.

## What Changes

- Thêm khu vực **"Bổ sung sau duyệt"** trên trang chi tiết đề xuất, chỉ hiện khi `request.status === "approved"`, chỉ dành cho chính người làm đề xuất (submitter) — Owner/Admin không thao tác thay được.
- Cho phép **nối thêm dòng mới** vào field bảng đã duyệt (không sửa/xoá dòng cũ) qua 1 route mới, phạm vi hẹp — tái dùng cơ chế tải mẫu Excel / import-nối-dòng đã có sẵn ở trang soạn đề xuất.
- Cho phép **đính kèm file** (Excel/PDF...) vào đề xuất đã duyệt, tái dùng API đính kèm cấp đề xuất đã có — nhưng khi đề xuất đã duyệt, chỉ submitter được thêm (siết chặt hơn quy tắc "submitter hoặc Owner/Admin" đang áp dụng cho các trạng thái khác).
- Mỗi lần bổ sung dòng hoặc đính file sau duyệt đều ghi 1 dòng vào `history[]` sẵn có, đủ để tính và hiển thị "lần thứ mấy" — không thêm cơ chế lưu vết song song.
- **BREAKING (phạm vi hẹp)**: `POST /api/requests/[id]/attachments` đổi quy tắc quyền khi `status === "approved"` — Owner/Admin không còn thêm được tài liệu cho đề xuất đã duyệt (trước đó chưa từng phân biệt theo trạng thái).

## Capabilities

### New Capabilities
- `post-approval-supplement`: cho phép submitter bổ sung dữ liệu (nối dòng bảng + đính file) vào đúng đề xuất đã duyệt của mình, có đánh số lần bổ sung, không đụng tới dữ liệu/route đã duyệt hiện có.

### Modified Capabilities
- (không có — capability đính kèm cấp đề xuất `request-level-attachments` chưa được archive vào `openspec/specs/`, vẫn đang nằm trong change `add-request-detail-base-parity` chưa hoàn tất; thay đổi quyền cho trường hợp đã duyệt được mô tả gộp trong `post-approval-supplement` ở trên thay vì tạo delta cho 1 spec chưa tồn tại)

## Impact

- `components/request/RequestDetailView.tsx`: thêm khu vực "Bổ sung sau duyệt" (UI mới, điều kiện hiện theo `status` + quyền submitter).
- `app/api/requests/[id]/attachments/route.ts`: sửa điều kiện quyền `POST` khi `status === "approved"`.
- Route mới (đặt tên cụ thể ở design.md) cho việc nối dòng vào field bảng sau duyệt.
- `lib/table-field.ts`: tái dùng nguyên hàm `serializeTableRows`/`deserializeTableRows`/`toWireTableRows`, không đổi.
- `app/request/groups/[groupId]/submit/page.tsx`: đọc lại logic tải mẫu/import Excel hiện có để tái dùng đúng, không sửa file này.
- Không đụng `app/api/requests/[id]/route.ts` (PATCH hiện có giữ nguyên hành vi chặn tuyệt đối).
- Không đụng App Thu Mua (HPCons-ThuMua) — việc siết `taoPoDoiLap` là 1 việc riêng, khác repo, khác change.
