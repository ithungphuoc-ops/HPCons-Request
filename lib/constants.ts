// Nguồn duy nhất cho danh sách ứng dụng HP Cons — do app tổng (account.hpcore.vn)
// quản lý, các app con (pkd_crm, KhoUNICE, base-request-app...) đều gọi chung.
export const HPCORE_APPS_API = "https://account.hpcore.vn/api/apps";
export const HPCORE_PROFILE_URL = "https://account.hpcore.vn/profile";
export const HPCORE_DASHBOARD_URL = "https://account.hpcore.vn/dashboard";

// Khoá nhận diện "app đang dùng" trong danh sách ứng dụng — khớp domain thật
// của base-request-app (request.hpcore.vn), theo đúng pattern app.href.includes(...)
// đã dùng ở pkd_crm-next/KhoUNICE_Web.
export const CURRENT_APP_HOST = "request.hpcore.vn";

// Danh sách "Nhóm thành viên" (linh hoạt, cắt ngang phòng ban) do app tổng
// quản lý tại account.hpcore.vn/dashboard/member-groups — public, chỉ trả
// id + tên, dùng cho trường "Chọn bộ phận (tự động)".
export const HPCORE_MEMBER_GROUPS_API = "https://account.hpcore.vn/api/member-groups/public";

// Tên công ty đầy đủ — dùng cho thẻ ${company} trong mẫu in và các nơi hiển
// thị letterhead. Trước đây hardcode rời rạc ở nhiều trang, giờ gom về 1 nơi.
export const COMPANY_NAME = "CÔNG TY CỔ PHẦN XÂY DỰNG CÔNG NGHIỆP HƯNG PHƯỚC";

// Giới hạn kích thước 1 tệp tải lên qua /api/uploads — dùng chung với route
// thêm tài liệu đính kèm cấp đề xuất (validate lại size khi lưu, không tin
// nguyên giá trị client gửi) để 2 nơi không lệch số. KHÔNG đặt hằng số này
// ngay trong `app/api/uploads/route.ts` — Next.js chặn route.ts export thêm
// bất cứ gì ngoài GET/POST/config đã biết (build type-check báo lỗi "Diff").
export const MAX_UPLOAD_FILE_SIZE = 10 * 1024 * 1024; // 10MB
