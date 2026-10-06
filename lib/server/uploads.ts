import { randomBytes } from "node:crypto";

/**
 * Chặn 1 lỗ hổng bảo mật CodeRabbit phát hiện lúc review PR (23/08/2026):
 * `POST /api/requests/[id]/attachments` trước đây lưu thẳng
 * `body.attachment.path` từ client mà KHÔNG xác minh path đó có thật sự do
 * CHÍNH người gọi tải lên qua `/api/uploads` hay không — 1 người có quyền
 * sửa 1 đề xuất (chủ đề xuất/Owner/Admin) có thể gõ tay 1 path CỦA NGƯỜI
 * KHÁC (vd path đề xuất khác, hoặc path mẫu in
 * `print-templates/{groupId}/...`), khiến bất kỳ ai xem được đề xuất này
 * (qua `GET` cùng route) đều lấy được link tải file đó — dù không có quyền
 * xem file gốc. `/api/uploads` LUÔN sinh path dạng `requests/{uid}/...`
 * (xem `app/api/uploads/route.ts`) nên chỉ cần xác nhận path bắt đầu đúng
 * bằng `requests/{uid CỦA NGƯỜI ĐANG GỌI}/` là chặn được toàn bộ path
 * "vay mượn". Đặt ở `lib/server/` (không phải ngay trong route.ts) vì
 * Next.js chặn route.ts export thêm bất cứ gì ngoài GET/POST/config đã biết
 * — export thêm 1 hàm thường sẽ làm build type-check báo lỗi "Diff".
 */
export function isOwnUploadPath(path: string, uid: string): boolean {
  return path.startsWith(`requests/${uid}/`);
}

/**
 * Dựng path chuẩn cho 1 tệp người dùng tải lên — DÙNG CHUNG cho cả 2 đường
 * (multipart qua `/api/uploads` và link ký sẵn `/api/uploads/sign`) để
 * `isOwnUploadPath()` ở trên luôn đúng với mọi tệp, không lệ thuộc route nào
 * sinh ra nó.
 */
export function buildUploadPath(uid: string, fileName: string, nowMs: number = Date.now()): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  // Phần ngẫu nhiên [a-z0-9] ngay sau mốc ms (06/10/2026, review PR #80): 2
  // tệp cùng 1 lần ký, cùng ms, tên ngoài ASCII đều thành "_" (vd "Ảnh.jpg" và
  // "Ẩnh.jpg" → "_nh.jpg") từng ra TRÙNG path → tệp sau ghi đè tệp trước trên
  // R2. Dạng mới `{ms}-{8 ký tự}-{tên}` vẫn khớp mọi chỗ đang kiểm path (tiền
  // tố `requests/{uid}/`, regex `^\d+-[A-Za-z0-9._-]+$`); path cũ không có
  // phần này vẫn hợp lệ y nguyên.
  const unique = randomBytes(6).toString("hex").slice(0, 8);
  return `requests/${uid}/${nowMs}-${unique}-${safeName}`;
}
