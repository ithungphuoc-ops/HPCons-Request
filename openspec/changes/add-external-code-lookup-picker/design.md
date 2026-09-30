## Context

Cơ chế hiện tại (production, không có spec riêng) chỉ phục vụ ĐÚNG 1 trường hợp:

```
lib/types.ts            ProposalField.contractCodeLookup?: boolean
lib/congno.ts            loadContractCodeSuggestions() — đọc "contracts", cache 5', forward 4 field cố định
route contract-code-suggestions/route.ts   gợi ý dropdown, check f.contractCodeLookup
lib/server/requests.ts   findInvalidContractCodeFields() — chặn gửi chính thức nếu không khớp code thật
submit/page.tsx          ShortTextWithContractCodeLookup — autocomplete tự lọc, hard-code field code/customerNameShort/work
```

Gọi ở đúng 2 nơi lúc gửi chính thức: `app/api/requests/route.ts:348` (tạo mới) và `app/api/requests/[id]/route.ts:199` (gửi từ nháp/pending).

Sếp cần thêm nguồn thứ 2 (Mã nhà thầu phụ, collection `subcontractors`) và xác nhận sẽ có thêm nhu cầu tương tự trong tương lai, nhưng KHÔNG muốn mỗi lần lại nhân bản/deploy code mới. Đã bàn qua 5 hướng (demo HTML 29–30/09/2026), Sếp chốt: Admin CHỌN nguồn có sẵn ngay tại chỗ (Modal Thêm/Sửa trường), KHÔNG gõ tay tên collection/field, KHÔNG cần màn cấu hình Firestore riêng — vì phạm vi nguồn cho phép đã chốt CỨNG (không mở rộng tự do ở đợt này).

Đã xác nhận qua code thật `HPCons-Congno/lib/data.ts` + `app/api/*/route.ts` (repo Công nợ, đã `git pull` origin/master 29/09/2026): project Firestore `hpcons-congno` có 9 collection. Sếp tự xác nhận (không cần hỏi bên vận hành Công nợ) 3 collection sau là an toàn để lộ tên/mã: `contracts`, `subcontractors`, `customers`. 6 collection còn lại (`subContracts`, `installments`, `approvals`, `users`, `allowedEmails`, `feedback`) chứa dữ liệu tài chính/tài khoản/bảo mật — TUYỆT ĐỐI không được liệt kê hay đọc ở đâu trong đợt này.

`customers` sau khi đọc kỹ (`HPCons-Congno/lib/data.ts:216-243`) chỉ có đúng 2 field: `id` (ID Firestore SINH NGẪU NHIÊN qua `addDoc`, không phải mã do người nhập) và `name`. Không có field "mã" nào hợp lý để ràng buộc kiểu "gõ đúng 1 mã có thật" — khác hẳn `contracts`/`subcontractors` (đều có mã ngắn do người nhập tay). Quyết định: **loại `customers` khỏi phạm vi đợt này** (xem Decision 5).

## Goals / Non-Goals

**Goals:**
- Thêm được nguồn "Mã nhà thầu phụ" (khớp `ma` HOẶC `mst`) mà KHÔNG viết lại route/hàm validate riêng — dùng chung logic với "Số Hợp Đồng CĐT".
- Field đang bật `contractCodeLookup: true` trên production tiếp tục hoạt động Y HỆT không cần Admin làm gì lại.
- Admin thêm field mới ràng buộc theo 1 trong các nguồn đã duyệt CHỈ bằng cách chọn (không gõ tay), không cần deploy để dùng 1 nguồn ĐÃ có trong danh sách cho phép.
- Không bao giờ lộ field tài chính (`totalAfterTax`...) hay bất kỳ collection nào trong 6 collection nhạy cảm, dù vô tình.

**Non-Goals (ngoài phạm vi, ghi rõ để không ai hiểu nhầm là quên):**
- Không làm màn "Nguồn dữ liệu ngoài" cấu hình qua Firestore (Cấp C) — danh sách nguồn CỐ ĐỊNH trong code.
- Không tự động liệt kê/khám phá TOÀN BỘ collection thật của project Công nợ lúc runtime (Cấp D "cao" như mô tả cảm giác trong demo tương tác) — xem Decision 6 vì sao.
- Không hỗ trợ project Firestore nào khác ngoài `congno` (Cấp E).
- Không thêm nguồn `customers` (xem Decision 5).
- Không cho Admin tự chọn field nào bất kỳ trong document làm "mã"/"hiện phụ" — codeFields/displayFields của mỗi nguồn là CỐ ĐỊNH trong registry, Admin chỉ chọn NGUỒN, không tự tay chọn field.

