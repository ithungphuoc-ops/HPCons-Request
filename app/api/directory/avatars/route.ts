import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { getHpcoreDb } from "@/lib/hpcore";
import { requireSession } from "@/lib/session";

/**
 * Trả về ảnh đại diện THẬT (`users/{uid}.avatarUrl` từ Firestore app tổng
 * hpcons-portal — ảnh người dùng tự tải lên ở trang Tài khoản, lưu R2, URL
 * công khai) cho 1 danh sách uid — dùng cho danh sách đề xuất hiện ảnh người
 * gửi/người duyệt (change request-list-base-parity, Sếp yêu cầu 17/08/2026).
 *
 * `titles` (thêm 29/09/2026, Sếp yêu cầu thẻ hover kiểu Base.vn ở trang chi
 * tiết đề xuất): chức danh THẬT `users/{uid}.title` — field đã có sẵn, đang
 * hiển thị ở trang "Thành viên" (hpcons-portal), nhưng KHÔNG phải ai cũng đã
 * được HR nhập. Đọc cùng 1 lượt `getAll` với avatar, không tốn thêm lượt đọc
 * Firestore nào. Giữ tách khỏi `avatars` (không đổi shape cũ) để không phá
 * các nơi đang dùng `useDirectoryAvatars`/`useAvatarsByUids` (chỉ đọc `avatars`).
 *
 * GET /api/directory/avatars?uids=a,b,c (tối đa 100 uid/lần). uid không tồn
 * tại hoặc chưa có ảnh/chức danh → null (client tự rơi về vòng tròn chữ cái
 * đầu / ẩn dòng chức danh).
 */
export async function GET(request: Request) {
  try {
    await requireSession();

    const raw = new URL(request.url).searchParams.get("uids") ?? "";
    const uids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 100);
    if (uids.length === 0) {
      return NextResponse.json({ avatars: {}, titles: {} });
    }

    const db = getHpcoreDb();
    const refs = uids.map((uid) => db.collection("users").doc(uid));
    const snaps = await db.getAll(...refs);

    const avatars: Record<string, string | null> = {};
    const titles: Record<string, string | null> = {};
    for (const snap of snaps) {
      const data = snap.data();
      const url = (data?.avatarUrl as string | null | undefined) ?? null;
      avatars[snap.id] = url && url.trim() ? url : null;
      const title = (data?.title as string | null | undefined) ?? null;
      titles[snap.id] = title && title.trim() ? title.trim() : null;
    }
    return NextResponse.json({ avatars, titles });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
