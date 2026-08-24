## Context

Trang thật hiện tại (`general/page.tsx`) là 1 `<form>`-like list các `Row` luôn ở chế độ sửa — 14 field liền nhau, không phân nhóm, không có bước "xem trước". Bản demo tĩnh Sếp đã duyệt cho thấy hướng khác: xem trước theo card (giống Base.vn), chỉ mở modal khi cần sửa. Demo chỉ minh hoạ ĐÚNG 3 thẻ (Thông tin chung / Người duyệt / Luồng phê duyệt) và bên trong "Luồng phê duyệt" demo chỉ vẽ 1 dòng tóm tắt, không vẽ cách sửa các field còn lại (Quy trình xử lý, 2 cờ SLA, 4 cờ bắt buộc ghi chú, Báo quản lý trực tiếp, Người theo dõi mặc định + điều kiện) — 7 field này ĐANG tồn tại thật và đang dùng được, không được để mất khi đổi giao diện.

## Goals / Non-Goals

**Goals:**
- Khớp đúng bố cục 3 thẻ + modal "Chỉnh sửa Thông tin chung" như demo, cho đúng nhóm field demo đã liệt kê.
- Giữ nguyên 100% khả năng sửa của các field KHÔNG có trong demo (không rớt tính năng), bằng cách tự thiết kế thêm chỗ chứa hợp lý (2 thẻ + modal bổ sung), có nêu rõ đây là phần tự bổ sung.
- Không đổi bất kỳ hành vi lưu dữ liệu/API nào — chỉ đổi lớp trình bày.

**Non-Goals:**
- Không làm "Thêm người duyệt theo điều kiện" như 1 loại bước MỚI riêng biệt — nút này trong demo là no-op (`onclick="closeAddMenu()"`, không có handler thật), và điều kiện áp dụng cho bước duyệt ĐÃ có sẵn dưới dạng checkbox "Chỉ áp dụng khi thoả điều kiện" trên từng bước (từ change `add-base-vn-group-settings-parity`, đã complete). Xử lý bằng cách: bấm mục này trong add-menu = thêm 1 bước Cố định mới với checkbox điều kiện bật sẵn — tái dùng đúng cơ chế đang có, không tạo kind mới.
- Không làm "Thêm nhiều người duyệt cố định" thành hành vi khác "Thêm người duyệt cố định" — dữ liệu 1 bước "fixed" vốn đã nhận `users: TaggedUser[]` (nhiều người trong CÙNG 1 bước, từ change `add-multi-approver-per-step`, đã complete) — 2 mục demo chỉ là ngôn ngữ hiển thị khác nhau cho CÙNG 1 hành động (mở 1 bước Cố định mới, ô chọn người vốn đã cho tag nhiều người). Gộp thành 1 mục "+ Thêm người duyệt cố định" duy nhất trong menu thật, không tạo 2 mục trùng ý nghĩa.
- Không đổi field `status` (đã có, đang sửa được qua toggle trên `GroupRow.tsx` ở trang danh sách) — chỉ THÊM 1 nơi xem/sửa thứ 2 (đồng bộ 2 chiều qua state `group` chung, không tạo nguồn sự thật thứ 2).

## Decisions

1. **Cấu trúc trang mới**: giữ `GeneralSettingsPageInner` nhưng đổi từ "always-edit form" sang state `editing: null | "general" | "approval-flow" | "followers"` — `null` = hiện 4 card xem; khác `null` = hiện modal tương ứng đè lên (dùng lại `Modal` component có sẵn trong `components/shared/`, không tự viết overlay mới).
2. **4 card thay vì 3** (thêm "Người theo dõi" ngoài demo) — vì `followers`/`followersConditional` không có chỗ trong 3 card demo; tách card riêng nhất quán hơn nhét thêm vào "Luồng phê duyệt" (vốn đã không liên quan ngữ nghĩa).
3. **"Người duyệt" card giữ nguyên `ApproverStepsEditor` bên trong**, không viết lại logic thêm/sửa/xoá bước — chỉ đổi phần UI ngoài cùng: card hiện danh sách bước dạng rút gọn (tên, badge, mã, hạn xử lý) khi KHÔNG ở chế độ sửa bước nào; bấm 1 bước hoặc "+ Thêm" → hiện lại đúng `ApproverStepsEditor` (form đầy đủ hiện tại) ngay tại chỗ, không mở trang/modal riêng — vì logic bên trong (3 kind, validate, dedupe) đã đúng và đã test kỹ, rủi ro viết lại là không cần thiết.
4. **Modal "Chỉnh sửa Thông tin chung"** dùng đúng field/thứ tự trong demo (Tên, Phân loại, Thời hạn xử lý, Sử dụng cho, Mẫu form đề xuất?, Mô tả nhóm đề xuất rich text, Trạng thái) + thêm "Mô tả" (ngắn, plain) ngay dưới Tên — demo bỏ sót field này nhưng nó vẫn cần dùng (hiển thị ở danh sách nhóm), không thể xoá.
5. **Rich text toolbar trong demo là hình minh hoạ tĩnh** (B/I/U/S/quote/code/list/H1/H2/subscript/superscript/link/image/màu chữ/highlight/strikethrough) — `RichTextEditor` component thật hiện có sẵn bộ nút riêng, KHÔNG ép đổi để khớp pixel-by-pixel danh sách nút demo (rủi ro cao/không cần thiết cho mục tiêu chính là bố cục trang) — dùng nguyên `RichTextEditor` đã có.
6. **Tab sidebar**: đổi nhãn "Mẫu biểu đề xuất" → "Mẫu form đề xuất" (`GroupDetailNav.tsx`), đổi thứ tự "Thông báo" xuống dưới "Bộ đếm". KHÔNG thêm tab "Chữ ký điện tử" (demo tự đánh dấu "Ngoài phạm vi đợt này — để sau").

## Risks / Trade-offs

- [Rủi ro] Gộp field không có trong demo vào 2 card tự bổ sung có thể không đúng ý Sếp 100% → Mitigation: nêu rõ trong proposal.md đây là phần tự thiết kế thêm, xin xác nhận lại sau khi demo xong trên local nếu Sếp muốn bố cục khác.
- [Rủi ro] Đổi UI lớn có thể ảnh hưởng luồng test thủ công cũ (ảnh chụp/video hướng dẫn trước đây mô tả form cũ) → Mitigation: cập nhật lại 2 file hướng dẫn test .docx đã gửi Sếp sau khi xong (mục "Người duyệt — tên bước, hạn xử lý riêng" trong `huong-dan-test-admin.docx` cần vẽ lại theo giao diện mới).

## Open Questions

- Bố cục 2 card tự bổ sung ("Luồng phê duyệt" mở rộng + "Người theo dõi") — demo không có, cần Sếp xem qua bản dựng thật trên local rồi góp ý thêm nếu muốn đổi khác.