## Decisions

### Decision 1 — Thay boolean bằng tham chiếu tới 1 nguồn cố định trong registry

```ts
// lib/types.ts
export type ExternalCodeSourceId = "congno_contracts" | "congno_subcontractors";

export interface ExternalCodeLookupConfig {
  sourceId: ExternalCodeSourceId;
}

// ProposalField
externalCodeLookup?: ExternalCodeLookupConfig;
```

Field CHỈ lưu `sourceId` — không lưu lại tên collection/field mã/field hiện phụ trên từng field (khác với gợi ý ban đầu trong yêu cầu). Lý do: các field đó là thuộc tính của NGUỒN, không phải của TỪNG field đề xuất — lưu lặp lại sẽ tạo 2 nơi có thể lệch nhau nếu sau này đổi field hiện phụ của 1 nguồn (chỉ cần sửa registry, không phải dò từng field đã lưu). Đây chính là bài học từ CodeRabbit PR #41 (2 nơi tự giữ dữ liệu dễ lệch) áp dụng ngược lại cho thiết kế lần này.

**Thay thế:** giữ cả object (`{sourceId, codeFields, displayFields}` do field tự lưu) — bị bác vì tạo 2 nguồn sự thật (registry code VÀ dữ liệu Firestore field) có thể lệch khi registry đổi.

### Decision 2 — Registry cố định trong code (`lib/external-code-sources.ts`, file mới)

```ts
export interface ExternalCodeRecord {
  /** Mọi giá trị được coi là "mã" hợp lệ của 1 bản ghi — khớp ĐÚNG 1 trong các
   *  giá trị này là đủ (Quyết định #4). */
  codeValues: string[];
  /** Cột phụ hiển thị trong gợi ý dropdown — CỐ ĐỊNH theo nguồn, không do
   *  Admin tự chọn. */
  display: Record<string, string>;
}

export interface ExternalCodeSourceDef {
  id: ExternalCodeSourceId;
  label: string;
  loadRecords(): Promise<ExternalCodeRecord[]>;
}
```

`congno_contracts.loadRecords()` BỌC LẠI nguyên `loadContractCodeSuggestions()` đã có sẵn trong `lib/congno.ts` (KHÔNG sửa hàm gốc, KHÔNG đổi cache 5 phút đang chạy thật) — chỉ map `{code, project, work, customerNameShort}` sang `{codeValues:[code], display:{project, work, customerNameShort}}`.

`congno_subcontractors.loadRecords()` — hàm MỚI `loadSubcontractorCodeSuggestions()` trong `lib/congno.ts`, đọc collection `subcontractors`, cache 5 phút (cùng kiểu `unstable_cache`), CHỈ forward `ma`, `mst`, `ten`, `diaChi` — filter bỏ bản ghi không có CẢ `ma` LẪN `mst` (không có gì để khớp). Map sang `{codeValues: [ma, mst].filter(Boolean), display:{ten, mst, diaChi}}`.

**Thay thế đã cân nhắc:** đọc collection tuỳ ý theo cấu hình Firestore (Cấp C) — bị hoãn, vì Sếp chốt phạm vi hiện tại chỉ 2 nguồn cố định, generalize thêm bây giờ là đầu tư thừa (YAGNI) — dễ nâng cấp sau vì Decision 1 đã tách field khỏi chi tiết nguồn.

### Decision 3 — Hàm validate/gợi ý dùng chung, thay 2 hàm cũ

- `findInvalidContractCodeFields` → đổi tên `findInvalidExternalCodeFields(fields, values)`: lọc field có `externalCodeLookup`, gom theo `sourceId` (tránh gọi `loadRecords()` trùng nếu nhiều field cùng nguồn), với mỗi field kiểm tra giá trị có nằm trong `codeValues` của BẤT KỲ record nào không.
- Route `contract-code-suggestions/route.ts` → đổi tên `external-code-suggestions/route.ts`, nhận `?fieldId=`, đọc `field.externalCodeLookup.sourceId`, trả `{records: ExternalCodeRecord[]}` thay vì `{suggestions: ContractSuggestion[]}` (đổi shape response — client phải cập nhật theo, xem Decision 7).
- Giữ nguyên tuyệt đối 2 điểm gọi trong `app/api/requests/route.ts:348` và `app/api/requests/[id]/route.ts:199` — chỉ đổi TÊN hàm import, không đổi vị trí/thời điểm gọi (không đổi hành vi "chỉ chặn lúc gửi chính thức, không chặn nháp").

