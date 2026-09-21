import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { isWithinUsedForScope } from "@/lib/permissions";
import { getEmailPreferencesByGroup, updateEmailPreferenceByGroup } from "@/lib/server/notificationSettings";
import { requireSession } from "@/lib/session";
import type { EmailNotifyCategory, ProposalGroup } from "@/lib/types";

const EMAIL_CATEGORIES: EmailNotifyCategory[] = ["approver_pending", "own_decided", "following"];

/**
 * Công tắc email THEO TỪNG NHÓM (Sếp chốt 21/09/2026, "để người dùng tự
 * quyết") — tách API riêng khỏi /api/notification-settings (6 loại phẳng
 * cũ) vì khác hẳn cấu trúc dữ liệu (nested theo groupId).
 *
 * GET: trả danh sách nhóm người dùng ĐƯỢC PHÉP GỬI ĐỀ XUẤT (đúng phạm vi
 * `usedFor`, cùng luật server đã áp khi gửi thật ở app/api/requests/route.ts
 * — không hiện nhóm họ không liên quan gì), kèm cấu hình email hiện tại của
 * từng nhóm + cờ nhóm đó Admin có bật "Thông báo email" hay chưa (để UI báo
 * rõ khi bật công tắc cá nhân mà nhóm chưa cho dùng email thì chưa có tác
 * dụng — vẫn giữ 2 lớp, Admin là công tắc tổng, đây chỉ là lớp trong).
 */
export async function GET() {
  try {
    const session = await requireSession();

    const groupsSnap = await adminDb.collection("groups").where("status", "==", "active").get();
    const eligible = groupsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }) as ProposalGroup)
      .filter((g) => isWithinUsedForScope(g.usedFor, { userId: session.uid, groupIds: [] }));

    const prefsByGroup = await getEmailPreferencesByGroup(session.uid);

    const groups = eligible
      .map((g) => ({
        id: g.id,
        name: g.name,
        category: g.category,
        groupEmailEnabled: g.notificationRules?.emailNotify === true,
        prefs: EMAIL_CATEGORIES.reduce(
          (acc, cat) => {
            acc[cat] = prefsByGroup[g.id]?.[cat] !== false;
            return acc;
          },
          {} as Record<EmailNotifyCategory, boolean>,
        ),
      }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    return NextResponse.json({ groups });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

interface PatchBody {
  groupId: string;
  category: EmailNotifyCategory;
  enabled: boolean;
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as Partial<PatchBody>;
    if (!body.groupId || !EMAIL_CATEGORIES.includes(body.category as EmailNotifyCategory) || typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "Thiếu groupId/category/enabled hợp lệ." }, { status: 400 });
    }
    await updateEmailPreferenceByGroup(session.uid, body.groupId, body.category as EmailNotifyCategory, body.enabled);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
