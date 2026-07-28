## Context

Bước duyệt kiểu `submitter_manager` (`ApproverStepDef` trong `lib/types.ts`) hiện được server tự resolve HOÀN TOÀN tại thời điểm submit — đọc `departments/{departmentId}.leaderId` của người gửi rồi map sang `users/{leaderId}` (xem `lib/server/requests.ts` dòng ~129-163, hàm resolve leader, ném `MissingApproverError` nếu phòng ban không có `leaderId`). Client hiện KHÔNG gửi giá trị nào cho bước này.

Form tạo đề xuất (`app/request/groups/[groupId]/submit/page.tsx` dòng ~224-254) ĐÃ CÓ sẵn 1 khu vực "Người duyệt" xem trước — gọi `GET /api/groups/[groupId]/approver-preview`, nhận về `{ approvers: TaggedUser[] }` (1 mảng PHẲNG, đã gộp mọi bước `fixed` + `submitter_manager` thành 1 danh sách tên hiển thị dạng pill), có xử lý trạng thái `loading`/`error`/`ok`. Đây KHÔNG phải dòng chữ tĩnh như nhận định ban đầu lúc explore — nó đã resolve và hiện tên thật, kể cả báo lỗi khi thiếu `leaderId` (qua `MissingApproverError`).

Cái thực sự thiếu: API `approver-preview` hiện KHÔNG phân biệt được pill nào đến từ bước `fixed` và pill nào từ bước `submitter_manager` (không trả `stepIndex`/`kind` kèm theo) — nên không thể gắn đúng 1 nút "đổi quản lý trực tiếp" vào đúng vị trí bước đó, và cũng không có cách nào gửi giá trị override kèm theo lúc submit. Riêng ở trang admin cấu hình (`ApproverStepsEditor.tsx` dòng ~108-128), bước `submitter_manager` cũng chỉ hiện 1 dòng chữ mô tả tĩnh, không có picker nào — nhưng đó là trang admin, KHÔNG phải nơi cần sửa (xem Non-Goals).

`TagUserInput` (`components/shared/TagUserInput.tsx`) đã là component dùng chung cho mọi ô gắn thẻ người (approver "fixed", followers, mention bình luận), nhận `directoryUrl` tuỳ biến nguồn danh bạ — nhưng dropdown gợi ý CHỈ hiện khi có ký tự gõ vào (`query` rỗng → `results` rỗng, không có chế độ "duyệt toàn bộ danh sách").

Danh bạ đọc trực tiếp từ Firestore app tổng qua `getHpcoreDb()` (không có DB riêng ở app này) — `departments` và `users` đều nằm ở đó.

## Goals / Non-Goals

**Goals:**
- Người gửi thấy/xác nhận được quản lý trực tiếp của mình ngay trên form, không phải "mù" chờ server tự tính.
- Cho phép chọn tay 1 người khác trong đúng nhóm "đang là trưởng phòng/đơn vị" khi auto-resolve thiếu hoặc sai, KHÔNG cho chọn người bất kỳ ngoài nhóm này (giữ đúng ý nghĩa "quản lý trực tiếp").
- Tái dùng tối đa `TagUserInput` — không viết 1 component picker hoàn toàn mới.

**Non-Goals:**
- Không đổi cấu trúc lưu trữ `ApproverStepDef` (`submitter_manager` vẫn là 1 kind riêng, không hợp nhất với `fixed`).
- Không xây khái niệm "nhóm quản lý trực tiếp" như 1 bảng/entity mới — suy trực tiếp từ `department.leaderId` đang có.
- Không đổi trang admin cấu hình `ApproverStepsEditor.tsx` (chỉ đổi UI lúc điền form submit).

## Decisions

**0. Mở rộng `GET /api/groups/[groupId]/approver-preview` để trả về CHI TIẾT theo từng bước, thay vì mảng phẳng:**
   - Đổi response từ `{ approvers: TaggedUser[] }` sang thêm 1 mảng mới song song, vd `{ approvers: TaggedUser[]; steps: { index: number; kind: "fixed" | "submitter_manager"; user: TaggedUser | null; error?: string }[] }` — giữ nguyên field `approvers` cũ để không phá vỡ chỗ nào khác đang đọc (nếu có), chỉ CỘNG THÊM `steps`.
   - Client dùng `steps` để biết chính xác pill nào ứng với bước `submitter_manager` (có thể có nhiều bước cùng kiểu này), gắn đúng nút "Đổi quản lý trực tiếp" cạnh MỖI pill thuộc kiểu đó — không đổi gì với pill của bước `fixed`.
   - *Vì sao không thay thế hẳn field `approvers` cũ*: tránh phá vỡ giả định "1 mảng phẳng" nếu có chỗ khác trong code đang dùng nguyên response này (chưa rà hết); cộng thêm field mới an toàn hơn đổi hẳn shape cũ.

