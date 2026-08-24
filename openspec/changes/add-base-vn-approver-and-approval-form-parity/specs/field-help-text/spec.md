## ADDED Requirements

### Requirement: Giải thích trường dữ liệu luôn hiển thị
`ProposalField` SHALL có `helpText?: string` — 1 dòng chữ giải thích hiển thị LUÔN LUÔN cạnh/dưới ô nhập trên form Gửi đề xuất, KHÁC với `placeholder` (biến mất khi người dùng gõ vào ô).

#### Scenario: Giải thích hiển thị cùng lúc với ô nhập có giá trị
- **WHEN** field có `helpText` được điền giá trị bởi người gửi
- **THEN** dòng giải thích vẫn hiển thị nguyên vẹn cạnh/dưới ô nhập, không biến mất như placeholder

#### Scenario: Field không có giải thích hiển thị như hiện tại
- **WHEN** field không có `helpText` (field cũ trước khi có tính năng này)
- **THEN** form Gửi đề xuất hiển thị field đó như hành vi hiện tại, không có dòng giải thích nào thêm
