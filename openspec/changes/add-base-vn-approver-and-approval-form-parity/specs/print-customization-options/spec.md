## ADDED Requirements

### Requirement: Cờ tuỳ chỉnh loại in cấp nhóm
`ProposalGroup` SHALL có `printOptions: GroupPrintOptions` — 7 cờ độc lập kiểm soát loại in nào được phép hiển thị cho người dùng ở trang chi tiết đề xuất (in đề xuất, in kèm thảo luận, in theo mẫu ra Word, ra PDF, kèm mã QR cho mẫu in/file đính kèm/trường tùy chỉnh dạng file). Nhóm chưa cấu hình `printOptions` SHALL coi như mọi cờ đều bật (giữ đúng hành vi hiện tại).

#### Scenario: Tắt 1 loại in ẩn đúng nút tương ứng
- **WHEN** người quản lý nhóm tắt cờ "In đề xuất và thảo luận"
- **THEN** trang chi tiết đề xuất thuộc nhóm đó không hiển thị lựa chọn in kèm thảo luận, các lựa chọn in khác vẫn hiển thị bình thường

### Requirement: Cờ xuất PDF chỉ lưu cấu hình cho tới khi có hạ tầng
Cờ `printOptions.allowPrintToPdf` SHALL lưu đúng trạng thái Có/Không, nhưng chức năng xuất PDF thật chỉ hoạt động sau khi năng lực xuất PDF (capability `pdf-export`, thuộc change riêng) hoàn tất.

#### Scenario: Bật cờ PDF trước khi pdf-export hoàn tất
- **WHEN** người quản lý nhóm bật `allowPrintToPdf` trong khi `pdf-export` chưa triển khai xong
- **THEN** cấu hình được lưu đúng; nút xuất PDF (nếu đã hiển thị) chưa tạo ra file PDF thật cho tới khi `pdf-export` hoàn tất

### Requirement: Cấu hình vị trí mã QR
Với mỗi loại in có mã QR (file trường tùy chỉnh, file đính kèm), `printOptions` SHALL lưu 1 cờ "vị trí QR tuỳ chọn" (Có/Không) và 1 giá trị vị trí — mặc định vị trí cố định khi cờ tắt.

#### Scenario: Vị trí QR cố định khi tắt tuỳ chọn
- **WHEN** "Cho phép in trường tùy chỉnh dạng file với vị trí mã QR tùy chọn" = Không
- **THEN** hệ thống dùng đúng 1 vị trí QR cấu hình sẵn cho mọi lần in, không cho chọn vị trí khác lúc in
