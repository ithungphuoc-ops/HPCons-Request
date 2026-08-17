import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { dedupeApprovers } from "@/lib/approval-logic";
import { mergeFollowers } from "@/lib/server/conditions";
import { resolveComputedValue } from "@/lib/server/computed-fields";
import { canManageGroupsAtAppScope } from "@/lib/permissions";
import {
  buildInitialApprovers,
  canView,
  computeDeadline,
  findMissingRequiredFields,
  generateGroupRequestCode,
  generateRequestCode,
  loadRequest,
  resolveApproverSteps,
  toProposalGroup,
} from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import type { RequestInstance, TaggedUser } from "@/lib/types";

export async function GET(
  _request: Request,
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
        { error: "Bạn không có quyền xem đề xuất này." },
        { status: 403 },
      );
    }
    return NextResponse.json({ request: found });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

interface UpdateDraftBody {
  values?: Record<string, unknown>;
  title?: string;
  description?: string;
  approvers?: TaggedUser[];
  followers?: TaggedUser[];
  /** true (mặc định) = vẫn lưu nháp; false = gửi chính thức, chuyển sang "pending". */
  isDraft?: boolean;
  // Xem app/api/requests/route.ts SubmitBody.managerOverrides.
  managerOverrides?: Record<number, string | string[]>;
}

