import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getHpcoreDb } from "@/lib/hpcore";
import { apiErrorResponse } from "@/lib/http";
import { requireSession } from "@/lib/session";
import type { TaggedUser } from "@/lib/types";

/**
 * Danh bạ người dùng để gắn thẻ (usedFor/approvers/followers) đọc trực tiếp
 * từ Firestore của app tổng (collection `users`, đang hoạt động) — hpcore là
 * nguồn danh tính duy nhất, app này không tự nuôi danh sách người dùng.
 *
 * Cache 60 giây (thêm 21/08/2026, sau sự cố hết hạn mức Firestore project
 * trung tâm): mỗi lần 1 ô gắn thẻ người (TagUserInput) MỞ RA là gọi lại route
 * này, đọc TOÀN BỘ nhân viên đang hoạt động (N lượt đọc) — 1 trang có thể có
 * 2-3 ô như vậy, tải lại y hệt nhau. Không có field ngày giờ Firestore nào
 * trong TaggedUser nên an toàn cache trực tiếp (không dính lỗi Timestamp mất
 * method .toDate() như đã gặp ở HPCons-portal khi thêm cache tương tự).
 */
const getCachedDirectory = unstable_cache(
  async (): Promise<TaggedUser[]> => {
    const snap = await getHpcoreDb().collection("users").where("isActive", "==", true).get();
    return snap.docs.map((doc) => {
      const data = doc.data() as { fullName?: string; email?: string; username?: string | null };
      const name = data.fullName?.trim() || data.email?.split("@")[0] || doc.id;
      // Ưu tiên username ngắn kiểu "phucBM" (sinh ở hpcons-portal, 28/07/2026)
      // — người tạo trước khi có tính năng này fallback về email như cũ.
      return {
        id: doc.id,
        name,
        username: data.username || data.email?.split("@")[0] || doc.id,
        avatarInitial: name.charAt(0).toUpperCase(),
      };
    });
  },
  ["request-directory"],
  { revalidate: 60 },
);

export async function GET() {
  try {
    await requireSession();
    const directory = await getCachedDirectory();
    return NextResponse.json({ directory });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
