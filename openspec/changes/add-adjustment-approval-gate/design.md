## Context

"Điều chỉnh đề nghị sau duyệt" (`AdjustmentControl`, `app/api/requests/[id]/adjustment/route.ts`) hiện CHỈ cho `submittedBy.uid` thao tác (`canSupplementAfterApproval`, dùng chung với 2 route khác — table-supplement, attachments — KHÔNG được sửa hàm này). Gửi là ghi thẳng vào `history` ngay, rồi (từ 03/10/2026, đợt "Liên kết 4 app") tự động gọi `taoViecDongBo()`/`guiCacViec()` báo Kho công trình + Thu mua ngay lập tức.

Hạ tầng phòng ban CẦN cho tính năng này **đã có sẵn**, không phải xây mới (đợt "Phạm vi đề xuất theo nhóm", PR #66, 03-04/10/2026):
- `lib/server/hpcore-org.ts` → `getCachedDepartments()` trả `{id, name, parentId, leaderId}[]` từ `departments` (App Tổng), cache 60s; `getScopeMembership(uid)` trả `{primaryGroupIds, secondaryGroupIds}` (đã gồm nhóm cha), cache 60s khoá theo uid.
- `lib/used-for-scope.ts` → `isInUsedForScope()` hàm thuần, đã có test, kiểm "uid có thuộc 1 trong các nhóm chỉ định không".

Phần CHƯA có: khái niệm "Chỉ huy trưởng" (người duyệt bước 1 gốc của chính đề xuất), trạng thái "điều chỉnh đang chờ duyệt" trên request, và 1 luồng Duyệt/Từ chối/Chuyển tiếp riêng cho luồng này.

Demo đã duyệt: https://claude.ai/artifact/FA3H1K3PVW12tM3mtgWB9P (version 4), 6 quyết định xem proposal.md.

## Goals / Non-Goals

**Goals:**
- Mở quyền bấm điều chỉnh cho `submittedBy` + `followers[]` thuộc phòng "Thi công"/"Thu mua cung ứng", nhưng bắt qua duyệt trước khi có hiệu lực.
- Xác định đúng "Chỉ huy trưởng" bất biến theo thời gian — không bị ảnh hưởng bởi "Chuyển tiếp và Duyệt" xảy ra sau khi đề xuất đã có người duyệt bước 1.
- Giữ nguyên 100% hành vi cũ cho mọi trường hợp KHÔNG thuộc 2 phòng ban trên (kể cả khi tra phòng ban thất bại).
- Dời thời điểm báo Kho/Thu mua sang SAU KHI điều chỉnh được duyệt, cho đúng 2 nhánh phòng ban mới.

**Non-Goals:**
- Không làm màn Admin cấu hình người duyệt dự phòng (decision 6 — chỉ người duyệt mặc định tự Chuyển tiếp lúc đang xử lý).
- Không ghi lịch sử "đã Chuyển tiếp điều chỉnh cho ai" vào `history[]` lâu dài — chỉ cập nhật người duyệt hiện tại trên `pendingAdjustment`, không log riêng (ra ngoài phạm vi demo, có thể bổ sung sau nếu Sếp cần truy vết).
- Không gửi email/thông báo riêng cho người duyệt mới khi có điều chỉnh chờ xử lý (dùng kênh thông báo đang có nếu đủ, không thêm template mới trong đợt này — xem Open Questions).
- Không backfill dữ liệu cũ (`originalFirstApprover` vắng mặt trên request cũ — xử lý bằng fallback an toàn, không chạy script sửa dữ liệu hàng loạt).

## Decisions

### 1. Field mới trên `RequestInstance` (additive, optional — không phá dữ liệu cũ)

```ts
/** "Chỉ huy trưởng" — approversSnapshot[0] tại ĐÚNG thời điểm approversSnapshot
 * được dựng lần đầu (lúc gửi chính thức / submit draft), TRƯỚC khi bất kỳ
 * forward_then_approve nào có cơ hội chèn người vào đầu mảng. Ghi 1 LẦN DUY
 * NHẤT, không bao giờ ghi đè lại. Request tạo TRƯỚC change này không có field
 * này (undefined) — coi như "không xác định được", rơi về fallback an toàn
 * (Decision 3 dưới). */
originalFirstApprover?: TaggedUser | null;

/** Điều chỉnh sau duyệt đang chờ 1 người xử lý — vắng mặt (undefined/null) =
 * không có gì đang chờ. Chỉ tồn tại cho nhánh "gated" (Decision 2); nhánh
 * "direct" (hành vi cũ) không bao giờ tạo ra giá trị này. */
pendingAdjustment?: {
  noiDung: string;
  attachment: RequestAttachment | null;
  requestedByUid: string;
  requestedByName: string;
  createdAt: string;
  /** "thi_cong" | "thu_mua_cung_ung" — chỉ để hiển thị lý do/nhãn, KHÔNG dùng
   * để tính lại người duyệt (approverUid/approverName đã CHỐT CỨNG lúc gửi
   * hoặc lúc Chuyển tiếp — tra lại bằng tên phòng mỗi lần hiển thị là sai, vì
   * leaderId có thể đổi giữa chừng trong lúc đang chờ duyệt). */
  routedVia: "thi_cong" | "thu_mua_cung_ung";
  approverUid: string;
  approverName: string;
} | null;
```

**Vì sao chốt cứng `approverUid/approverName` lúc tạo `pendingAdjustment`** thay vì tính lại theo tên phòng mỗi lần hiển thị: tránh trường hợp Trưởng phòng Thu mua cung ứng đổi người giữa lúc đang có 1 điều chỉnh chờ duyệt — giữ đúng người đã được giao lúc gửi (hoặc lúc Chuyển tiếp gần nhất), không tự âm thầm đổi người duyệt của 1 việc đang dở dang.

### 2. Hàm quyền MỚI, tách biệt hoàn toàn `canSupplementAfterApproval`

`lib/permissions.ts` thêm `resolveAdjustmentAccess(request, uid, department): "direct" | "gated" | "none"`, nhận sẵn kết quả tra phòng ban (department: `"thi_cong" | "thu_mua_cung_ung" | "other"`, tính ở lib/server trước khi gọi — hàm này giữ THUẦN, không tự gọi Firestore, để test được như các hàm permission khác):

```
isSubmitter = uid === request.submittedBy.uid
isFollower  = request.followers.some(f => f.id === uid)
if (!isSubmitter && !isFollower) → "none"
if (department === "thi_cong" || department === "thu_mua_cung_ung") → "gated"
if (isSubmitter) → "direct"   // follower ở phòng khác: vẫn "none"
→ "none"
```

Route `adjustment/route.ts` TỰ tra `department` qua `getScopeMembership(uid)` + so khớp 2 department id đã tra sẵn (xem Decision 3) trước khi gọi hàm trên — giữ đúng ranh giới "phần đọc Firestore ở route, phần luật thuần ở lib/permissions.ts" như các hàm quyền khác trong file.

### 3. Tra phòng ban: tên khớp không phân biệt hoa/thường + khoảng trắng dư, lỗi thì rơi về "other"

```ts
function chuanHoaTenPhong(s: string) { return s.trim().toLowerCase().replace(/\s+/g, " "); }

async function resolveGateDepartment(uid: string): Promise<"thi_cong" | "thu_mua_cung_ung" | "other"> {
  try {
    const [depts, membership] = await Promise.all([getCachedDepartments(), getScopeMembership(uid)]);
    const thiCong = depts.find((d) => chuanHoaTenPhong(d.name) === "thi công");
    const thuMua = depts.find((d) => chuanHoaTenPhong(d.name) === "thu mua cung ứng");
    const ids = new Set([...membership.primaryGroupIds, ...membership.secondaryGroupIds]);
    if (thuMua && ids.has(thuMua.id)) return "thu_mua_cung_ung";
    if (thiCong && ids.has(thiCong.id)) return "thi_cong";
    return "other";
  } catch {
    return "other"; // KHÔNG throw — Decision 2: tra lỗi = coi như phòng khác, giữ hành vi cũ
  }
}
```

Trả về cùng lúc `leaderId` của "Thu mua cung ứng" (cho nhánh Thi công) ngay trong hàm resolve approver, tránh gọi `getCachedDepartments()` 2 lần (cache 60s nên không tốn thêm đọc Firestore, nhưng gọn hơn khi đọc code).

### 4. Ghi `originalFirstApprover` NGAY LÚC dựng `approversSnapshot` lần đầu

2 chỗ gọi `resolveApproverStepsWithMeta` rồi gán `approversSnapshot` (tạo đề xuất không-nháp ở `app/api/requests/route.ts`, và submit draft ở `app/api/requests/[id]/route.ts`) — NGAY SAU dòng gán, thêm:
```ts
originalFirstApprover: approversSnapshot[0] ?? null,
```
Đây là thời điểm DUY NHẤT ghi field này. Route `decision/route.ts` (forward_then_approve/approve_and_forward) KHÔNG đụng tới field này — đúng ý nghĩa "gốc", bất biến.

### 5. Route Duyệt/Từ chối/Chuyển tiếp — route MỚI `app/api/requests/[id]/adjustment/decision/route.ts`

Tách khỏi `decision/route.ts` (route đó cho LUỒNG DUYỆT CHÍNH của đề xuất, state máy khác hẳn — `approvers[]`/`ApproverState`). Route mới, thuần cho `pendingAdjustment`:

```ts
POST body: { decision: "approved" | "rejected" | "forward", target?: TaggedUser }
```
- Quyền: CHỈ `session.uid === request.pendingAdjustment.approverUid` (không có khái niệm Owner/Admin thay quyền, giống tinh thần `canSupplementAfterApproval`).
- `"approved"`: y hệt logic ghi `history`/`attachments` hiện có trong `adjustment/route.ts` (đếm "lần N" theo `ADJUSTMENT_HISTORY_PREFIX`, cùng transaction Firestore) — SAU KHI ghi xong, xoá `pendingAdjustment` về `null`, rồi MỚI gọi `taoViecDongBo()`/`after(() => guiCacViec(...))`.
- `"rejected"`: transaction chỉ xoá `pendingAdjustment` về `null` — KHÔNG đụng `history`/`attachments` (Decision 5 trong proposal — huỷ hẳn, không để lại dấu vết).
- `"forward"`: validate `target` hợp lệ (có `id`/`name`, khác chính người đang xử lý — tối thiểu, không cần kiểm "target thuộc phòng nào" vì Decision 6 không giới hạn người được chuyển tiếp tới), transaction chỉ đổi `pendingAdjustment.approverUid/approverName`, giữ nguyên `routedVia`/`noiDung`/`attachment`.

### 6. `adjustment/route.ts` — rẽ nhánh theo `resolveAdjustmentAccess`

```
access = resolveAdjustmentAccess(request, uid, department)
"none"   → 403 (giữ nguyên thông điệp lỗi hiện có)
"direct" → HÀNH VI CŨ Y NGUYÊN (ghi history ngay, gọi dong-bo ngay) — không đổi 1 dòng nào trong nhánh này so với code hiện tại
"gated"  → nếu request.pendingAdjustment đã có giá trị → 409 "Đã có 1 điều chỉnh khác đang chờ duyệt, vui lòng đợi xử lý xong."
           → resolve approver (Decision 3) → ghi pendingAdjustment, KHÔNG ghi history, KHÔNG gọi dong-bo
```

### 7. UI (`RequestDetailView.tsx` / `AdjustmentControl`)

- Trang chi tiết đề xuất (nơi đã có `currentUid`) cần thêm 1 lần gọi server để biết `access` + `pendingAdjustment` hiện tại — vì tra phòng ban PHẢI ở server (đọc Firestore App Tổng). Đơn giản nhất: `GET` request detail trả kèm `pendingAdjustment` (đã là field thật của `RequestInstance`, tự nhiên có sẵn) + 1 field tạm thời tính riêng cho người xem hiện tại, ví dụ `viewerAdjustmentAccess: "direct" | "gated" | "none"` — tính ở đúng chỗ đang load request cho trang chi tiết, KHÔNG lưu xuống Firestore (field phái sinh theo người xem, không phải dữ liệu của request).
- 3 trạng thái hiển thị:
  - `pendingAdjustment` rỗng + `viewerAdjustmentAccess !== "none"` → hiện `AdjustmentControl` như cũ, đổi chữ nút thành "Gửi duyệt điều chỉnh" khi `access === "gated"` (giữ "Cập nhật điều chỉnh" khi `"direct"`).
  - `pendingAdjustment` có giá trị + `session.uid === pendingAdjustment.approverUid` → hiện khung Duyệt/Từ chối/Chuyển tiếp (giống demo).
  - `pendingAdjustment` có giá trị + người xem khác (kể cả submitter) → hiện banner "⏳ Đang chờ {approverName} duyệt", ẩn `AdjustmentControl`.

## Risks / Trade-offs

- **[Risk]** Đổi tên phòng ban "Thi công"/"Thu mua cung ứng" trong App Tổng sau này → tính năng ÂM THẦM rơi về hành vi cũ (không báo lỗi, đúng ý Decision 2) → **Mitigation**: `console.warn` khi `resolveGateDepartment` không tìm thấy 1 trong 2 tên phòng kỳ vọng, để dò được lý do nếu sau này Sếp thắc mắc "sao không thấy duyệt nữa" — không hiện cho người dùng, chỉ log server.
- **[Risk]** Request tạo TRƯỚC change này không có `originalFirstApprover` → nhánh Thu mua cung ứng không có "Chỉ huy trưởng" để gán → **Mitigation**: coi như department "other" (rơi về hành vi cũ) CHỈ cho chính request đó, không throw, không chặn.
- **[Risk]** Ghi đè đồng thời `pendingAdjustment` (2 người cùng lúc bấm Duyệt/Từ chối, hoặc gửi điều chỉnh mới trong lúc 1 cái đang chờ) → **Mitigation**: mọi thao tác ghi `pendingAdjustment` chạy trong Firestore transaction (đọc bản mới nhất trong transaction, không đọc-rồi-ghi-đè) — đúng pattern đã có ở `adjustment/route.ts` hiện tại (comment PR #27).
- **[Trade-off]** "Chuyển tiếp" không để lại dấu vết trong `history[]` — chấp nhận được vì đây không phải quyết định CHÍNH THỨC của đề xuất (khác "Chuyển tiếp và Duyệt" ở luồng duyệt chính, có ảnh hưởng tới kết quả cuối cùng); nếu sau này cần truy vết, có thể thêm field `forwardedFrom` vào `pendingAdjustment` ở đợt sau.

## Migration Plan

- Toàn bộ field mới đều optional/additive — không cần migration script, không cần backfill.
- Deploy 1 PR duy nhất (route mới + sửa route cũ + UI + 2 chỗ ghi `originalFirstApprover`).
- Rollback: revert PR — không có thay đổi schema phá hoại, request đang có `pendingAdjustment` khi rollback sẽ "kẹt" ở trạng thái chờ (hiếm, chấp nhận được cho 1 rollback khẩn cấp; xử lý tay qua Firestore Console nếu gặp phải).

## Open Questions

- Có cần thông báo (email/chuông) riêng cho người duyệt mới khi có điều chỉnh chờ xử lý, hay để họ tự vào xem đề xuất? → Để NGOÀI PHẠM VI đợt này (Non-Goal), hỏi Sếp nếu thấy cần sau khi dùng thử thật.