### Decision 4 — Khớp NHIỀU field mã (OR), không phải 1 field duy nhất

`ExternalCodeRecord.codeValues: string[]` thay vì `code: string` đơn — với `subcontractors`, 1 bản ghi có thể góp NHIỀU giá trị hợp lệ. Validate: giá trị field khớp nếu NẰM TRONG hợp của mọi `codeValues` của mọi record. Gợi ý dropdown: hiện TẤT CẢ giá trị (1 record có 3 `codeValues` sinh ra 3 dòng gợi ý riêng, cùng chung cột phụ `display` của record đó).

**Cập nhật 30/09/2026 (dùng thật, group "7.0. Xét duyệt báo giá"):** `codeValues` của `congno_subcontractors` ban đầu chỉ có `[ma, mst]` — Sếp phản hồi field "Tên nhà thầu phụ đề xuất" cần chọn/gõ được THEO TÊN (không chỉ theo mã nội bộ), vì đây đúng là mục đích của field đó. Thêm `ten` vào `codeValues` (`[ma, mst, ten].filter(Boolean)`) — gõ/chọn theo tên giờ cũng khớp hợp lệ, và dòng gợi ý ứng với `ten` khi chọn sẽ ghi đúng TÊN vào giá trị field (không phải mã), đúng ý nghĩa field.

**Rủi ro đã biết (không chặn lại vì xác suất thấp — xem Risks):** 2 nhà thầu phụ khác nhau trùng giá trị (MST công ty A = Mã NCC công ty B, hoặc trùng tên) → validate coi là khớp dù không đúng ý người gõ. Với 135 bản ghi hiện tại, chưa phát hiện trùng.

### Decision 4b — Định dạng hiển thị KHÔNG được tổng quát hoá mù quáng (sửa lỗi 30/09/2026)

Bản đầu của Decision 7 (bên dưới) nối TẤT CẢ field trong `display` bằng " · " cho MỌI nguồn — với `congno_contracts`, việc này VÔ TÌNH làm sai định dạng đã chốt riêng 26/09/2026 (trước đây dropdown CHỈ hiện `customerNameShort`, và dòng "khớp chính xác" CHỈ hiện "Hạng mục: …"; sau tổng quát hoá lại hiện gộp "HOWELL · Phát sinh… · HOWELL TECHNOLOGY" — Sếp phát hiện qua dùng thật, coi là bug).

Sửa: thêm `DISPLAY_UI` (client, trong `submit/page.tsx`) — 1 `Partial<Record<ExternalCodeSourceId, {...}>>` cho phép TỪNG nguồn tự định nghĩa cách hiển thị cột phụ + dòng "khớp chính xác" riêng, RIÊNG `congno_contracts` được phục hồi đúng định dạng cũ; nguồn nào CHƯA khai báo (hiện là `congno_subcontractors`) vẫn rơi về cách nối chung chung (không mất tổng quát khi thêm nguồn mới, chỉ cần khai báo thêm khi có phản hồi cụ thể cần định dạng riêng — giống đúng cách `congno_contracts` vừa được thêm).

**Bài học:** "không hard-code tên field" (Decision 7 gốc) là mục tiêu đúng cho phần AN TOÀN DỮ LIỆU (field nào được lộ ra — vẫn giữ nguyên, do server registry quyết định), nhưng KHÔNG nên áp dụng mù quáng cho phần TRÌNH BÀY/UX — trình bày vẫn cần được CURATE riêng khi có yêu cầu cụ thể, chỉ nguồn MỚI CHƯA có phản hồi gì mới dùng mặc định chung chung.

### Decision 5 — Loại `customers` khỏi phạm vi

