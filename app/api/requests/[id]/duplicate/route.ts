import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { canView, loadRequest, toProposalGroup } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import type { ProposalField, RequestInstance, TaggedUser } from "@/lib/types";

/**
 * Chỉ giữ giá trị của 5 field ĐẦU TIÊN theo `order` (thường là các mục định
 * danh: tên đề xuất/lựa chọn đề nghị/số hợp đồng/tên công trình/bộ phận) —
 * các field còn lại (bộ phận/chi tiết/tài liệu đính kèm nếu không nằm trong
 * 5 field đầu...) để TRỐNG, bắt người dùng tự nhập lại thay vì chép nguyên
 * dữ liệu cũ. Theo yêu cầu Sếp 13/09/2026 — trước đây chép NGUYÊN VẸN mọi
 * field khiến dữ liệu sai ở bảng "Chi tiết" (vd "Số lượng: file đính kèm")
 * bị nhân bản lan sang nhiều đề xuất mới. Áp dụng THEO VỊ TRÍ cho MỌI nhóm
 * đề xuất (không riêng nhóm nào) — nhóm có ít hơn 5 field thì giữ hết,
 * không ảnh hưởng.
 */
function keepOnlyFirstFieldsValues(
  fieldsSnapshot: ProposalField[],
  values: Record<string, unknown>,
  keepCount = 5,
): Record<string, unknown> {
  const keptIds = new Set(
    [...fieldsSnapshot]
      .sort((a, b) => a.order - b.order)
      .slice(0, keepCount)
      .map((f) => f.id),
  );
  const kept: Record<string, unknown> = {};
  for (const [fieldId, value] of Object.entries(values)) {
    if (keptIds.has(fieldId)) kept[fieldId] = value;
  }
  return kept;
}

/** Nhân bản đề xuất — tạo NHÁP mới thuộc về người bấm nhân bản, chỉ chép
 * dữ liệu biểu mẫu (không chép người duyệt/lịch sử/bình luận/trạng thái). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const source = await loadRequest(id);
    if (!source) {
      return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    }
    if (!canView(source, session.uid, session.role)) {
      return NextResponse.json(
        { error: "Bạn không có quyền xem đề xuất này." },
        { status: 403 },
      );
    }

    // Người theo dõi MẶC ĐỊNH của nhóm đề xuất (Sếp phản hồi 29/09/2026: nhân
    // bản đề xuất cũ đang mất hết người theo dõi, phải hiển thị lại đúng theo
    // thiết lập nhóm HIỆN HÀNH — không chép lại followers CŨ của đề xuất gốc,
    // vì cấu hình nhóm có thể đã đổi từ lúc đó). Đề xuất trực tiếp (không có
    // nhóm) không có khái niệm "mặc định" nên vẫn để trống như cũ.
    let defaultFollowers: TaggedUser[] = [];
    if (source.groupId) {
      const groupSnap = await adminDb.collection("groups").doc(source.groupId).get();
      if (groupSnap.exists) {
        defaultFollowers = toProposalGroup(groupSnap.id, groupSnap.data()!).followers;
      }
    }

    const nowIso = new Date().toISOString();
    const ref = adminDb.collection("requests").doc();
    const duplicate: Omit<RequestInstance, "id"> = {
      code: null,
      groupId: source.groupId,
      groupNameSnapshot: source.groupNameSnapshot,
      fieldsSnapshot: source.fieldsSnapshot,
      values: keepOnlyFirstFieldsValues(
        source.fieldsSnapshot,
        JSON.parse(JSON.stringify(source.values)),
      ),
      submittedBy: { uid: session.uid, email: session.email, name: session.name },
      submittedAt: nowIso,
      updatedAt: nowIso,
      approvalFlow: source.approvalFlow,
      approversSnapshot: [],
      approvers: [],
      followers: defaultFollowers,
      status: "draft",
      deadlineAt: null,
      history: [{ at: nowIso, actor: session.name, action: `Đã nhân bản từ đề xuất ${source.code ?? source.id}` }],
      comments: [],
      deletedAt: null,
    };
    await ref.set(duplicate);

    return NextResponse.json({ request: { id: ref.id, ...duplicate } }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
