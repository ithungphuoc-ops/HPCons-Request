## Why

Hợp đồng dữ liệu "Quản lý trực tiếp" (Sếp duyệt 03/10/2026) thêm `users.directManagerIds`, `users.secondaryDepartmentIds`, `departments.parentId` ở App Tổng (hpcons-portal) và chốt MỘT luật chung xác định quản lý trực tiếp cho mọi app. App Đề xuất hiện chỉ tra `users.departmentId → departments.leaderId`, nên người không thuộc phòng ban có trưởng (hoặc chính là trưởng) bị chặn gửi dù đã có quản lý gán tay.

## What Changes

- Bước duyệt `submitter_manager` tự resolve theo luật chung: `directManagerIds` (theo thứ tự, bỏ chính mình/uid không tồn tại) → trưởng đơn vị chính → trưởng nhóm cha (tối đa 10 bậc). Luật trả null thì vẫn chặn gửi như cũ.
- Luật tách thành hàm thuần `lib/direct-manager.ts` (có test vitest).
- Form gửi đề xuất điền sẵn GỢI Ý MẶC ĐỊNH = quản lý trực tiếp đã resolve, ghi rõ "Mặc định…", vẫn cho đổi người khác.
- Picker "Chọn quản lý trực tiếp" giữ nguồn memberGroups, đưa người trong `directManagerIds` của chính người dùng lên đầu (cache 60s khoá theo uid).
- Thông báo "người gửi chọn người khác duyệt thay" (scope `manager-bypassed`) so với quản lý resolve theo luật mới.
- KHÔNG đổi đề xuất đã gửi: người duyệt đã snapshot giữ nguyên.

## Capabilities

### New Capabilities
- `direct-manager-resolution`: luật xác định quản lý trực tiếp của người gửi và cách App Đề xuất dùng nó.

### Modified Capabilities
(không có spec chính nào trong openspec/specs mô tả phần này)

## Impact

- `lib/direct-manager.ts` (mới), `lib/server/requests.ts`, `app/api/directory/managers/route.ts`, `app/api/requests/route.ts` (chú thích), `app/request/groups/[groupId]/submit/page.tsx`.
- Chỉ ĐỌC Firestore App Tổng; trường mới đều tuỳ chọn, dữ liệu cũ chạy như cũ.