Đã đọc `HPCons-Congno/lib/data.ts:18-21,216-243`: collection `customers` documents chỉ có `{id, name}`; `id` sinh bởi `addDoc()` (chuỗi ngẫu nhiên Firestore), KHÔNG phải mã nghiệp vụ do ai gõ tay. Không có field nào đóng vai "mã tham chiếu" theo đúng nghĩa (khác hẳn `code` của contracts hay `ma`/`mst` của subcontractors). Ràng buộc field theo `name` (khớp CHÍNH XÁC tên khách hàng) không cùng bản chất "mã ngắn dễ nhớ/dễ gõ đúng" như 2 nguồn kia, và tên công ty dài/dễ gõ sai dấu — không đưa vào registry đợt này. Nếu sau này Sếp cần, phải bàn lại: hoặc dùng `name` làm "mã" (chấp nhận đối chiếu theo tên), hoặc đề nghị Công nợ thêm field mã riêng cho khách hàng trước.

### Decision 6 — UI: 2 bước "chọn nguồn (thẻ) → xem trước mẫu → xác nhận" (Phương án B, Sếp chốt 30/09/2026)

Đã cho Sếp bấm thử 2 phương án qua demo `so-sanh-ui-gon-vs-co-buoc-2026-09-30/index.html` (dựng đúng style Modal/Row app thật): Phương án A (1 dropdown gọn) và Phương án B (chọn nguồn dạng thẻ trực quan → xem trước 1 dòng dữ liệu mẫu THẬT của nguồn đó → xác nhận). **Sếp chọn Phương án B.**

Luồng UI thật trong `AddFieldModal.tsx`, thay vị trí checkbox cũ:
1. Checkbox bật/tắt "Bắt buộc khớp 1 mã tham chiếu ngoài" (giữ đúng tinh thần checkbox cũ, chỉ đổi phần hiện ra khi bật).
2. Bật lên → hiện panel với ĐÚNG 2 thẻ nguồn (từ `EXTERNAL_CODE_SOURCES`, tên lấy từ `label`) — không có bước "chọn project" riêng (chỉ có 1 project `congno`), không tự liệt kê 8+ collection thật (đã chốt ở Non-Goals, khác demo `cap-do-D` chỉ để minh hoạ cảm giác Cấp D nói chung).
3. Bấm 1 thẻ → hiện bảng xem trước ĐÚNG 1 bản ghi mẫu thật của nguồn đó (gọi `loadRecords()` của nguồn, lấy phần tử đầu tiên, hiện `display` + 1 trong `codeValues` làm ví dụ) — CHỈ ĐỂ XEM, không cho tick chọn field nào (field mã/hiện phụ đã cố định trong registry, không phải lựa chọn của Admin — khác demo `cap-do-D` cho tick field, cái đó chỉ hợp lý khi thật sự browse động, ở đây thì không).
4. Bấm "Xác nhận" → lưu `externalCodeLookup: {sourceId}` cho field, hiện lại dạng tóm tắt (chip xanh "Đã ràng buộc: <label>") kèm nút "Đổi lại" quay về bước 2.

Lý do chọn cách này thay vì gọn hơn (Phương án A): Sếp muốn Admin THẤY được 1 dòng dữ liệu thật trước khi xác nhận, tăng tự tin đã chọn đúng nguồn — đổi lại tốn thêm ~1 lượt gọi `loadRecords()` lúc mở panel (đã có cache 5 phút sẵn ở Decision 2, không phát sinh lượt đọc Firestore mới đáng kể) và thêm khoảng 60-80 dòng JSX/state so với Phương án A.

### Decision 7 — Client autocomplete (`submit/page.tsx`) tổng quát hoá

`ShortTextWithContractCodeLookup` hiện hard-code field `code`/`customerNameShort`/`work`. Đổi thành component nhận `ExternalCodeRecord[]` chung: lọc theo `codeValues` (thay vì `code` đơn), cột phụ lấy từ `display` (thứ tự field theo registry, không hard-code tên field). Giữ nguyên hành vi UX đang có: lọc ưu tiên khớp đầu chuỗi, báo `mismatch` khi rời ô không khớp, tối đa 30 gợi ý.

### Decision 8 — Tương thích ngược dữ liệu cũ

