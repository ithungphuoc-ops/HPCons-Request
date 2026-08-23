import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { canView, loadRequest } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import type { GroupPermissionRules, RequestComment, RequestInstance } from "@/lib/types";

/** Hạn sửa/xóa của tác giả — 10 phút kể từ lúc đăng (`comment.at`), tính theo
 * đồng hồ SERVER (không tin đồng hồ máy khách). KHÔNG làm mới lại theo
 * `editedAt` — sửa ở phút thứ 9 vẫn chỉ còn ~1 phút, không được +10 phút mới.
 * Xem design.md của change add-comment-mentions-realtime, Decision #7. */
const AUTHOR_EDIT_WINDOW_MS = 10 * 60 * 1000;

function isWithinAuthorWindow(comment: RequestComment): boolean {
  return Date.now() - new Date(comment.at).getTime() <= AUTHOR_EDIT_WINDOW_MS;
}

/** `permissionRules.lockCommentsAfterFirstDecision` — khi bật VÀ đề xuất đã
 * có ≥1 người duyệt ra quyết định (không còn "pending"), khoá HẲN sửa/xoá
 * bình luận cho MỌI người (kể cả tác giả trong 10 phút đầu, kể cả Owner) —
 * đè lên mọi quyền khác ở dưới. Xem design.md của change
 * add-base-vn-approver-and-approval-form-parity, tasks.md 5.3. */
async function isCommentsLockedByGroupRule(found: RequestInstance): Promise<boolean> {
  if (!found.groupId) return false;
  const hasDecision = found.approvers.some((a) => a.decision !== "pending");
  if (!hasDecision) return false;
  const groupSnap = await adminDb.collection("groups").doc(found.groupId).get();
  const permissionRules = (groupSnap.data() as { permissionRules?: GroupPermissionRules } | undefined)
    ?.permissionRules;
  return Boolean(permissionRules?.lockCommentsAfterFirstDecision);
}

interface EditBody {
  text: string;
}

/** Sửa nội dung 1 bình luận — CHỈ tác giả, CHỈ trong 10 phút kể từ lúc đăng.
 * Owner KHÔNG có quyền sửa hộ nội dung bình luận người khác (chỉ có quyền
 * xóa sau khi khóa — xem DELETE dưới). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  try {
    const session = await requireSession();
    const { id, commentId } = await params;
    const found = await loadRequest(id);
    if (!found) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    if (!canView(found, session.uid, session.role)) {
      return NextResponse.json({ error: "Bạn không có quyền trên đề xuất này." }, { status: 403 });
    }

    const comments = found.comments ?? [];
    const target = comments.find((c) => c.id === commentId);
    if (!target) {
      return NextResponse.json({ error: "Không tìm thấy bình luận." }, { status: 404 });
    }
    if (await isCommentsLockedByGroupRule(found)) {
      return NextResponse.json(
        { error: "Nhóm này khoá sửa/xoá bình luận sau khi đề xuất đã có người duyệt xử lý." },
        { status: 403 },
      );
    }
    if (target.authorUid !== session.uid) {
      return NextResponse.json({ error: "Chỉ tác giả mới sửa được bình luận này." }, { status: 403 });
    }
    if (!isWithinAuthorWindow(target)) {
      return NextResponse.json(
        { error: "Đã quá 10 phút kể từ lúc đăng — không thể sửa bình luận này nữa." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as EditBody;
    const text = body.text?.trim();
    if (!text) {
      return NextResponse.json({ error: "Nội dung không được để trống." }, { status: 400 });
    }

    const updated: RequestComment[] = comments.map((c) =>
      c.id === commentId ? { ...c, text, editedAt: new Date().toISOString() } : c,
    );
    await adminDb.collection("requests").doc(id).update({ comments: updated });

    return NextResponse.json({ comments: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Xóa 1 bình luận — trong 10 phút đầu CHỈ tác giả; sau đó CHỈ Owner
 * (`session.role === "owner"`, KHÔNG dùng `canManageGroupsAtAppScope` vì hàm
 * đó gộp cả "admin" — Owner thu hẹp hơn "Admin/Owner" cũ theo yêu cầu mới của
 * Sếp 24/08/2026, xem design.md Decision #7). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  try {
    const session = await requireSession();
    const { id, commentId } = await params;
    const found = await loadRequest(id);
    if (!found) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    if (!canView(found, session.uid, session.role)) {
      return NextResponse.json({ error: "Bạn không có quyền trên đề xuất này." }, { status: 403 });
    }

    const comments = found.comments ?? [];
    const target = comments.find((c) => c.id === commentId);
    if (!target) {
      return NextResponse.json({ error: "Không tìm thấy bình luận." }, { status: 404 });
    }
    if (await isCommentsLockedByGroupRule(found)) {
      return NextResponse.json(
        { error: "Nhóm này khoá sửa/xoá bình luận sau khi đề xuất đã có người duyệt xử lý." },
        { status: 403 },
      );
    }

    const isAuthor = target.authorUid === session.uid;
    const withinWindow = isWithinAuthorWindow(target);
    const isOwner = session.role === "owner";

    const allowed = withinWindow ? isAuthor : isOwner;
    if (!allowed) {
      const message = withinWindow
        ? "Chỉ tác giả mới xóa được bình luận này trong 10 phút đầu."
        : "Đã quá 10 phút — chỉ Owner mới xóa được bình luận này.";
      return NextResponse.json({ error: message }, { status: 403 });
    }

    const updated = comments.filter((c) => c.id !== commentId);
    await adminDb.collection("requests").doc(id).update({ comments: updated });

    return NextResponse.json({ comments: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
