## Context

Luật chung theo hợp đồng dữ liệu 03/10/2026 (đồng bộ mọi app). App Đề xuất đọc Firestore App Tổng qua `getHpcoreDb()`.

## Goals / Non-Goals

**Goals:** áp đúng luật chung cho bước `submitter_manager`, preview, picker và thông báo bị qua mặt.

**Non-Goals:** không ghi dữ liệu App Tổng; không dùng `secondaryDepartmentIds` (không đổi người duyệt); không tính lại đề xuất đã gửi; không đổi nguồn memberGroups của picker.

## Decisions

1. **Hàm thuần nhận nguồn dữ liệu** (`getUser`/`getDepartment`) → test bằng dữ liệu giả; bản Firestore tạo nguồn mới mỗi lượt gọi với bộ nhớ đệm trong lượt (không dùng chung giữa người dùng).
2. **Vòng lặp parentId**: giới hạn cứng 10 bậc theo hợp đồng.
3. **Điền sẵn mặc định ở client**: dùng `step.user` của preview (máy chủ resolve), gửi lên như lựa chọn tay → máy chủ vẫn xác thực lại uid. Không resolve được thì ô trống, bắt chọn tay như cũ.
4. **Picker**: thêm truy vấn `directManagerIds` của người đang đăng nhập, cache `unstable_cache` 60s với `uid` là đối số (khoá cache theo uid).

## Risks / Trade-offs

- Đổi hồ sơ App Tổng mất tới 60s mới lên đầu picker (cache). Chấp nhận.
- Điền sẵn mặc định thay hành vi cũ "ô luôn trống như Base.vn" — theo yêu cầu đã duyệt.
