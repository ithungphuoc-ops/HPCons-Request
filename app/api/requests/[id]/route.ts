import { after, NextResponse } from "next/server";
import { isUserInGroupScope, OUT_OF_SCOPE_MESSAGE } from "@/lib/server/hpcore-org";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { guiCacViec, quetViecToiHan, taoViecDongBo } from "@/lib/dong-bo/hang-cho";
import { apiErrorResponse } from "@/lib/http";
import { dedupeApproversWithMeta } from "@/lib/approval-logic";
import { mergeFollowers } from "@/lib/server/conditions";
import { resolveComputedValue } from "@/lib/server/computed-fields";
import { canManageGroupsAtAppScope } from "@/lib/permissions";
import { canAdjustAfterApproval, loadAdjustmentGroupSettings } from "@/lib/server/adjustment-approval-rules";
import { refreshNotificationFeedsForRequest } from "@/lib/server/notification-feed";
import { notifyFollowersSubmitted, notifyPendingApprovers } from "@/lib/server/notification-emails";
import { hpcoreFollowersSubmitted, hpcorePendingApprovers } from "@/lib/server/hpcore-notifications";
import {
  buildInitialApprovers,
  canView,
  computeDeadline,
  findBlockedDateLeadTimeFields,
  findInvalidExternalCodeFields,
  findInvalidTableRows,
  findLockedExternalCodeFields,
  findMissingRequiredFields,
  generateGroupRequestCode,
  generateRequestCode,
  loadRequest,
  resolveApproverStepsWithMeta,
  resolveInitialSlaHours,
  toProposalGroup,
} from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import { checkEditGuard, parseExpectedVersion, REQUEST_CHANGED_MESSAGE, RequestTxError } from "@/lib/server/request-write-guard";
import { requestVersionKey } from "@/lib/request-version";
import type { RequestHistoryEntry, RequestInstance, TaggedUser } from "@/lib/types";
import { retryQlkCtrSyncNeuLoi } from "@/lib/qlkctr-sync";
import { retryThuMuaSyncNeuLoi } from "@/lib/thumua-sync";
import { dateLeadTimeBlockedMessage, resolveDateLeadTimeNumbers } from "@/lib/date-lead-time";

// Hàng chờ đồng bộ chạy trong after() của GET/DELETE — cho đủ thời gian gửi (gói miễn phí tối đa 60 giây).
export const maxDuration = 60;

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
    // Bắn rồi quên — không đợi kết quả, không làm chậm màn hình. Xem lib/thumua-sync.ts.
    void retryThuMuaSyncNeuLoi(found);
    /* ★ Thêm 18/09/2026: đường sang QLK CTR nay cũng tự thử lại. Trước đó nó là đường DUY NHẤT
       không có cơ chế này — bốn đề xuất công trình đã mất tích ở kho vì vậy (000000096 ·
       000000098 · 000000100 · 000000104). Xem lib/qlkctr-sync.ts. */
    void retryQlkCtrSyncNeuLoi(found);
    /* ★ 03/10/2026 — hàng chờ đồng bộ: có người mở đề xuất thì máy chủ tranh thủ gửi các việc đã tới
       hạn (của MỌI đề xuất, tối đa 1 lần/phút). Xem lib/dong-bo/hang-cho.ts. */
    after(() => quetViecToiHan());
    // Người xem có được bấm "Điều chỉnh" không — chỉ đọc nhóm khi THẬT SỰ cần
    // (đề xuất đã duyệt, người xem là người gửi/người theo dõi). Field phái
    // sinh theo người xem, KHÔNG lưu Firestore. Từ 06/10/2026 mọi điều chỉnh
    // đều "gated" (chờ 2 người duyệt do người điều chỉnh chọn).
    let viewerAdjustmentAccess: "gated" | "none" = "none";
    if (found.status === "approved") {
      const isSubmitter = found.submittedBy.uid === session.uid;
      const isFollower = found.followers.some((f) => f.id === session.uid);
      if (isSubmitter) {
        viewerAdjustmentAccess = canAdjustAfterApproval(found, session.uid, null) ? "gated" : "none";
      } else if (isFollower) {
        const settings = await loadAdjustmentGroupSettings(found.groupId);
        viewerAdjustmentAccess = canAdjustAfterApproval(found, session.uid, settings.adjustmentApprovalRules)
          ? "gated"
          : "none";
      }
    }
    return NextResponse.json({ request: found, viewerAdjustmentAccess });
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
  /** requestVersionKey() của đề xuất lúc MỞ form sửa (lib/request-version.ts) —
   * khác bản hiện tại → 409, không ghi đè. Tab cũ không gửi thì bỏ qua. */
  expectedVersion?: unknown;
}

