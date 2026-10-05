## Why

Hiện tại "Điều chỉnh đề nghị sau duyệt" (`AdjustmentControl`, `app/api/requests/[id]/adjustment/route.ts`) chỉ cho phép CHÍNH người gửi đề xuất thao tác, và lưu thẳng vào `history` ngay lập tức — không ai kiểm lại nội dung trước khi nó có hiệu lực (và trước khi hệ thống tự báo sang Kho công trình + Thu mua, theo đợt "Liên kết 4 app" 03/10/2026). Sếp muốn mở rộng quyền bấm điều chỉnh (không chỉ người gửi) cho 2 phòng ban cụ thể, nhưng đổi lại bắt buộc phải qua 1 bước duyệt trước khi điều chỉnh có hiệu lực, để tránh thay đổi tự ý sau khi đề xuất đã được duyệt chính thức. 6 quyết định thiết kế đã chốt qua demo (xem Artifact bên dưới), sẵn sàng triển khai.

Demo đã duyệt 05/10/2026: https://claude.ai/artifact/FA3H1K3PVW12tM3mtgWB9P (version 4) — `tong-quan-demo/base-request-app/duyet-dieu-chinh-sau-duyet-2026-10-01/index.html`.

## What Changes

- Mở rộng quyền bấm "Điều chỉnh sau duyệt": không chỉ `submittedBy.uid`, mà cả bất kỳ ai trong `followers[]` của chính đề xuất đó — NHƯNG chỉ khi người đó (qua `getScopeMembership`) thuộc phòng ban "Thi công" hoặc "Thu mua cung ứng". Áp dụng cho TẤT CẢ nhóm đề xuất.
- Với 2 phòng ban trên, điều chỉnh KHÔNG còn ghi thẳng vào `history` nữa — chuyển sang trạng thái "đang chờ duyệt điều chỉnh" mới trên đề xuất, chờ đúng 1 người duyệt xử lý trước khi có hiệu lực:
  - Người gửi điều chỉnh thuộc phòng **Thi công** → người duyệt là **Trưởng phòng Thu mua cung ứng** (tra theo `leaderId` của phòng ban tên "Thu mua cung ứng", `lib/server/hpcore-org.ts`).
  - Người gửi điều chỉnh thuộc phòng **Thu mua cung ứng** → người duyệt là **"Chỉ huy trưởng"** = người đã duyệt bước 1 (đầu tiên) của CHÍNH đề xuất này — một field MỚI ghi 1 lần duy nhất ngay lúc đề xuất chuyển sang `"approved"` lần đầu tiên, không bị ảnh hưởng bởi "Chuyển tiếp và Duyệt" xảy ra sau đó.
- Người duyệt (Trưởng phòng Thu mua cung ứng / Chỉ huy trưởng) có 3 hành động: **Duyệt** (ghi vào `history` như hành vi cũ, rồi MỚI báo Kho/Thu mua), **Từ chối** (huỷ hẳn, không ghi gì vào `history`), **Chuyển tiếp** (tự chọn 1 người khác xử lý thay khi vắng mặt — không cần Admin cấu hình người dự phòng trước).
- Người điều chỉnh KHÔNG thuộc Thi công lẫn Thu mua cung ứng (gồm cả trường hợp 2 phòng ban này chưa tồn tại trong hệ thống): **GIỮ NGUYÊN hành vi hiện tại** — chỉ submitter gốc, lưu thẳng ngay, không qua duyệt.
- **BREAKING (hành vi, không phải API công khai)**: việc gọi `taoViecDongBo`/`guiCacViec` báo Kho/Thu mua cho hành động điều chỉnh của 2 phòng ban trên dời từ "ngay lúc gửi" sang "ngay lúc được duyệt" — tránh báo nội dung chưa được xác nhận.

## Capabilities

### New Capabilities
- `adjustment-approval-gate`: toàn bộ luật cho hành động "Điều chỉnh đề nghị sau duyệt" — ai được bấm (submitter luôn được; follower chỉ khi thuộc Thi công/Thu mua cung ứng), khi nào lưu thẳng ngay (hành vi cũ, mọi trường hợp khác) và khi nào phải qua duyệt (2 phòng ban trên), xác định người duyệt theo phòng ban, trạng thái chờ duyệt, 3 hành động Duyệt/Từ chối/Chuyển tiếp, và field "người duyệt bước 1 gốc" lưu cố định trên đề xuất. Capability `post-approval-supplement` hiện có (nối dòng bảng, đính tài liệu) KHÔNG đổi — 2 việc đó tách biệt với "Điều chỉnh", vẫn chỉ submitter, vẫn lưu thẳng ngay như cũ.

### Modified Capabilities
<!-- Không có — hành vi nối dòng bảng/đính tài liệu của post-approval-supplement giữ nguyên, không phải sửa spec đó. -->

## Impact

- `components/request/RequestDetailView.tsx` (`AdjustmentControl`, dòng ~1609): thêm hiển thị trạng thái chờ duyệt + khung xử lý Duyệt/Từ chối/Chuyển tiếp cho người duyệt tương ứng.
- `app/api/requests/[id]/adjustment/route.ts`: tách luồng theo phòng ban người gọi; luồng mới không ghi `history`/gọi đồng bộ ngay mà tạo trạng thái chờ duyệt.
- API route MỚI để xử lý Duyệt/Từ chối/Chuyển tiếp cho điều chỉnh đang chờ (ví dụ `app/api/requests/[id]/adjustment/decision/route.ts`).
- `lib/permissions.ts`: thêm hàm quyền MỚI riêng cho adjustment (không sửa `canSupplementAfterApproval`, vẫn dùng chung cho table-supplement/attachments).
- `lib/types.ts` (`RequestInstance`): thêm field lưu "điều chỉnh đang chờ duyệt" + field "người duyệt bước 1 gốc" (ghi 1 lần lúc duyệt đầu tiên).
- `app/api/requests/[id]/decision/route.ts`: nơi ghi field "người duyệt bước 1 gốc" khi đề xuất chuyển sang `"approved"` lần đầu.
- `lib/server/hpcore-org.ts` / `lib/used-for-scope.ts`: tái dùng nguyên xi để tra phòng ban + leaderId, không sửa.
- `lib/dong-bo/hang-cho.ts` (`taoViecDongBo`/`guiCacViec`): thời điểm gọi dời sang sau khi duyệt, cho đúng 2 nhánh phòng ban mới.