**1. Endpoint mới `GET /api/directory/managers`** — mirror `app/api/directory/route.ts` nhưng nguồn là tập hợp mọi `leaderId` distinct trong collection `departments` (lọc `leaderId != null`), map sang `users/{leaderId}`. Trả về `TaggedUser[]` có thêm field mới `title?: string` (tên phòng ban họ đang lãnh đạo, vd "Trưởng phòng Hành chính Nhân sự") để hiện dưới tên trong picker giống ảnh tham khảo.
   - *Vì sao không tái dùng `/api/directory/mentionable`*: endpoint đó trộn thêm nhóm/phòng ban vào kết quả (dùng cho mention bình luận), không phù hợp ngữ nghĩa "chỉ người, chỉ đang là trưởng đơn vị".

**2. Mở rộng `TagUserInput` thêm 2 prop tuỳ chọn, KHÔNG đổi hành vi mặc định (backward-compatible với mọi chỗ đang dùng: fixed approver, followers, comment mention):**
   - `browseAllLabel?: string` — nếu truyền, hiện 1 link text bên dưới ô nhập (giống "Chọn quản lý trực tiếp" trong ảnh); bấm vào mở dropdown với TOÀN BỘ `directory` đã tải (trừ người đã chọn), không cần gõ ký tự nào trước.
   - Field `title` (nếu có trong `TaggedUser`) hiện thêm 1 dòng phụ xám nhỏ dưới tên trong cả ô tag đã chọn và dropdown gợi ý.

**3. Server-side (`lib/server/requests.ts`): ưu tiên giá trị client gửi lên cho bước `submitter_manager`, fallback về auto-resolve khi thiếu/không hợp lệ:**
   - Nhận thêm 1 field tuỳ chọn trong payload submit (vd `managerOverrideUserId`) CHỈ áp dụng cho bước `submitter_manager`.
   - Server validate: id đó phải nằm trong đúng tập "đang là leaderId của ≥1 phòng ban" (query lại y hệt endpoint `/api/directory/managers`, KHÔNG tin nguyên giá trị client gửi) — nếu hợp lệ thì dùng, nếu không gửi hoặc không hợp lệ thì rơi về hành vi auto-resolve hiện tại y nguyên (không đổi khi field vắng mặt, tương thích ngược 100% với các nhóm request đã tồn tại).
   - *Vì sao không để server LUÔN tin theo client*: nếu bỏ qua auto-resolve hoàn toàn, người gửi có thể (dù vô tình) chọn nhầm ai đó không thực sự là quản lý của mình — validate lại theo đúng tập trưởng đơn vị giữ được đúng ý nghĩa ban đầu của bước duyệt này.

**4. Vị trí gắn UI: ngay trong khu vực "Người duyệt" đã có, KHÔNG thêm 1 field/section mới riêng** — với mỗi pill trong `steps` có `kind === "submitter_manager"`, hiện thêm 1 nút nhỏ "Đổi" cạnh pill đó; bấm vào mở `TagUserInput` (chỉ khi đang sửa, ẩn lại thành pill tĩnh sau khi chọn xong) với `directoryUrl="/api/directory/managers"` + `browseAllLabel="Chọn quản lý trực tiếp"`. Khi `steps[i].error` tồn tại (auto-resolve thất bại, vd thiếu `leaderId`), hiện luôn ở trạng thái "đang sửa" thay vì pill (không có gì để hiện làm pill tĩnh) kèm dòng lỗi hiện tại, bắt buộc người gửi chọn tay trước khi submit được — override là optional khi auto-resolve đã thành công, nhưng bắt buộc khi auto-resolve lỗi.

## Risks / Trade-offs

- [Danh sách quản lý trực tiếp có thể dài nếu công ty nhiều phòng ban] → picker có ô tìm kiếm (đã có sẵn trong `TagUserInput`, chỉ cần đảm bảo hoạt động cả khi `results` được nạp từ "duyệt toàn bộ" chứ không chỉ từ gõ query).
- [Thêm field mới vào payload submit có thể phá vỡ đề xuất cũ đã tạo trước khi có field này] → field hoàn toàn optional, thiếu = hành vi cũ, không migrate dữ liệu cũ.
- [Trùng tên người dùng dẫn lãnh đạo nhiều phòng ban → trùng trong danh sách] → dedupe theo `userId` trước khi trả về, gộp `title` nếu lãnh đạo >1 phòng ban (vd "Trưởng phòng A, Trưởng phòng B").

## Open Questions

- Tên field payload chính xác (`managerOverrideUserId` hay tên khác) — quyết định lúc viết code cụ thể ở tasks, không ảnh hưởng thiết kế tổng thể.
