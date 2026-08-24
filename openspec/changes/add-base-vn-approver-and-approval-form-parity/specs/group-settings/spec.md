## ADDED Requirements

### Requirement: Người tạo nhóm đề xuất
`ProposalGroup` SHALL có `createdBy: { uid: string; name: string }` ghi lại người tạo nhóm, đặt 1 lần lúc tạo (không đổi khi sửa nhóm sau đó). Trang cài đặt chung SHALL hiển thị "Tạo bởi" kèm tên người tạo.

#### Scenario: Hiển thị người tạo nhóm mới
- **WHEN** 1 người tạo nhóm đề xuất mới
- **THEN** `createdBy` được ghi đúng uid/tên người đó, trang cài đặt chung hiển thị "Tạo bởi: {tên}"

#### Scenario: Nhóm cũ chưa có createdBy hiển thị rõ là chưa xác định
- **WHEN** đọc 1 nhóm được tạo trước khi có tính năng này (`createdBy` không tồn tại)
- **THEN** trang cài đặt chung hiển thị "Tạo bởi: —" (không suy đoán/gán nhầm người tạo)
