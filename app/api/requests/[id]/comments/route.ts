import { after, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { expandMentionsToUids } from "@/lib/server/mentions";
import { hpcoreCommentOnMine, hpcoreMentioned } from "@/lib/server/hpcore-notifications";
import { refreshNotificationFeedsForRequest } from "@/lib/server/notification-feed";
import { canView, loadRequest } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import type { RequestAttachment, RequestComment } from "@/lib/types";

// Ghi thông báo sang chuông chung HPcore chạy trong after() — cho đủ thời
// gian, xem lib/server/hpcore-notifications.ts.
export const maxDuration = 60;

interface CommentBody {
  text: string;
  mentionIds?: string[];
  /** Tối đa 1 file/bình luận, đã tải lên qua /api/uploads TRƯỚC khi gọi route
   * này (client gửi kèm {name, path, size} nhận được từ /api/uploads). */
  attachment?: RequestAttachment | null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const found = await loadRequest(id);
    if (!found) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    if (!canView(found, session.uid, session.role)) {
      return NextResponse.json(
        { error: "Bạn không có quyền bình luận trên đề xuất này." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as CommentBody;
    const text = body.text?.trim();
    if (!text) {
      return NextResponse.json({ error: "Nội dung thảo luận không được để trống." }, { status: 400 });
    }

    const existing = found.comments ?? [];
    // Tính năng "Trả lời" đã BỎ (24/08/2026) — không còn nhận `parentId` từ
    // client nữa, mọi bình luận mới đều ngang hàng. Xem design.md.
    const mentionIds = Array.isArray(body.mentionIds) ? body.mentionIds : [];
    const attachment =
      body.attachment && typeof body.attachment.path === "string" ? body.attachment : null;

    const comment: RequestComment = {
      id: crypto.randomUUID(),
      authorUid: session.uid,
      authorName: session.name,
      avatarInitial: session.name.trim().charAt(0).toUpperCase() || "?",
      text,
      at: new Date().toISOString(),
      mentionIds,
      attachment,
    };
    const comments = [...existing, comment];
    const nowIso = comment.at;

    // Bình luận mới CŨNG là 1 lần cập nhật đề xuất — trước đây route này
    // không bump `updatedAt`, khiến người theo dõi/được nhắc tên không bao
    // giờ thấy đề xuất "nổi" lên lại trên chuông thông báo dù có bình luận
    // mới (lỗ hổng phát hiện qua bản demo "Xem Trước Chuông Thông Báo" —
    // xem design.md của change fix-notification-bell-stale-gaps). Đồng thời
    // ghi luôn `viewedAt` của người bình luận — họ chắc chắn đang xem trang
    // lúc gửi bình luận, không cần chờ lần mở trang kế tiếp mới tính là "đã xem".
    // Nối bình luận bằng arrayUnion (06/10/2026) — trước đây ghi đè CẢ mảng
    // `comments` từ bản đọc lúc đầu, 2 người gửi cùng lúc có thể làm mất 1
    // bình luận. `viewedAt` ghi đúng 1 khoá của người bình luận (không đè khoá
    // người khác), `mentionedUids` cũng nối thêm.
    const patch: Record<string, unknown> = {
      comments: FieldValue.arrayUnion(comment),
      updatedAt: nowIso,
      [`viewedAt.${session.uid}`]: nowIso,
    };
    let expandedMentionUids: string[] = [];
    if (mentionIds.length > 0) {
      expandedMentionUids = await expandMentionsToUids(mentionIds, session.uid);
      if (expandedMentionUids.length > 0) patch.mentionedUids = FieldValue.arrayUnion(...expandedMentionUids);
    }

    await adminDb.collection("requests").doc(id).update(patch);
    after(() => refreshNotificationFeedsForRequest(id));
    // Chuông chung HPcore (Sếp chốt 07/10/2026) — trước đây route này không
    // gửi thông báo rời nào cả (chỉ có chuông riêng của Request-app tự tính
    // lại khi tải trang). Báo người tạo đề xuất (nếu không phải chính họ bình
    // luận) + những người bị nhắc tên trực tiếp trong bình luận này.
    after(async () => {
      try {
        await Promise.all([
          hpcoreCommentOnMine(found, session.uid, session.name, text),
          hpcoreMentioned(found, expandedMentionUids, session.name, text, { actorUid: session.uid }),
        ]);
      } catch (hpcoreError) {
        console.error("Ghi thông báo sang HPcore lúc bình luận thất bại (không ảnh hưởng thao tác chính):", hpcoreError);
      }
    });

    return NextResponse.json({ comments }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
