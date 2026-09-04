## Context

`PATCH /api/requests/[id]` (`app/api/requests/[id]/route.ts:76-83`) chặn tuyệt đối sửa `values` khi `status !== "draft"/"returned"/"pending"` — một khi `"approved"`, không ai sửa được nữa, kể cả Owner/Admin. Đây là khoá cố ý, giữ nguyên không đổi trong change này.

Field kiểu bảng ("table"/"base_table") lưu giá trị ở `RequestInstance.values[field.id]`, dạng `WireTableRow[]` (`{cells: string[]}[]`, xem `lib/table-field.ts`). Cột hiển thị đọc từ `request.fieldsSnapshot[i].tableColumns` — đây là **bản snapshot đông cứng lúc nộp** (đặt tên `fieldsSnapshot`, tách biệt với field config sống của group), không phải tham chiếu trực tiếp tới field config của group.

Cơ chế "tải file mẫu Excel + import tự nối dòng/tự thêm cột" đã có sẵn — nhưng CHỈ ở trang soạn (`app/request/groups/[groupId]/submit/page.tsx:1008-1068`), hoạt động thuần client-side (chỉnh `values` trong state form, chưa submit lên server). Khi import phát hiện cột lạ, cơ chế gốc cập nhật vào **field config của GROUP** (dùng chung cho mọi submission sau này trong nhóm đó — xem comment dòng 1019, trỏ tới Decision #10 của change `add-request-detail-base-parity`).

Đính kèm cấp đề xuất (`RequestInstance.attachments[]`, API `app/api/requests/[id]/attachments/route.ts`) hiện cho phép "submitter hoặc Owner/Admin" thêm file, không phân biệt theo `status`.

`RequestHistoryEntry` (`lib/types.ts:519-526`, `{at, actor, action, target?, note?}`) là nhật ký hoạt động sẵn có của 1 đề xuất — dùng cho mọi mốc quan trọng (nộp, duyệt, đồng bộ Thu Mua...).

## Goals / Non-Goals

**Goals:**
- Cho submitter bổ sung dữ liệu (nối dòng bảng + đính file) vào chính đề xuất đã duyệt của mình, không phá vỡ tính toàn vẹn của dữ liệu đã duyệt.
- Truy vết được mỗi lần bổ sung: lần thứ mấy, lúc nào — tái dùng `history[]` sẵn có, không thêm cơ chế lưu vết song song.
- Tái dùng tối đa logic đọc/ghi bảng Excel đã có (`lib/table-field.ts`, hàm import trong `submit/page.tsx`) thay vì viết lại.

**Non-Goals:**
- Không cho sửa/xoá dòng đã có trong bảng (kể cả sửa lỗi chính tả) — chỉ nối thêm.
- Không đụng `PATCH /api/requests/[id]` hiện có.
- Không cho Owner/Admin bổ sung thay submitter (khác hẳn quyền đính kèm ở các trạng thái khác).
- Không tự động đẩy dữ liệu từ App Thu Mua sang (đã cân nhắc, Sếp chọn hướng thủ công — xem proposal.md).
- Không cập nhật field config của GROUP khi phát hiện cột mới (khác hành vi gốc ở trang soạn) — xem Decision 3.

## Decisions

### Decision 1 — Route mới, phạm vi hẹp, riêng cho "nối dòng"

Thêm `POST /api/requests/[id]/table-supplement`. Route này:
- Yêu cầu `requireSession()`, `found.status === "approved"`, `found.submittedBy.uid === session.uid` (không chấp nhận Owner/Admin — 403 nếu không đúng cả 3 điều kiện).
- Nhận `{ fieldId: string; newRows: string[][]; newColumns?: string[] }`.
- Tìm đúng field trong `found.fieldsSnapshot` theo `fieldId`, xác nhận `dataType` là "table"/"base_table" — không tìm thấy hoặc sai kiểu → 400.
- Đọc dòng hiện có qua `deserializeTableRows(found.values[fieldId])`. Ghép `finalColumns = [...field.tableColumns, ...newColumns cần thêm]` (dedupe theo tên đã chuẩn hoá, cùng logic `normalize` đang dùng ở `submit/page.tsx:1035`). Dòng CŨ được bù thêm ô trống cho cột mới (giữ đúng hành vi gốc). Dòng MỚI từ `newRows` nối vào cuối — **không xoá, không sửa vị trí dòng cũ nào**.
- Ghi `values[fieldId] = toWireTableRows([...paddedOldRows, ...newRows])` và `fieldsSnapshot[i].tableColumns = finalColumns` (chỉ trên bản snapshot của CHÍNH đề xuất này — xem Decision 3) bằng 1 lệnh `update()` duy nhất (không cần transaction — chỉ 1 người/submitter được phép ghi field này theo điều kiện quyền, không có race giữa nhiều actor).
- Đếm số lần: `history.filter(h => h.action.startsWith("Bổ sung dữ liệu bảng sau duyệt")).length + 1`, ghi `history` mới với `action: "Bổ sung dữ liệu bảng sau duyệt (lần N): thêm K dòng vào \"<field.name>\""`.
- Trả về `RequestInstance` đã cập nhật (giống pattern `PATCH` hiện có).

**Vì sao route riêng thay vì mở rộng `PATCH`**: giữ nguyên tuyệt đối hành vi khoá hiện có (rủi ro thấp nhất — không đụng code đường găng đang chạy đúng), và điều kiện quyền/logic của route mới đơn giản, tách bạch, dễ audit (chỉ làm đúng 1 việc: nối dòng).

### Decision 2 — UI: khu vực "Bổ sung sau duyệt" trong `RequestDetailView.tsx`

Đặt ngay dưới mỗi field bảng trong card "Thông tin khác" (cạnh `TableValueView` hiện có, dòng ~821-825) — không phải 1 card riêng ở cuối trang, để người xem thấy ngay dòng bổ sung liền kề bảng gốc, dễ đối chiếu. Điều kiện hiện: `request.status === "approved" && isOwnRequest`.

- Nút "+ Bổ sung dữ liệu" mở form: 2 nút con "Tải file mẫu" / "Thêm file" — tái dùng NGUYÊN VĂN 2 hàm `downloadTemplateFile`/`importTableFile` từ `submit/page.tsx` (di chuyển thành hàm dùng chung, xem Decision 4), chỉ khác đích ghi: gọi `POST /api/requests/[id]/table-supplement` thay vì `onChange` cục bộ.
- Sau khi nối dòng thành công, `TableValueView` render lại toàn bộ bảng (dòng cũ + dòng mới), dòng mới có nhãn nhỏ dưới bảng: `🕘 Bổ sung sau duyệt · lần {N} · {at hiển thị dd/mm HH:MM}` — suy ra N và `at` bằng cách đọc lại các dòng `history` có action bắt đầu `"Bổ sung dữ liệu bảng sau duyệt"`, không cần lưu field riêng trên từng dòng bảng.
- Không hiện icon/nút này nếu `!isOwnRequest` — kể cả Owner/Admin xem trang cũng không thấy nút (đúng yêu cầu "chỉ submitter").

Khu vực "Tài liệu đính kèm" (dòng 871-914) sửa nhỏ: điều kiện nút "Thêm tài liệu" đổi từ `(isOwnRequest || canManage)` thành:
```
(request.status === "approved" ? isOwnRequest : (isOwnRequest || canManage))
```
Và khi `attachments` có mục được thêm sau khi `status === "approved"`, hiện thêm dòng nhãn tương tự (đọc từ `history`, action `"Đính kèm tài liệu sau duyệt (lần N): <tên file>"`).

### Decision 3 — Cột mới chỉ áp dụng cho snapshot của CHÍNH đề xuất này, không cập nhật field config của GROUP

Hành vi gốc ở `submit/page.tsx` (`onTableColumnsChange`) cập nhật field config CHUNG của group khi phát hiện cột lạ — hợp lý ở đó vì đang trong lúc soạn, thuộc quyền quyết định cấu trúc mẫu. Ở route mới, hành động diễn ra SAU khi đã duyệt, do 1 submitter, cho ĐÚNG 1 đề xuất — nếu lan sang field config của group sẽ làm mọi submission MỚI của group đó tự nhiên có thêm cột ngoài ý muốn, không ai chủ đích quyết định việc đó. Vì vậy: cột mới chỉ ghi vào `found.fieldsSnapshot[i].tableColumns` (bản snapshot riêng của đề xuất này), không đụng field config sống của group.

**Đánh đổi**: nếu nhiều đề xuất khác nhau trong cùng group đều cần bổ sung cùng 1 cột (vd "Đơn giá"), mỗi đề xuất tự thêm cột riêng, không đồng bộ ngược lại mẫu chung — chấp nhận được vì đây là dữ liệu XÁC NHẬN SAU THỰC TẾ của từng đơn hàng cụ thể, không phải thay đổi cấu trúc mẫu có chủ đích.

### Decision 4 — Tái dùng hàm Excel bằng cách tách ra tiện ích dùng chung

Tách `downloadTemplateFile`/`importTableFile` (hiện định nghĩa inline trong `submit/page.tsx`) thành 2 hàm xuất từ `lib/table-field.ts` (hoặc file tiện ích mới `lib/table-field-import.ts` nếu tách riêng cho gọn, quyết định lúc code theo file nào import `xlsx` sẵn ít xáo trộn hơn), nhận tham số `columns`/`rows`/callback ghi kết quả thay vì đóng cứng theo `onChange` cục bộ của trang soạn. `submit/page.tsx` gọi lại đúng 2 hàm này (refactor, hành vi không đổi) — `RequestDetailView.tsx` gọi cùng 2 hàm cho khu vực "Bổ sung sau duyệt".

### Decision 5 — Đếm "lần thứ mấy" bằng cách lọc `history[]` theo tiền tố action, không thêm field mới

Không thêm `uploadedAt`/`uploadedBy`/`supplementIndex` vào `RequestAttachment` hay dòng bảng — mọi thứ suy ra được từ `history[]` (đã có `at`, `actor`, `action`). Route mới (và route attachments khi đã duyệt) LUÔN ghi 1 dòng `history` tương ứng mỗi lần thao tác thành công; UI đếm số dòng `history` khớp tiền tố action để ra "lần N", và lấy `at` của dòng khớp gần nhất làm mốc hiển thị. Đơn giản hơn, 1 nguồn sự thật duy nhất cho "khi nào/lần mấy", không có 2 nơi lưu thời gian có thể lệch nhau.

## Risks / Trade-offs

- **[Risk] Nhiều bảng trong cùng đề xuất, nhãn "lần N" tính chung 1 chuỗi đếm cho cả đề xuất (không tách riêng theo field)** → Chấp nhận được ở bản đầu — action text luôn kèm tên field (`"...vào \"<field.name>\""`) nên vẫn phân biệt được field nào, chỉ số đếm là chung toàn đề xuất. Có thể tách đếm riêng theo field sau nếu thực tế cần.
- **[Risk] Submitter nghỉ việc/đổi phòng ban sau khi đề xuất đã duyệt → không còn ai bổ sung được nữa** → Chấp nhận theo đúng quyết định của Sếp (chỉ submitter, không Owner/Admin) — nếu phát sinh thật, xử lý ngoại lệ thủ công (đổi `submittedBy` hoặc nhờ Owner sửa trực tiếp Firestore), không thuộc phạm vi tự động hoá của change này.
- **[Risk] Cột mới ghi vào `fieldsSnapshot` của riêng đề xuất, không đồng bộ về group** → Đã chấp nhận ở Decision 3, đánh đổi được ghi rõ ở đó.
- **[Risk] Đọc lại `xlsx` (thư viện nặng ~1MB) ở cả 2 trang** → Không phát sinh gì mới — cả 2 nơi đều `import("xlsx")` động (lazy), giữ nguyên pattern hiện có.

## Migration Plan

Không có migration dữ liệu (mọi field mới đều optional/suy ra từ dữ liệu sẵn có). Deploy: build + test qua bình thường (Vercel auto-deploy khi merge `main`), không cần bước riêng. Rollback: revert PR, không có dữ liệu cần dọn (route mới không được gọi ở đâu khác nếu tắt UI).

## Open Questions

Không còn — mọi quyết định đã chốt qua thảo luận + demo Artifact với Sếp (04/09/2026).
