## Context

⚠️ CẬP NHẬT 26/09/2026: bản đầu design.md này nhầm repo — `THEO-DOI-CONG-NO` (owner `thuongpth-eng`, project Firestore `theo-doi-cong-no-cdf6e`) là bản Vite SPA CŨ, KHÔNG PHẢI code đang chạy thật ở congno.hpcore.vn. Repo THẬT đang deploy production là `ithungphuoc-ops/HPCons-Congno` (Next.js, tạo 26/09/2026), project Firestore THẬT là **`hpcons-congno`** (đã đối chiếu trực tiếp qua Firebase Console + Vercel project inspect — không phải suy đoán). Repo Next.js này CÓ 1 route server sẵn (`GET /api/summary`, bảo vệ bằng `HPCONS_PORTAL_API_KEY`) nhưng chỉ trả dữ liệu TÓM TẮT (KPI dashboard), KHÔNG có route nào trả danh sách chi tiết từng hợp đồng (`code`+`project`) — nên vẫn giữ hướng đọc chéo Firestore trực tiếp (Decision #2) thay vì gọi API đó. May mắn: schema dữ liệu (`code`, `name`, `group`, `customerName`...) của bản Next.js mới GIỐNG HỆT bản Vite cũ (đã xác nhận bằng Firestore Console thật) — mọi mapping field trong design này vẫn đúng, chỉ project ID đã được sửa lại xuyên suốt.

App Công nợ (repo `HPCons-Congno`, domain congno.hpcore.vn, Next.js) đọc/ghi Firestore qua Admin SDK phía server (route `/api/summary`) và Client SDK phía trình duyệt — base-request-app đọc THẲNG Firestore của họ bằng Admin SDK RIÊNG (không qua route `/api/summary` nào của họ). Firebase project riêng: `hpcons-congno`. Dữ liệu liên quan nằm phẳng trong collection `contracts`, mỗi document là 1 SỐ HỢP ĐỒNG cụ thể:

```
{ code: "01/2026/HĐXD-HPCS", name: "HOWELL", group: "HOWELL",
  customerName: "...", work: "...", totalAfterTax: 217204200000, ... }
```

`group` là tên dự án ngắn, nhiều `contracts` có thể chung 1 `group` (hợp đồng gốc + phụ lục phát sinh). `totalAfterTax` và các field tài chính khác là dữ liệu NHẠY CẢM, không được lộ ra ngoài phạm vi app Công nợ.

base-request-app đã có sẵn 1 mẫu đọc cross-project y hệt tình huống này: `lib/hpcore.ts` — 1 Firebase Admin App được đặt TÊN riêng (khác app mặc định), credential từ 1 biến môi trường JSON riêng, export thẳng hàm `get*Db()`. Sẽ tái dùng đúng mẫu này cho project Công nợ.

Cũng đã có sẵn 1 mẫu "cờ cấu hình trên field cụ thể + route gợi ý riêng" y hệt nhu cầu này: `ProposalField.suggestFromHistory` + `GET /api/groups/[id]/field-suggestions` + component `ShortTextWithSuggestions` (datalist trình duyệt) — khác duy nhất 1 điểm: `suggestFromHistory` là gợi ý MỀM (vẫn cho gõ tự do), còn yêu cầu lần này là ép CỨNG (Sếp: "gõ để ra gợi ý" — bắt buộc chọn đúng, không tự do).

## Goals / Non-Goals

**Goals:**
- Field "Số Hợp Đồng CĐT" (hoặc field short_text bất kỳ Admin đánh dấu) gợi ý đúng danh sách hợp đồng thật, và CHẶN gửi đề xuất chính thức nếu giá trị không khớp đúng 1 hợp đồng thật.
- Không lộ dữ liệu tài chính/nhạy cảm nào của app Công nợ ra client hay ra bất kỳ nơi nào khác của base-request-app.
- Tái dùng tối đa mẫu code đã có (`lib/hpcore.ts`, `suggestFromHistory` UI/API), không phát minh kiến trúc mới.

**Non-Goals:**
- KHÔNG đổi field "Tên công trình" — giữ nguyên gõ tự do, không liên kết, không tự động điền.
- KHÔNG tự động điền chéo giữa 2 field (đã cân nhắc ở vòng demo trước, Sếp chốt bỏ — chỉ ràng buộc đúng 1 field).
- KHÔNG cho phép ghi/sửa dữ liệu app Công nợ từ base-request-app — CHỈ ĐỌC.
- KHÔNG áp dụng cho lưu nháp (draft) — chỉ chặn khi gửi chính thức, giống mọi luật validate khác đã có (`findMissingRequiredFields`, `findBlockedDateLeadTimeFields`).

## Decisions

### 1. Cờ cấu hình: `ProposalField.contractCodeLookup?: boolean`
Thêm field mới trong `lib/types.ts`, đặt cạnh `suggestFromHistory`, cùng nguyên tắc: chỉ field kiểu `short_text`, Admin tự bật/tắt qua `AddFieldModal.tsx` (checkbox mới, KHÔNG đoán theo tên field — đúng "Cách 2" đã demo và Sếp chọn).

**Loại đã cân nhắc:** đoán theo tên field (field tên đúng "Số Hợp Đồng CĐT" tự bật) — loại vì mong manh, Admin đổi 1 chữ trong tên là mất tác dụng mà không biết vì sao (đã trình bày ở vòng demo, Sếp chọn cờ tường minh).

### 2. Kết nối cross-project: `lib/congno.ts`
Sao chép chính xác cấu trúc `lib/hpcore.ts`: Admin App tên `"congno"` (khác app mặc định `lib/firebase/admin.ts` VÀ khác app `"hpcore"` đã có — 3 app Admin SDK độc lập cùng tồn tại), credential từ `CONGNO_FIREBASE_SERVICE_ACCOUNT` (biến môi trường JSON mới, KHÁC `HPCORE_FIREBASE_SERVICE_ACCOUNT`). Thiếu biến môi trường → ném lỗi rõ ràng ngay khi gọi (không bịa fallback, không giả vờ có dữ liệu).

### 3. Route gợi ý: `GET /api/groups/[id]/contract-code-suggestions?fieldId=xxx`
Route MỚI, KHÔNG mở rộng `field-suggestions` (nguồn dữ liệu và mô hình quyền khác hẳn — route cũ đọc lịch sử CHÍNH nhóm đề xuất kèm `canView()`; route này đọc dữ liệu TOÀN CÔNG TY từ app khác, không phụ thuộc quyền xem đề xuất, chỉ cần đã đăng nhập + field đúng có bật cờ). Trả về mảng `{ code: string; project: string }[]` — CHỈ 2 field này, cố ý KHÔNG forward bất kỳ field nào khác của `contracts` (loại bỏ `totalAfterTax`, `customerName`, `work`... ngay tại route, không dựa vào "client không đọc tới" làm hàng rào bảo mật).

Cache: `unstable_cache`, revalidate 300 giây (5 phút) — dữ liệu hợp đồng đổi RẤT ít so với lịch sử đề xuất (route `field-suggestions` cũ dùng 60s vì đề xuất tạo liên tục cả ngày; hợp đồng mới có thể vài ngày/tuần mới thêm 1 cái) — đỡ tốn lượt đọc project Công nợ hơn nữa mà không mất tính đúng thực tế.

### 4. Component submit form: `ShortTextWithContractCodeLookup`
Component MỚI (không tái dùng `ShortTextWithSuggestions` vì khác hành vi ép buộc), cùng vị trí file (`app/request/groups/[groupId]/submit/page.tsx`), cùng cơ chế datalist HTML native (nhẹ, nhất quán với `ShortTextWithSuggestions`) + thêm `onBlur` validate: giá trị hiện tại không rỗng và không khớp đúng 1 `code` đã tải → hiện lỗi đỏ ngay tại chỗ (client-side, UX tức thời) — nhưng đây CHỈ là hỗ trợ trải nghiệm, không phải hàng rào bảo mật; hàng rào thật nằm ở Decision #5 (server).

### 5. Validate chặn gửi ở server: `findInvalidContractCodeFields`
Hàm mới trong `lib/server/requests.ts`, cùng dạng chữ ký với các hàm validate hiện có nhưng **bất đồng bộ** (cần đọc lại Firestore Công nợ tại thời điểm gửi — không tin danh sách client tải lúc mở form, tránh trường hợp gọi thẳng API né qua validate phía trình duyệt, đúng nguyên tắc `findBlockedDateLeadTimeFields` đã ghi "CodeRabbit phát hiện ở PR #2"). Gọi tại 2 nơi ĐANG gọi `findMissingRequiredFields`/`findBlockedDateLeadTimeFields`: `app/api/requests/route.ts` (tạo mới, `!isDraft`) và `app/api/requests/[id]/route.ts` (gửi từ nháp, `!isDraft`) — CHỈ khi gửi chính thức, không áp dụng lúc lưu nháp.

## Risks / Trade-offs

- **[Rủi ro]** Thiếu `CONGNO_FIREBASE_SERVICE_ACCOUNT` (chưa cấp key) → route gợi ý và validate server đều lỗi. → **Giảm nhẹ**: route gợi ý trả lỗi rõ ràng, KHÔNG sập trang submit (field rơi về không có gợi ý, người dùng vẫn gõ được nhưng sẽ bị chặn lúc gửi thật với thông báo rõ ràng "chưa cấu hình được nguồn dữ liệu hợp đồng" thay vì lỗi 500 mơ hồ) — cụ thể hoá ở tasks.md.
- **[Rủi ro]** Cache 5 phút khiến hợp đồng vừa thêm ở app Công nợ chưa gợi ý ngay được ở base-request-app. → **Chấp nhận được**: cùng đánh đổi các route cache khác trong hệ sinh thái đã chấp nhận; hợp đồng mới không phải nghiệp vụ cần thấy tức thời trong vòng vài phút.
- **[Rủi ro]** Field bật cờ này nhưng KHÔNG bắt buộc (`required=false`) và người dùng để trống → không có gì để validate, hợp lý (giữ nguyên coi rỗng là hợp lệ, giống mọi field không bắt buộc khác) — không phải lỗi, chỉ cần nêu rõ trong specs để không nhầm "bật cờ = bắt buộc điền".
- **[Đánh đổi]** Không tự động điền/không liên kết "Tên công trình" — người dùng vẫn có thể gõ tên công trình KHÔNG khớp với dự án thật của số hợp đồng đã chọn (vd chọn đúng mã của "HOWELL" nhưng gõ tay "SHUN HING" ở ô Tên công trình). Đây là đánh đổi CHỦ Ý theo đúng yêu cầu Sếp (đơn giản hoá, bỏ ràng buộc 2 chiều) — không phải lỗi sót.

## Migration Plan

1. Thêm cờ + kết nối cross-project + route + validate server (không có UI bật được chưa — an toàn deploy dần).
2. Thêm UI Admin (checkbox `AddFieldModal.tsx`) + UI submit form (component mới).
3. Sếp cấp `CONGNO_FIREBASE_SERVICE_ACCOUNT`, thêm vào Vercel (Production + Preview).
4. Admin bật cờ thật cho field "Số Hợp Đồng CĐT" của (các) nhóm cần dùng — KHÔNG tự động bật cho nhóm nào, Admin tự chọn.
5. Rollback: tắt cờ trên field đó (UI) là tắt hẳn hành vi mới cho field đó ngay lập tức, không cần revert code.

## Open Questions

- Tên hiển thị chính xác của công tắc trong `AddFieldModal.tsx` — đề xuất "Bắt buộc khớp Số Hợp Đồng CĐT (app Công nợ)", Sếp xem lại khi test UI thật có muốn đổi chữ không.
