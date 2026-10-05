## Context

Bối cảnh đầy đủ + lý do đổi hướng từ bản hard-code (PR #67): xem proposal.md. Hạ tầng phòng ban (`lib/server/hpcore-org.ts`: `getCachedDepartments()`, `getScopeMembership()`) đã có sẵn từ đợt "Phạm vi đề xuất theo nhóm" (PR #66), tái dùng nguyên xi — không cần xây lại.

Phát hiện kỹ thuật quan trọng: cơ chế điều kiện có sẵn trong app (`ConditionEditor`/`ConditionGroup`/`evaluateRule`, dùng cho "Tự động ghép giá trị"/"Hiện field theo điều kiện") chỉ đọc được giá trị FIELD trong chính đề xuất (`values[field.id]`) — không biết "phòng ban thật của người đang thao tác" (hồ sơ tổ chức App Tổng, nguồn khác hẳn). Nên KHÔNG tái dùng được `evaluateRule` ở tầng thấp — chỉ tái dùng Ý TƯỞNG/GIAO DIỆN (nhánh theo thứ tự, giống `ComputedFieldConfig.branches`).

## Goals / Non-Goals

**Goals:**
- Admin tự cấu hình bảng nhánh "phòng ban → người duyệt" RIÊNG theo từng nhóm đề xuất, không cần sửa code khi đổi quy tắc.
- Hỗ trợ YÊU CẦU NHIỀU người cùng duyệt (AND) cho 1 nhánh.
- Giữ nguyên 100% hành vi cũ cho nhóm không cấu hình, và cho submitter không khớp nhánh nào.
- Dời báo Kho/Thu mua sang sau khi ĐỦ người duyệt.

**Non-Goals:**
- Không cho chọn 1 người cụ thể (tên cố định) làm người duyệt yêu cầu — chỉ 2 vai trò động (Chỉ huy trưởng / Trưởng phòng X). Đổi người xử lý dùng "Chuyển tiếp".
- Không ghi lịch sử "đã Chuyển tiếp cho ai" vào `history[]` lâu dài — chỉ đổi `pendingAdjustment.approvers[i]`, không log riêng.
- Không gửi email/thông báo riêng cho người duyệt mới khi có điều chỉnh chờ xử lý (dùng kênh hiện có, không thêm template mới đợt này).
- Không backfill dữ liệu cũ (`originalFirstApprover` vắng mặt trên request cũ) — xử lý bằng fallback an toàn.

## Decisions

### 1. Cấu hình RIÊNG theo từng nhóm đề xuất (`ProposalGroup.adjustmentApprovalRules`)

```ts
export type AdjustmentApproverRef =
  | { kind: "chi_huy_truong" }
  | { kind: "department_leader"; departmentId: string; departmentName: string };

export interface AdjustmentApprovalBranch {
  id: string;
  departments: { id: string; name: string }[]; // OR — khớp 1 trong các phòng ban này
  requiredApprovers: AdjustmentApproverRef[]; // AND — rỗng = không cần ai duyệt
}

export interface AdjustmentApprovalRules {
  allowFollowers: boolean;
  branches: AdjustmentApprovalBranch[]; // xét theo thứ tự
  catchAllApprovers: AdjustmentApproverRef[]; // CHỈ áp dụng cho follower không khớp nhánh nào
}
```

Field `adjustmentApprovalRules?: AdjustmentApprovalRules | null` — `undefined`/`null` đều = tính năng TẮT. Cần cho phép `null` tường minh vì PATCH gửi qua JSON bỏ qua key `undefined` (không xoá được field đã có), còn `null` thì JSON giữ nguyên và Firestore ghi `null` thật — Admin bấm "Tắt" gửi `{adjustmentApprovalRules: null}`.

### 2. Luật xét nhánh (`lib/server/adjustment-approval-rules.ts`, hàm thuần `planAdjustmentApproval`)

```
!rules                              → submitter: direct · follower: none
!isSubmitter && !rules.allowFollowers → none
khớp 1 nhánh (OR theo departments)   → requiredApprovers rỗng: direct · khác rỗng: gated(refs)
không khớp nhánh nào, LÀ submitter   → LUÔN direct (không đọc catchAllApprovers)
không khớp nhánh nào, LÀ follower    → catchAllApprovers rỗng: none · khác rỗng: gated(refs)
```

Việc RESOLVE `AdjustmentApproverRef[]` thành người thật (`resolveApproverRefs`) tách riêng (cần đọc Firestore: `originalFirstApprover` có sẵn trên request, `department_leader` cần tra `getCachedDepartments()` + tên hiển thị `users/{leaderId}.fullName`) — trả `null` nếu THIẾU DỮ LIỆU (chưa có Chỉ huy trưởng, hoặc phòng chưa có `leaderId`), nơi gọi (`resolveAdjustmentPlanForActor`) coi như không khớp nhánh (rơi về direct/none tuỳ submitter hay follower) — KHÔNG chặn.

**Gộp người trùng (Decision 3, Sếp xác nhận 05/10)**: `resolveApproverRefs` dedupe theo `uid` sau khi resolve xong — nếu "Chỉ huy trưởng" và "Trưởng phòng Thu mua cung ứng" ra cùng 1 uid, danh sách cuối chỉ còn 1 phần tử, người đó chỉ cần duyệt 1 lần.

### 3. `pendingAdjustment` — danh sách approver, mỗi người có `approvedAt` riêng

```ts
pendingAdjustment?: {
  noiDung: string;
  attachment: RequestAttachment | null;
  requestedByUid: string;
  requestedByName: string;
  createdAt: string;
  approvers: { uid: string; name: string; approvedAt: string | null }[];
} | null;
```

`approverUid/approverName` CHỐT CỨNG lúc tạo (hoặc lúc Chuyển tiếp gần nhất) — không tính lại theo vai trò mỗi lần hiển thị (tránh đổi người duyệt âm thầm giữa lúc đang có 1 điều chỉnh dở dang, vd Trưởng phòng đổi người giữa chừng).

### 4. Route `adjustment/decision/route.ts` — AND nhiều người, không lồng transaction

Mỗi quyết định (Duyệt/Từ chối/Chuyển tiếp) chỉ tác động ĐÚNG slot của người gọi (`approvers[i].uid === session.uid && approvedAt === null`):
- **Duyệt**: đánh dấu `approvedAt` của slot đó. Nếu SAU ĐÓ mọi slot đều có `approvedAt` → ghi THẬT vào `history` (dùng `buildAdjustmentHistoryPatch`, hàm THUẦN tách riêng khỏi `ghiDieuChinhVaoLichSu` để gọi được BÊN TRONG transaction này — Firestore Admin SDK không hỗ trợ lồng `runTransaction`), xoá `pendingAdjustment`, rồi MỚI gọi `taoViecDongBo`/`guiCacViec` NGOÀI transaction.
- **Từ chối**: 1 người trong số đang chờ từ chối = huỷ hẳn toàn bộ (đúng tinh thần AND — thiếu 1 là hỏng), xoá `pendingAdjustment`, không đụng `history`.
- **Chuyển tiếp**: đổi `uid`/`name` của ĐÚNG slot đang gọi sang người mới, giữ `approvedAt: null`; nếu người mới đã có mặt ở 1 slot KHÁC đang chờ thì gộp (xoá slot cũ) tránh 1 người xuất hiện 2 slot.

### 5. UI Admin — tái dùng pattern "Tự động ghép giá trị"

Trang `app/request/groups/[groupId]/(settings)/adjustment-approval/page.tsx`: toggle bật/tắt nhóm, toggle `allowFollowers`, danh sách `BranchCard` (chip chọn phòng ban OR, chip chọn người duyệt AND — chỉ 2 loại chip "Chỉ huy trưởng"/"Trưởng phòng X", lấy danh sách phòng ban qua `/api/directory/departments`), nút "+ Thêm nhánh", card "Nhánh mặc định" cố định ở cuối (không xoá được, chỉ sửa approvers).

## Risks / Trade-offs

- **[Risk]** Đổi tên/xoá phòng ban trong App Tổng sau này → nhánh tham chiếu phòng đó không còn khớp được (department id không còn tồn tại trong `getCachedDepartments()`) → rơi về hành vi cũ ÂM THẦM (không báo lỗi, đúng chủ đích Decision 2 bản gốc) → **Mitigation**: không cần — department ID (không phải tên) được lưu trong cấu hình nhánh, Admin tự sửa lại nhánh nếu thấy sai qua UI, không có log riêng cho case này (chấp nhận được, mức độ xảy ra thấp vì đổi tên phòng không ảnh hưởng id).
- **[Risk]** Request tạo TRƯỚC change này không có `originalFirstApprover` → nhánh cần "Chỉ huy trưởng" không giải quyết được cho CHÍNH request đó → **Mitigation**: coi như thiếu dữ liệu, rơi về hành vi cũ CHỈ cho request đó, không chặn.
- **[Risk]** Ghi đè đồng thời `pendingAdjustment` (2 slot cùng bấm Duyệt cùng lúc, hoặc gửi điều chỉnh mới trong lúc đang chờ) → **Mitigation**: mọi thao tác chạy trong Firestore transaction, đọc bản mới nhất trong transaction (không đọc-rồi-ghi-đè).
- **[Trade-off]** "Chuyển tiếp" không để lại dấu vết trong `history[]` — chấp nhận được (không phải quyết định chính thức ảnh hưởng kết quả cuối, khác "Chuyển tiếp và Duyệt" ở luồng chính).

## Migration Plan

- Toàn bộ field mới optional/additive — không cần migration script, không backfill.
- Deploy 1 PR duy nhất.
- Rollback: revert PR — không thay đổi schema phá hoại; request đang có `pendingAdjustment` khi rollback sẽ "kẹt" ở trạng thái chờ (hiếm, xử lý tay qua Firestore Console nếu gặp).

## Open Questions

- Có cần thông báo (email/chuông) riêng cho người duyệt mới khi có điều chỉnh chờ xử lý? → Ngoài phạm vi đợt này, hỏi Sếp nếu cần sau khi dùng thử thật.