/**
 * Ghi PATCH sửa/gửi lại trong transaction (06/10/2026, Sếp chốt): tx.get bản
 * MỚI NHẤT → checkEditGuard (đã xoá / phiên bản khác bản đọc lúc đầu / khác
 * `expectedVersion` client gửi) → 409, KHÔNG ghi đè, giữ nguyên lượt duyệt.
 * Không đổi thì tx.update `patch` (tính TRƯỚC tx từ dữ liệu không đổi — vì
 * phiên bản giống hệt nên approvers/status vẫn đúng) và NỐI dòng lịch sử bằng
 * arrayUnion (không ghi đè mảng — giữ dòng "Đã đồng bộ…"/khác ghi xen giữa).
 * Trả đề xuất sau khi ghi, dựng trên bản mới nhất.
 */
async function commitEdit(
  id: string,
  found: RequestInstance,
  expectedVersion: string | undefined,
  patch: Partial<RequestInstance>,
  historyEntry?: RequestHistoryEntry,
): Promise<RequestInstance> {
  const ref = adminDb.collection("requests").doc(id);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new RequestTxError(404, "Không tìm thấy đề xuất.");
    const latest = { id: snap.id, ...snap.data() } as RequestInstance;
    const blocked = checkEditGuard(found, latest, expectedVersion);
    if (blocked) throw new RequestTxError(blocked.status, blocked.error);
    tx.update(ref, historyEntry ? { ...patch, history: FieldValue.arrayUnion(historyEntry) } : patch);
    return {
      ...latest,
      ...patch,
      history: historyEntry ? [...(latest.history ?? []), historyEntry] : latest.history,
    };
  });
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
    // 🔴 CHỐT CHẶN "ĐỀ XUẤT MA" (agent review bắt được 14/09/2026):
    // `loadRequest` KHÔNG lọc `deletedAt`, nên trước đây một bản nháp đã xoá
    // vẫn PATCH được. Kịch bản thật: xoá nháp xong bấm Back về đúng URL cũ còn
    // trong lịch sử trình duyệt → form nạp lại bình thường (status vẫn
    // "draft") → bấm "Gửi đề xuất" → doc thành status "pending" NHƯNG
    // `deletedAt` vẫn còn. Mọi scope ở app/api/requests/route.ts đều
    // `.filter(r => !r.deletedAt)`, nên KHÔNG AI nhìn thấy đề xuất đó — kể cả
    // người duyệt — trong khi người gửi đinh ninh là đã gửi rồi.
    if (found.deletedAt) {
      return NextResponse.json(
        { error: "Đề xuất này đã bị xoá — không sửa hay gửi lại được. Liên hệ Owner/Admin nếu cần khôi phục." },
        { status: 409 },
      );
    }
    const body = (await request.json()) as UpdateDraftBody;
    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    // Đang mở form sửa mà đề xuất đã đổi (người duyệt vừa duyệt / trả lại /
    // chuyển tiếp…) → báo tải lại, KHÔNG ghi đè (Sếp chốt 06/10/2026). Kiểm sớm
    // ở đây (trước cả luật trạng thái) để người gửi nhận đúng thông báo thay vì
    // "không có quyền"; transaction bên dưới kiểm lại trên bản mới nhất.
    if (
      found.submittedBy.uid === session.uid &&
      expectedVersion !== undefined &&
      expectedVersion !== requestVersionKey(found)
    ) {
      return NextResponse.json({ error: REQUEST_CHANGED_MESSAGE }, { status: 409 });
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
      const updated = await commitEdit(id, found, expectedVersion, {
        values,
        groupNameSnapshot,
        approversSnapshot,
        followers,
        updatedAt,
      });
      // Lưu (không gửi) khi đề xuất ĐÃ gửi (vd bị trả lại) vẫn đổi được người theo dõi /
      // tên / người duyệt — những thứ chuông của người khác đang hiện. Nháp thật thì chưa
      // ai thấy, khỏi tính.
      if (found.status !== "draft") after(() => refreshNotificationFeedsForRequest(id));
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
      // Phạm vi sử dụng — chặn khi gửi CHÍNH THỨC LẦN ĐẦU từ nháp (nháp tạo
      // trước khi loại đề xuất bị thu hẹp phạm vi, hoặc nháp nhân bản). Đề
      // xuất bị trả lại / đang chờ duyệt đã gửi rồi nên KHÔNG chặn gửi lại.
      if (found.status === "draft" && !(await isUserInGroupScope(group, session.uid))) {
        return NextResponse.json({ error: OUT_OF_SCOPE_MESSAGE }, { status: 403 });
      }
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

      if (group.requiresSubmissionForm !== false) {
        const invalidRows = findInvalidTableRows(group.fields, values);
        if (invalidRows.length > 0) {
          return NextResponse.json(
            { error: invalidRows.map((i) => i.message).join(" ") },
            { status: 400 },
          );
        }
      }

      // Luật "ngày cần cấp" (dateLeadTimeRule) — cùng chặn ở gửi từ nháp,
      // xem app/api/requests/route.ts (tạo mới) cho lý do đầy đủ.
      const blockedDates = findBlockedDateLeadTimeFields(group.fields, values);
      if (blockedDates.length > 0) {
        return NextResponse.json(
          {
            error: dateLeadTimeBlockedMessage(
              resolveDateLeadTimeNumbers(blockedDates[0].dateLeadTimeRule).blockDays,
            ),
            blockedFields: blockedDates.map((f) => ({ id: f.id, name: f.name })),
          },
          { status: 400 },
        );
      }

      // Ràng buộc Số Hợp Đồng CĐT — cùng chặn ở gửi từ nháp, xem
      // app/api/requests/route.ts (tạo mới) cho lý do đầy đủ.
      const invalidCodes = await findInvalidExternalCodeFields(group.fields, values);
      if (invalidCodes.length > 0) {
        return NextResponse.json(
          {
            error: `Chưa đúng số hợp đồng nào trong hệ thống Công nợ: ${invalidCodes.map((f) => f.name).join(", ")}.`,
            invalidFields: invalidCodes.map((f) => ({ id: f.id, name: f.name })),
          },
          { status: 400 },
        );
      }
      // ★ (06/10/2026, "khóa công trình lan truyền") Mã khớp đúng nhưng Công nợ đã khóa.
      const lockedCodes = await findLockedExternalCodeFields(group.fields, values);
      if (lockedCodes.length > 0) {
        return NextResponse.json(
          {
            error: `Mã hợp đồng đã bị khóa, không thể dùng để tạo đề nghị mới: ${lockedCodes.map((f) => f.name).join(", ")}.`,
            invalidFields: lockedCodes.map((f) => ({ id: f.id, name: f.name })),
          },
          { status: 400 },
        );
      }
      // dedupeApproversWithMeta: người trùng nhiều bước duyệt chỉ tính 1 lần
      // theo vai trò xuất hiện sau cùng — xem lib/approval-logic.ts. Giữ kèm
      // `approverStepMeta` (tên bước/SLA riêng) cùng thứ tự để hiển thị ở
      // trang chi tiết đề xuất.
      const resolvedApprovers = await resolveApproverStepsWithMeta(
        group.approverSteps,
        session.uid,
        values,
        group.fields,
        body.managerOverrides ?? {},
      );
      const dedupedApprovers = dedupeApproversWithMeta(resolvedApprovers.approvers, resolvedApprovers.meta);
      approversSnapshot = dedupedApprovers.users;
      const approverStepMeta = dedupedApprovers.meta;
      const deadlineAt = computeDeadline(
        resolveInitialSlaHours(group),
        new Date(),
        group.slaByWorkCalendar === true,
      );
      const nowIso = new Date().toISOString();
      const code =
        found.code ??
        (group.useOwnCounter === true
          ? await generateGroupRequestCode(group.id)
          : await generateRequestCode());
      const patch = {
        code,
        values,
        groupNameSnapshot: group.name,
        fieldsSnapshot: group.fields,
        approvalFlow: group.approvalFlow,
        approversSnapshot,
        approverStepMeta,
        approvers: buildInitialApprovers(approversSnapshot),
        // "Chỉ huy trưởng" — CHỈ chốt lúc gửi chính thức LẦN ĐẦU từ nháp
        // (found.status === "draft"). Gửi lại từ "pending"/"returned" (đã có
        // approver từ lần gửi đầu) KHÔNG được đụng tới field này — xem
        // design.md của change add-adjustment-approval-conditions.
        ...(found.status === "draft" ? { originalFirstApprover: approversSnapshot[0] ?? null } : {}),
        // Giữ đúng người theo dõi người gửi đã chỉnh (mặc định + thêm tay),
        // không ghi đè về danh sách mặc định của nhóm khi gửi chính thức từ
        // nháp — nhất quán với nhánh "chỉ lưu nháp" ở trên (dòng `followers`).
        // Hợp nhất thêm người theo dõi theo điều kiện thoả mãn tại thời điểm
        // gửi chính thức này (values đã đủ vì đã qua kiểm tra thiếu trường ở trên).
        followers: mergeFollowers(
          group.followers,
          followers,
          group.followersConditional ?? [],
          values,
          group.fields,
          group.permissionRules?.autoAddSubtaskAssigneesAsFollowers,
        ),
        status: "pending" as const,
        deadlineAt,
        updatedAt: nowIso,
      };
      const historyEntry: RequestHistoryEntry = {
        at: nowIso,
        actor: session.name,
        action: isEditingPending
          ? "Đã chỉnh sửa đề xuất — duyệt lại từ đầu"
          : found.status === "returned"
            ? "Đã gửi lại đề xuất"
            : "Đã gửi đề xuất",
      };
      const updated = await commitEdit(id, found, expectedVersion, patch, historyEntry);
      // Gửi chính thức (không phải lưu nháp) — tính lại chuông cho người liên quan.
      after(() => refreshNotificationFeedsForRequest(id));
      // Email thông báo thật (Đợt 3, Sếp chốt 06/10/2026) — trước đây luồng
      // GỬI TỪ NHÁP / GỬI LẠI (sau sửa hoặc sau khi bị trả lại) không gửi
      // email nào cả, chỉ có luồng tạo mới (app/api/requests/route.ts) gửi.
      // Người theo dõi chỉ báo đúng 1 LẦN GỬI ĐẦU TIÊN thật sự (từ nháp) —
      // gửi lại sau khi sửa/bị trả lại không phải tin mới với họ, tránh
      // thành "nhiều cái không thiết thực" (đúng điều Sếp từng phàn nàn).
      after(async () => {
        try {
          const tasks = [notifyPendingApprovers(updated, group)];
          if (found.status === "draft") tasks.push(notifyFollowersSubmitted(updated.followers, updated, group));
          await Promise.all(tasks);
        } catch (mailError) {
          console.error("Gửi email thông báo lúc gửi đề xuất (từ nháp/gửi lại) thất bại (không ảnh hưởng thao tác chính):", mailError);
        }
      });
      // Chuông chung HPcore (Sếp chốt 07/10/2026).
      after(async () => {
        try {
          const tasks = [hpcorePendingApprovers(updated)];
          if (found.status === "draft") tasks.push(hpcoreFollowersSubmitted(updated.followers, updated));
          await Promise.all(tasks);
        } catch (hpcoreError) {
          console.error("Ghi thông báo sang HPcore lúc gửi đề xuất (từ nháp/gửi lại) thất bại (không ảnh hưởng thao tác chính):", hpcoreError);
        }
      });
      return NextResponse.json({ request: updated });
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
    const patch = {
      code,
      values,
      groupNameSnapshot,
      approversSnapshot,
      approvers: buildInitialApprovers(approversSnapshot),
      ...(found.status === "draft" ? { originalFirstApprover: approversSnapshot[0] ?? null } : {}),
      followers,
      status: "pending" as const,
      deadlineAt: null,
      updatedAt: nowIso,
    };
    const historyEntry: RequestHistoryEntry = {
      at: nowIso,
      actor: session.name,
      action: found.status === "returned" ? "Đã gửi lại đề xuất" : "Đã gửi đề xuất",
    };
    const updated = await commitEdit(id, found, expectedVersion, patch, historyEntry);
    after(() => refreshNotificationFeedsForRequest(id));
    // Email thông báo thật (Đợt 3, Sếp chốt 06/10/2026) — đề xuất trực tiếp
    // không có nhóm nên `group` truyền `null` (mặc định BẬT, xem
    // lib/server/notification-emails.ts). Cùng lý do chỉ báo người theo dõi
    // đúng lần gửi đầu như nhánh có nhóm ở trên.
    after(async () => {
      try {
        const tasks = [notifyPendingApprovers(updated, null)];
        if (found.status === "draft") tasks.push(notifyFollowersSubmitted(updated.followers, updated, null));
        await Promise.all(tasks);
      } catch (mailError) {
        console.error("Gửi email thông báo lúc gửi đề xuất trực tiếp (từ nháp/gửi lại) thất bại (không ảnh hưởng thao tác chính):", mailError);
      }
    });
    // Chuông chung HPcore (Sếp chốt 07/10/2026).
    after(async () => {
      try {
        const tasks = [hpcorePendingApprovers(updated)];
        if (found.status === "draft") tasks.push(hpcoreFollowersSubmitted(updated.followers, updated));
        await Promise.all(tasks);
      } catch (hpcoreError) {
        console.error("Ghi thông báo sang HPcore lúc gửi đề xuất trực tiếp (từ nháp/gửi lại) thất bại (không ảnh hưởng thao tác chính):", hpcoreError);
      }
    });
    return NextResponse.json({ request: updated });
  } catch (error) {
    if (error instanceof RequestTxError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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
    const entry = { at: nowIso, actor: session.name, action: "Đã xóa đề xuất" };
    const history = [...found.history, entry];
    // NỐI dòng lịch sử bằng arrayUnion (06/10/2026) — không ghi đè cả mảng từ
    // bản đọc cũ, tránh xoá mất dòng của quyết định duyệt ghi xen giữa.
    await adminDb.collection("requests").doc(id).update({ deletedAt: nowIso, history: FieldValue.arrayUnion(entry) });
    // Gỡ dòng của đề xuất này khỏi chuông những ai đang có nó.
    after(() => refreshNotificationFeedsForRequest(id));
    /* ★ 03/10/2026 (đợt 1 "liên kết 4 app", L03/L04) — đề xuất ĐÃ DUYỆT bị xoá thì báo Kho + Thu mua.
       Chưa duyệt thì chưa từng sang app nào, không cần báo. Lỗi tạo việc không được làm hỏng thao tác xoá. */
    if (found.status === "approved") {
      try {
        const ids = await taoViecDongBo({ requestId: id, requestCode: found.code ?? null, loai: "xoa", nguoi: session.name });
        after(() => guiCacViec(ids));
      } catch (err) {
        console.error(`Tạo việc báo xoá đề xuất ${id} sang Kho / Thu mua lỗi:`, err);
      }
    }
    return NextResponse.json({ request: { ...found, deletedAt: nowIso, history } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
