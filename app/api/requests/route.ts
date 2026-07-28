import { NextResponse } from "next/server";
import { canApproverAct } from "@/lib/approval-logic";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { canManageGroupsAtAppScope, isWithinUsedForScope } from "@/lib/permissions";
import { mergeFollowers } from "@/lib/server/conditions";
import { dedupeApprovers } from "@/lib/approval-logic";
import {
  buildInitialApprovers,
  canView,
  computeDeadline,
  findMissingRequiredFields,
  generateGroupRequestCode,
  generateRequestCode,
  resolveApproverSteps,
  toProposalGroup,
} from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import type {
  ApprovalFlowType,
  ProposalField,
  RequestInstance,
  TaggedUser,
} from "@/lib/types";

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const scope = new URL(request.url).searchParams.get("scope") ?? "mine";

    if (scope === "mine") {
      // Gồm cả nháp — "Đề xuất của tôi" hiển thị mọi đề xuất do người này tạo.
      // Sắp xếp ở code thay vì .orderBy() để không cần tạo composite index
      // Firestore cho where+orderBy khác field.
      const snap = await adminDb
        .collection("requests")
        .where("submittedBy.uid", "==", session.uid)
        .get();
      const requests = snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }) as RequestInstance)
        .filter((r) => !r.deletedAt)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      return NextResponse.json({ requests });
    }

    if (scope === "inbox") {
      // Không lọc được "còn tôi cần duyệt" bằng 1 Firestore query đơn giản
      // (approvers là mảng lồng) — lấy các đề xuất đang pending rồi lọc bằng
      // canApproverAct (đã có test, không viết lại). Sắp xếp ở code, lý do
      // như trên (tránh cần composite index).
      const snap = await adminDb
        .collection("requests")
        .where("status", "==", "pending")
        .get();
      const requests = snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }) as RequestInstance)
        .filter((r) => !r.deletedAt && canApproverAct(r.approvalFlow, r.approvers, session.uid))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      return NextResponse.json({ requests });
    }

    if (scope === "mentioned") {
      // Đề xuất có bình luận @mention session.uid (trực tiếp hoặc qua nhóm/
      // phòng ban, đã giãn sẵn vào mentionedUids lúc tạo bình luận — xem
      // lib/server/mentions.ts). Dùng cho NotificationBell, không có khái
      // niệm "đã đọc" riêng (giống 2 nguồn inbox/mine hiện có).
      const snap = await adminDb
        .collection("requests")
        .where("mentionedUids", "array-contains", session.uid)
        .get();
      const requests = snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }) as RequestInstance)
        .filter((r) => !r.deletedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return NextResponse.json({ requests });
    }

    // Ba scope dưới đây phục vụ màn hình danh sách+chi tiết kiểu Base
    // ("Gửi đến tôi"/"Đang theo dõi"/"Tất cả") — không lọc theo Firestore
    // được vì approversSnapshot/followers là mảng object lồng, nên lấy hết
    // rồi lọc bằng code (chấp nhận được với quy mô công ty hiện tại).
    if (scope === "sent-to-me" || scope === "following" || scope === "all") {
      const snap = await adminDb.collection("requests").get();
      const all = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as RequestInstance);

      const isMine = (r: RequestInstance) => r.submittedBy.uid === session.uid;
      const isSentToMe = (r: RequestInstance) =>
        r.status !== "draft" && r.approversSnapshot.some((a) => a.id === session.uid);
      const isFollowing = (r: RequestInstance) =>
        r.status !== "draft" && r.followers.some((f) => f.id === session.uid);

      const filterFn =
        scope === "sent-to-me"
          ? isSentToMe
          : scope === "following"
            ? isFollowing
            : (r: RequestInstance) => isMine(r) || isSentToMe(r) || isFollowing(r);

      const requests = all
        .filter((r) => !r.deletedAt && filterFn(r))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      return NextResponse.json({ requests });
    }

    // Toàn bộ đề xuất trong hệ thống (kể cả đã xóa mềm) — chỉ admin/owner,
    // phục vụ trang "Tất cả đề xuất hệ thống" (xem tổng quan + khôi phục).
    if (scope === "system") {
      if (!canManageGroupsAtAppScope(session.role)) {
        return NextResponse.json(
          { error: "Chỉ Owner hoặc Admin mới xem được toàn bộ đề xuất hệ thống." },
          { status: 403 },
        );
      }
      const snap = await adminDb.collection("requests").get();
      const requests = snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }) as RequestInstance)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      return NextResponse.json({ requests });
    }

    // Danh sách đề xuất của MỘT nhóm cụ thể (bấm tên nhóm ở sidebar) — vẫn
    // áp dụng đúng quy tắc canView, không lộ đề xuất người khác cho người
    // không liên quan (admin/owner thấy hết nhờ canView tự bao gồm role).
    if (scope === "group") {
      const groupId = new URL(request.url).searchParams.get("groupId");
      if (!groupId) {
        return NextResponse.json({ error: "Thiếu groupId." }, { status: 400 });
      }
      const snap = await adminDb.collection("requests").where("groupId", "==", groupId).get();
      const requests = snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }) as RequestInstance)
        .filter((r) => !r.deletedAt && canView(r, session.uid, session.role))
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      return NextResponse.json({ requests });
    }

    return NextResponse.json({ error: "scope không hợp lệ." }, { status: 400 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

interface SubmitBody {
  groupId: string | null;
  values?: Record<string, unknown>;
  isDraft?: boolean;
  // Chỉ dùng khi groupId null (Đề xuất trực tiếp) — xem design.md Decision 10.
  title?: string;
  description?: string;
  approvers?: TaggedUser[];
  followers?: TaggedUser[];
  // Lựa chọn thủ công quản lý trực tiếp cho bước "submitter_manager", theo
  // index của bước trong approverSteps — xem lib/server/requests.ts
  // resolveApproverSteps(). Server tự xác thực lại, không tin nguyên giá trị.
  managerOverrides?: Record<number, string>;
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as SubmitBody;
    const isDraft = body.isDraft === true;
    const now = new Date();
    const nowIso = now.toISOString();

    let groupNameSnapshot: string;
    let fieldsSnapshot: ProposalField[];
    let approvalFlow: ApprovalFlowType;
    let approversSnapshot: TaggedUser[];
    let followers: TaggedUser[];
    let deadlineAt: string | null;
    let useOwnCounter = false;

    if (body.groupId) {
      const groupSnap = await adminDb.collection("groups").doc(body.groupId).get();
      if (!groupSnap.exists) {
        return NextResponse.json(
          { error: "Không tìm thấy nhóm đề xuất." },
          { status: 404 },
        );
      }
      const group = toProposalGroup(groupSnap.id, groupSnap.data()!);

      if (!isWithinUsedForScope(group.usedFor, { userId: session.uid, groupIds: [] })) {
        return NextResponse.json(
          { error: "Bạn không nằm trong phạm vi sử dụng của nhóm đề xuất này." },
          { status: 403 },
        );
      }

      if (!isDraft && group.requiresSubmissionForm !== false) {
        const missing = findMissingRequiredFields(group.fields, body.values ?? {});
        if (missing.length > 0) {
          return NextResponse.json(
            {
              error: "Còn thiếu trường bắt buộc.",
              missingFields: missing.map((f) => ({ id: f.id, name: f.name })),
            },
            { status: 400 },
          );
        }
      }

      groupNameSnapshot = group.name;
      fieldsSnapshot = group.fields;
      approvalFlow = group.approvalFlow;
      // Nháp chưa cần xác định người duyệt thật (có thể chưa có phòng ban lúc
      // soạn nháp) — chỉ phân giải (và có thể chặn nếu thiếu trưởng đơn vị)
      // khi gửi chính thức.
      // dedupeApprovers: nếu cùng 1 người được nhiều bước duyệt chọn (vd
      // trùng "Quản lý trực tiếp" và "Trưởng phòng"), chỉ tính 1 lần theo
      // vai trò xuất hiện sau cùng — xem lib/approval-logic.ts.
      approversSnapshot = isDraft
        ? []
        : dedupeApprovers(
            await resolveApproverSteps(
              group.approverSteps,
              session.uid,
              body.values ?? {},
              group.fields,
              body.managerOverrides ?? {},
            ),
          );
      // Người gửi có thể thêm người theo dõi ngoài danh sách mặc định của
      // nhóm (giống UI Base) — client luôn khởi tạo từ group.followers rồi
      // cho thêm, nên body.followers là danh sách đã gồm mặc định. Hợp nhất
      // thêm người theo dõi theo điều kiện thoả mãn (nháp thì values rỗng
      // nên chưa thoả điều kiện nào, hợp lý vì nháp có thể còn thiếu field).
      followers = mergeFollowers(
        group.followers,
        body.followers ?? group.followers,
        group.followersConditional ?? [],
        body.values ?? {},
        group.fields,
      );
      deadlineAt = isDraft
        ? null
        : computeDeadline(group.slaHours, now, group.slaByWorkCalendar === true);
      useOwnCounter = group.useOwnCounter === true;
    } else {
      // Đề xuất trực tiếp: không có mẫu, người tạo tự chọn người duyệt.
      const title = body.title?.trim();
      if (!isDraft) {
        if (!title) {
          return NextResponse.json({ error: "Thiếu tên đề xuất." }, { status: 400 });
        }
        if (!body.approvers || body.approvers.length === 0) {
          return NextResponse.json(
            { error: "Cần ít nhất một người xét duyệt." },
            { status: 400 },
          );
        }
      }
      groupNameSnapshot = title || "Đề xuất trực tiếp (chưa đặt tên)";
      fieldsSnapshot = [];
      approvalFlow = "concurrent";
      approversSnapshot = body.approvers ?? [];
      followers = body.followers ?? [];
      deadlineAt = null;
    }

    const values = { ...(body.values ?? {}) };
    if (!body.groupId && body.description) values.description = body.description;

    const code = isDraft
      ? null
      : useOwnCounter && body.groupId
        ? await generateGroupRequestCode(body.groupId)
        : await generateRequestCode();

    const requestRef = adminDb.collection("requests").doc();
    const newRequest: Omit<RequestInstance, "id"> = {
      code,
      groupId: body.groupId ?? null,
      groupNameSnapshot,
      fieldsSnapshot,
      values,
      submittedBy: { uid: session.uid, email: session.email, name: session.name },
      submittedAt: nowIso,
      updatedAt: nowIso,
      approvalFlow,
      approversSnapshot,
      approvers: isDraft ? [] : buildInitialApprovers(approversSnapshot),
      followers,
      status: isDraft ? "draft" : "pending",
      deadlineAt,
      history: [
        { at: nowIso, actor: session.name, action: isDraft ? "Đã lưu nháp" : "Đã gửi đề xuất" },
      ],
      comments: [],
      deletedAt: null,
    };
    await requestRef.set(newRequest);

    const created: RequestInstance = { id: requestRef.id, ...newRequest };
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