Field trên production đang có `contractCodeLookup: true` (chưa có `externalCodeLookup`). Đọc-tương-thích ở ĐÚNG 1 chỗ trung tâm — hàm `resolveExternalCodeLookup(field: ProposalField): ExternalCodeLookupConfig | undefined`:
```ts
function resolveExternalCodeLookup(field: ProposalField): ExternalCodeLookupConfig | undefined {
  if (field.externalCodeLookup) return field.externalCodeLookup;
  if (field.contractCodeLookup) return { sourceId: "congno_contracts" }; // field cũ, chưa migrate
  return undefined;
}
```
Mọi nơi đọc (`findInvalidExternalCodeFields`, route suggestions, `AddFieldModal` lúc mở "Sửa trường", `submit/page.tsx`) đều gọi qua hàm này — KHÔNG đọc trực tiếp `field.externalCodeLookup`. Field TẠO MỚI hoặc SỬA LẠI qua UI mới sẽ ghi `externalCodeLookup`, không ghi `contractCodeLookup` nữa (field cũ giữ nguyên `contractCodeLookup: true` trong Firestore cho tới khi có ai sửa field đó — không chạy migration ghi lại hàng loạt, giảm rủi ro đụng dữ liệu production không cần thiết). `contractCodeLookup` giữ trong `lib/types.ts`, đánh dấu `@deprecated` — không xoá ngay.

**Thay thế đã cân nhắc:** chạy 1 script migration ghi lại toàn bộ field cũ ngay lập tức — bị hoãn vì không cần thiết (đọc-tương-thích đã đủ), và tránh rủi ro sửa dữ liệu Firestore production hàng loạt không có lý do cấp bách.

## Risks / Trade-offs

- [Rủi ro] Admin có thể chọn nhầm nguồn không phù hợp ngữ nghĩa cho field (vd chọn "Mã nhà thầu phụ" cho 1 field thật ra nên là "Số Hợp Đồng CĐT") → Mitigation: `label` hiển thị rõ ràng trong dropdown, giữ y hệt cách checkbox cũ ghi rõ tên; không khác gì rủi ro đã tồn tại trước đây.
- [Rủi ro] 2 bản ghi khác nhau trùng giá trị mã (Decision 4) → Mitigation: chấp nhận vì xác suất thấp với dữ liệu hiện tại; không chặn lại, chỉ ghi nhận.
- [Rủi ro] Field cũ (`contractCodeLookup`) và field mới (`externalCodeLookup`) cùng tồn tại lâu dài nếu không ai sửa field cũ → Mitigation: `resolveExternalCodeLookup` xử lý cả 2 vĩnh viễn cho tới khi dọn dẹp thủ công sau này (chấp nhận nợ kỹ thuật nhỏ, không chặn release).
- [Trade-off] Phương án B (Decision 6) tốn thêm 1 lượt gọi `loadRecords()` để hiện xem trước lúc mở panel, và nhiều JSX/state hơn Phương án A — chấp nhận đổi lấy việc Admin thấy được dữ liệu thật trước khi xác nhận, giảm rủi ro chọn nhầm nguồn.

## Migration Plan

1. Deploy code mới — không cần script migration dữ liệu (Decision 8), không có downtime.
2. Field "Số Hợp Đồng CĐT" hiện có (dùng `contractCodeLookup: true`) tiếp tục chạy qua đường tương thích — kiểm tra thật trên production SAU deploy (không phải trước) vì không đổi dữ liệu, chỉ đổi code đọc.
3. Field mới tạo qua UI sẽ dùng `externalCodeLookup` — không cần bật lại gì cho field cũ.
4. Rollback: revert commit — dữ liệu Firestore không đổi ở bước nào nên rollback an toàn tuyệt đối.

## Open Questions

Đã chốt phần lõi qua 5 demo + trao đổi 29–30/09/2026. Sau khi dùng thật (30/09/2026, group "7.0. Xét duyệt báo giá") phát sinh 1 nhu cầu MỚI, NGOÀI phạm vi change này — chưa thiết kế/code:

- **Tự động điền field khác từ bản ghi đã khớp** — Sếp muốn: field "MST Nhà thầu phụ/ CCCD đội trưởng" tự điền theo giá trị `mst` của ĐÚNG bản ghi mà field "Tên nhà thầu phụ đề xuất" vừa khớp (không phải validate/gợi ý độc lập như hiện tại — đây là 1 field ĐỌC giá trị từ field KHÁC). Đã thử dùng `computedFrom`/`ComputedTemplateBranch` (cơ chế "tự động ghép giá trị" có sẵn, xem `components/request/modals/AddFieldModal.tsx`) nhưng KHÔNG hợp: `computedFrom` chỉ ghép CHUỖI từ giá trị các field đã có sẵn trong form, không có khái niệm "tra ngược 1 field trong bản ghi ngoài đã khớp ở field khác". Cần thiết kế riêng (khả năng: field B khai báo "lấy từ field A.display.mst khi A khớp"), đủ phức tạp để cần 1 change/demo mới, không làm chung với đợt này.