export async function PATCH(
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
    // "pending" (15/08/2026, Sếp chốt): cho sửa cả khi đang chờ duyệt, không
    // chỉ nháp/bị trả lại — nhưng KHÔNG có khái niệm "lưu nháp" nữa ở trạng
    // thái này (chỉ có "sửa & gửi lại", luôn reset duyệt — xem nhánh dưới).
    const isOwnEditable =
      found.status === "draft" || found.status === "returned" || found.status === "pending";
    if (!isOwnEditable || found.submittedBy.uid !== session.uid) {
      return NextResponse.json(
        { error: "Chỉ chủ đề xuất mới sửa được nháp, đề xuất bị trả lại, hoặc đề xuất đang chờ duyệt của chính mình." },
        { status: 403 },
      );
    }
    const body = (await request.json()) as UpdateDraftBody;
    const isEditingPending = found.status === "pending";
    if (isEditingPending && body.isDraft !== false) {
      return NextResponse.json(
        { error: "Đề xuất đang chờ duyệt — sửa xong phải gửi lại (không lưu nháp được ở trạng thái này)." },
        { status: 400 },
      );
    }
    const wantsSubmit = body.isDraft === false;

    const values = body.values !== undefined ? { ...body.values } : found.values;
    let groupNameSnapshot = found.groupNameSnapshot;
    let approversSnapshot = found.approversSnapshot;
    const followers = body.followers ?? found.followers;

    if (found.groupId === null) {
      if (body.title !== undefined) groupNameSnapshot = body.title.trim() || groupNameSnapshot;
      if (body.description !== undefined) values.description = body.description;
      if (body.approvers !== undefined) approversSnapshot = body.approvers;
    }

    if (!wantsSubmit) {
      const updatedAt = new Date().toISOString();
      const ref = adminDb.collection("requests").doc(id);
      await ref.update({ values, groupNameSnapshot, approversSnapshot, followers, updatedAt });
      const updated: RequestInstance = {
        ...found,
        values,
        groupNameSnapshot,
        approversSnapshot,
        followers,
        updatedAt,
      };
      return NextResponse.json({ request: updated });
    }

    // Gửi chính thức: khởi tạo approvers/deadlineAt tại THỜI ĐIỂM GỬI NÀY,
    // không phải thời điểm tạo nháp trước đó.
    if (found.groupId) {
      const groupSnap = await adminDb.collection("groups").doc(found.groupId).get();
      if (!groupSnap.exists) {
        return NextResponse.json(
          { error: "Nhóm đề xuất gốc không còn tồn tại." },
          { status: 404 },
        );
      }
      const group = toProposalGroup(groupSnap.id, groupSnap.data()!);
      // Máy chủ tự tính lại giá trị field "tự tính" ngay khi gửi/gửi lại
      // chính thức — không tin giá trị client gửi lên (xem app/api/requests/route.ts).
      for (const field of group.fields) {
        if (!field.computedFrom) continue;
        const computed = resolveComputedValue(field.computedFrom, values, group.fields);
        if (computed !== null) values[field.id] = computed;
      }
      const missing =
        group.requiresSubmissionForm === false ? [] : findMissingRequiredFields(group.fields, values);
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: "Còn thiếu trường bắt buộc.",
            missingFields: missing.map((f) => ({ id: f.id, name: f.name })),
          },
          { status: 400 },
        );
      }
      // dedupeApprovers: người trùng nhiều bước duyệt chỉ tính 1 lần theo
      // vai trò xuất hiện sau cùng — xem lib/approval-logic.ts.
      approversSnapshot = dedupeApprovers(
        await resolveApproverSteps(
          group.approverSteps,
          session.uid,
          values,
          group.fields,
          body.managerOverrides ?? {},
        ),
      );
      const deadlineAt = computeDeadline(group.slaHours, new Date(), group.slaByWorkCalendar === true);
      const nowIso = new Date().toISOString();
      const code =
        found.code ??
        (group.useOwnCounter === true
          ? await generateGroupRequestCode(group.id)
          : await generateRequestCode());
      const ref = adminDb.collection("requests").doc(id);
      const patch = {
        code,
        values,
        groupNameSnapshot: group.name,
        fieldsSnapshot: group.fields,
        approvalFlow: group.approvalFlow,
        approversSnapshot,
        approvers: buildInitialApprovers(approversSnapshot),
        // Giữ đúng người theo dõi người gửi đã chỉnh (mặc định + thêm tay),
        // không ghi đè về danh sách mặc định của nhóm khi gửi chính thức từ
        // nháp — nhất quán với nhánh "chỉ lưu nháp" ở trên (dòng `followers`).
        // Hợp nhất thêm người theo dõi theo điều kiện thoả mãn tại thời điểm
        // gửi chính thức này (values đã đủ vì đã qua kiểm tra thiếu trường ở trên).
        followers: mergeFollowers(group.followers, followers, group.followersConditional ?? [], values, group.fields),
        status: "pending" as const,
        deadlineAt,
        updatedAt: nowIso,
        history: [
          ...found.history,
          {
            at: nowIso,
            actor: session.name,
            action: isEditingPending
              ? "Đã chỉnh sửa đề xuất — duyệt lại từ đầu"
              : found.status === "returned"
                ? "Đã gửi lại đề xuất"
                : "Đã gửi đề xuất",
          },
        ],
      };
      await ref.update(patch);
      return NextResponse.json({ request: { ...found, ...patch } });
    }

    // Đề xuất trực tiếp.
    if (!groupNameSnapshot.trim()) {
      return NextResponse.json({ error: "Thiếu tên đề xuất." }, { status: 400 });
    }
    if (approversSnapshot.length === 0) {
      return NextResponse.json(
        { error: "Cần ít nhất một người xét duyệt." },
        { status: 400 },
      );
    }
    const nowIso = new Date().toISOString();
    const code = found.code ?? (await generateRequestCode());
    const ref = adminDb.collection("requests").doc(id);
    const patch = {
      code,
      values,
      groupNameSnapshot,
      approversSnapshot,
      approvers: buildInitialApprovers(approversSnapshot),
      followers,
      status: "pending" as const,
      deadlineAt: null,
      updatedAt: nowIso,
      history: [
        ...found.history,
        {
          at: nowIso,
          actor: session.name,
          action: found.status === "returned" ? "Đã gửi lại đề xuất" : "Đã gửi đề xuất",
        },
      ],
    };
    await ref.update(patch);
    return NextResponse.json({ request: { ...found, ...patch } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Xóa mềm — chủ đề xuất hoặc owner/admin app đều xóa được, dữ liệu vẫn giữ
 * nguyên trong Firestore để khôi phục qua /api/requests/[id]/restore. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const found = await loadRequest(id);
    if (!found) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    const isOwner = found.submittedBy.uid === session.uid;
    if (!isOwner && !canManageGroupsAtAppScope(session.role)) {
      return NextResponse.json(
        { error: "Chỉ chủ đề xuất hoặc Owner/Admin mới xóa được." },
        { status: 403 },
      );
    }
    if (found.deletedAt) {
      return NextResponse.json({ request: found });
    }

    const nowIso = new Date().toISOString();
    const history = [
      ...found.history,
      { at: nowIso, actor: session.name, action: "Đã xóa đề xuất" },
    ];
    await adminDb.collection("requests").doc(id).update({ deletedAt: nowIso, history });
    return NextResponse.json({ request: { ...found, deletedAt: nowIso, history } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
