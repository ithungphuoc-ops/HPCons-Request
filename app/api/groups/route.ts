import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import {
  ensureApproverStepCodes,
  ensureCategoryExists,
  ensureFieldCodes,
  sanitizeDescriptionHtml,
} from "@/lib/server/groups";
import { createScopeChecker } from "@/lib/server/hpcore-org";
import { requireSession, requireWriteAccess } from "@/lib/session";
import type { CategoryGroup, ProposalGroup } from "@/lib/types";

export async function GET() {
  try {
    const session = await requireSession();

    const [categoriesSnap, groupsSnap] = await Promise.all([
      adminDb.collection("categories").orderBy("code").get(),
      adminDb.collection("groups").orderBy("createdAt").get(),
    ]);

    const canSubmit = createScopeChecker(session.uid);
    const groups = await Promise.all(
      groupsSnap.docs.map(async (doc) => {
        const group = { id: doc.id, ...doc.data() } as ProposalGroup;
        const { fields, changed: fieldsChanged } = ensureFieldCodes(group.fields);
        const { steps, changed: stepsChanged } = ensureApproverStepCodes(group.approverSteps ?? []);
        const update: Partial<ProposalGroup> = {};
        if (fieldsChanged) update.fields = fields;
        if (stepsChanged) update.approverSteps = steps;
        if (Object.keys(update).length > 0) {
          await doc.ref.update(update);
        }
        group.fields = fields;
        group.approverSteps = steps;
        // Cờ CHỈ ĐỌC cho người đang xem — danh sách "Tạo đề xuất" ẩn loại
        // ngoài phạm vi; trang cài đặt (Owner/Admin) vẫn thấy đủ mọi nhóm.
        // Lỗi đọc App Tổng → không ẩn (máy chủ vẫn chặn khi gửi thật), tránh
        // làm hỏng cả danh sách nhóm của mọi người.
        group.viewerCanSubmit = await canSubmit(group).catch(() => true);
        return group;
      }),
    );

    const categoryGroups: CategoryGroup[] = categoriesSnap.docs.map((doc) => {
      const data = doc.data() as {
        code: string;
        name: string;
        letterheadImagePath?: string;
        letterheadImageName?: string;
      };
      return {
        id: doc.id,
        code: data.code,
        name: data.name,
        groups: groups.filter((g) => g.category === data.name),
        letterheadImagePath: data.letterheadImagePath,
        letterheadImageName: data.letterheadImageName,
      };
    });

    return NextResponse.json({ categoryGroups });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

type CreateGroupBody = Omit<
  ProposalGroup,
  "id" | "fields" | "pinned" | "createdAt" | "status"
>;

export async function POST(request: Request) {
  try {
    const session = await requireWriteAccess();
    const body = (await request.json()) as CreateGroupBody & { viewerCanSubmit?: unknown };
    delete body.viewerCanSubmit;

    const categoryName = body.category?.trim() || "Chưa phân loại";
    await ensureCategoryExists(categoryName);

    const groupRef = adminDb.collection("groups").doc();
    const newGroup: Omit<ProposalGroup, "id"> = {
      ...body,
      category: categoryName,
      descriptionHtml:
        body.descriptionHtml !== undefined ? sanitizeDescriptionHtml(body.descriptionHtml) : undefined,
      fields: [],
      pinned: false,
      createdAt: new Date().toISOString().slice(0, 10),
      status: "active",
      // Set 1 LẦN lúc tạo — không đọc từ `body` (không tin client tự khai
      // người tạo), và route PATCH nhóm không nhận field này nên không sửa
      // lại được sau (xem app/api/groups/[id]/route.ts).
      createdBy: { uid: session.uid, name: session.name },
    };
    await groupRef.set(newGroup);

    const group: ProposalGroup = { id: groupRef.id, ...newGroup };
    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
