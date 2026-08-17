## 1. API avatar

- [x] 1.1 `app/api/directory/avatars/route.ts` (mới): GET `?uids=a,b,c` (tối đa 100), requireSession, đọc batch `getAll` từ hpcore `users`, trả `{ avatars: { [uid]: string | null } }`

## 2. Trang danh sách

- [x] 2.1 Component `Avatar` nhỏ trong list/page.tsx: ảnh thật (object-cover, rounded-full) + onError/không có URL → vòng tròn chữ cái đầu (giữ đúng màu hiện tại)
- [x] 2.2 Fetch map avatar 1 lần mỗi khi danh sách đổi (gom uid người gửi + người duyệt, cache Map trong phiên)
- [x] 2.3 Chuỗi thông tin phụ: tên nhóm + tối đa 3 field nổi bật có giá trị ("Tên field: giá trị") theo Decision 2
- [x] 2.4 Cụm avatar người duyệt chồng nhau (24px, tối đa 3 + "+N") + chấm quyết định (✓ xanh/✕ đỏ/chờ xám), ẩn dưới md
- [x] 2.5 Ngày đề nghị định dạng dd/mm/yyyy bên phải; giữ nguyên hiệu ứng hover/active vừa làm

## 3. Kiểm tra

- [x] 3.1 `npx tsc --noEmit` sạch, `npx next build` sạch
- [x] 3.2 `openspec validate request-list-base-parity --strict` pass
- [ ] 3.3 Deploy + Sếp xác nhận trên UI thật (ảnh thật hiện đúng, người chưa có ảnh vẫn ra chữ cái)
