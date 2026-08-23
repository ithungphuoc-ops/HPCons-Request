import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { slugifyFieldName } from "@/lib/print-template";
import {
  diffGroupPatch,
  ensureApproverStepCodes,
  ensureCategoryExists,
  ensureFieldCodes,
  recordGroupHistory,
  sanitizeDescriptionHtml,
} from "@/lib/server/groups";
import { sanitizeHelpText } from "@/lib/validation";
import { validateConditionGroupFieldCodes } from "@/lib/server/conditions";
import { findReferencedComputedFieldCode } from "@/lib/server/computed-fields";
import { requireWriteAccess } from "@/lib/session";
import type { ProposalGroup } from "@/lib/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;
    const patch = (await request.json()) as Partial<Omit<ProposalGroup, "id">>;
    // `createdBy` chỉ set 1 LẦN lúc tạo nhóm (POST /api/groups) — không tin
    // client, luôn bỏ qua field này nếu lỡ có trong body PATCH.
    delete patch.createdBy;

    const ref = adminDb.collection("groups").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json(
        { error: "Không tìm thấy nhóm đề xuất." },
        { status: 404 },
      );
    }
    const before = snap.data() as Omit<ProposalGroup, "id">;

    if (patch.category) {
      await ensureCategoryExists(patch.category.trim());
      patch.category = patch.category.trim();
    }
    if (patch.descriptionHtml !== undefined) {
      patch.descriptionHtml = sanitizeDescriptionHtml(patch.descriptionHtml);
    }
    if (patch.fields) {
      // Chuẩn hoá mã trường người dùng tự gõ (sửa tay ở Giai đoạn "sửa mã trường") rồi
      // mới backfill mã còn thiếu — không tin client, luôn kiểm tra trùng ở server.
      const normalized = patch.fields.map((f) => ({
        ...(f.code ? { ...f, code: slugifyFieldName(f.code) || undefined } : f),
        helpText: f.helpText !== undefined ? sanitizeHelpText(f.helpText) || undefined : undefined,
      }));
      const seen = new Set<string>();
      for (const f of normalized) {
        if (!f.code) continue;
        if (seen.has(f.code)) {
          return NextResponse.json(
            { error: `Mã trường "${f.code}" bị trùng giữa 2 trường trong cùng nhóm — đổi mã khác.` },
            { status: 400 },
          );
        }
        seen.add(f.code);
      }
      patch.fields = ensureFieldCodes(normalized).fields;
    }
    // Validate mọi ConditionGroup tham chiếu field có thật trong nhóm — dùng
    // chung 1 hàm cho cả 3 nơi lưu điều kiện (field.visibleWhen,
    // approverSteps[].condition, followersConditional[].condition), tránh
    // lệch nhau như trước đây (chỉ approverSteps được validate).
    if (patch.fields || patch.approverSteps || patch.followersConditional) {
      const fieldsForValidation = patch.fields ?? before.fields;
      const knownFieldCodes = new Set(fieldsForValidation.map((f) => f.code).filter(Boolean) as string[]);

      if (patch.fields) {
        for (const field of patch.fields) {
          const badCode = validateConditionGroupFieldCodes(field.visibleWhen, knownFieldCodes);
          if (badCode) {
            return NextResponse.json(
              { error: `Điều kiện hiển thị của trường "${field.name}" tham chiếu tới trường "${badCode}" không tồn tại trong nhóm.` },
              { status: 400 },
            );
          }

          if (field.computedFrom) {
            for (const branch of field.computedFrom.branches) {
              const badBranchCode = validateConditionGroupFieldCodes(branch.condition, knownFieldCodes);
              if (badBranchCode) {
                return NextResponse.json(
                  { error: `Điều kiện tự tính giá trị của trường "${field.name}" tham chiếu tới trường "${badBranchCode}" không tồn tại trong nhóm.` },
                  { status: 400 },
                );
              }
              const referencedCodes = [...branch.template.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1]);
              const missingCode = referencedCodes.find((code) => !knownFieldCodes.has(code));
              if (missingCode) {
                return NextResponse.json(
                  { error: `Mẫu chuỗi tự tính giá trị của trường "${field.name}" tham chiếu tới trường "${missingCode}" không tồn tại trong nhóm.` },
                  { status: 400 },
                );
              }
            }

            const circularCode = findReferencedComputedFieldCode(field, patch.fields);
            if (circularCode) {
              return NextResponse.json(
                { error: `Trường "${field.name}" không được tham chiếu tới trường "${circularCode}" vì trường đó cũng tự tính giá trị (không cho phép tính lồng nhiều tầng).` },
                { status: 400 },
              );
            }
          }
        }
      }

      if (patch.approverSteps) {
        for (const step of patch.approverSteps) {
          const badCode = validateConditionGroupFieldCodes(step.condition, knownFieldCodes);
          if (badCode) {
            return NextResponse.json(
              { error: `Điều kiện của bước duyệt tham chiếu tới trường "${badCode}" không tồn tại trong nhóm.` },
              { status: 400 },
            );
          }
        }
      }

      if (patch.followersConditional) {
        for (const item of patch.followersConditional) {
          const badCode = validateConditionGroupFieldCodes(item.condition, knownFieldCodes);
          if (badCode) {
            return NextResponse.json(
              { error: `Điều kiện của người theo dõi tham chiếu tới trường "${badCode}" không tồn tại trong nhóm.` },
              { status: 400 },
            );
          }
        }
      }
    }

    if (patch.approverSteps) {
      patch.approverSteps = ensureApproverStepCodes(patch.approverSteps).steps;
    }

    // "Mẫu form phê duyệt" — chặn 2 field cùng gắn (approverStepCode,
    // decisionAction), vì mỗi (bước × hành động) chỉ nên hiện ĐÚNG 1 field
    // trong hộp thoại quyết định (xem design.md Decision #3, Risk).
    if (patch.approvalTimeFields) {
      const seenPairs = new Set<string>();
      for (const atf of patch.approvalTimeFields) {
        const pairKey = `${atf.approverStepCode}::${atf.decisionAction}`;
        if (seenPairs.has(pairKey)) {
          return NextResponse.json(
            {
              error: `Đã có 1 trường gắn với đúng bước "${atf.approverStepCode}" và hành động này rồi — mỗi (bước × hành động) chỉ được 1 trường.`,
            },
            { status: 400 },
          );
        }
        seenPairs.add(pairKey);
      }
    }

    await ref.update({ ...patch });

    const changes = diffGroupPatch(before as unknown as Record<string, unknown>, patch);
    await recordGroupHistory({
      groupId: id,
      groupName: (patch.name as string | undefined) ?? before.name,
      actor: session.name,
      action: "Chỉnh sửa nhóm",
      changes,
    });

    const group: ProposalGroup = {
      id: ref.id,
      ...before,
      ...patch,
    };
    return NextResponse.json({ group });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
