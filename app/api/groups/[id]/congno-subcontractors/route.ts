import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { isWithinUsedForScope } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { createSubcontractorInCongNo } from "@/lib/congno";
import { resolveExternalCodeLookup } from "@/lib/external-code-sources";
import type { ProposalGroup } from "@/lib/types";

const NHOM_VALUES = new Set(["THẦU PHỤ", "TỔ ĐỘI"]);

/**
 * Tạo mới 1 nhà thầu phụ NGAY từ app Đề xuất, ghi THẬT vào Firestore Công nợ
 * — xem openspec/changes/add-create-subcontractor-from-request. Lần đầu
 * base-request-app GHI qua app khác (các route khác trong
 * app/api/groups/[id]/ chỉ đọc). CHỈ field THẬT SỰ đã bật
 * `externalCodeLookup.sourceId === "congno_subcontractors"` mới gọi được
 * route này — chặn lạm dụng cho field/nhóm không liên quan.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id: groupId } = await params;
    const body = (await request.json()) as {
      fieldId?: unknown;
      ten?: unknown;
      tenVietTat?: unknown;
      mst?: unknown;
      nhom?: unknown;
      diaChi?: unknown;
    };

    const fieldId = typeof body.fieldId === "string" ? body.fieldId : "";
    if (!fieldId) {
      return NextResponse.json({ error: "Thiếu fieldId." }, { status: 400 });
    }

    const groupSnap = await adminDb.collection("groups").doc(groupId).get();
    if (!groupSnap.exists) {
      return NextResponse.json({ error: "Không tìm thấy nhóm." }, { status: 404 });
    }
    const group = groupSnap.data() as ProposalGroup;

    if (!isWithinUsedForScope(group.usedFor, { userId: session.uid, groupIds: [] })) {
      return NextResponse.json(
        { error: "Bạn không nằm trong phạm vi sử dụng của nhóm đề xuất này." },
        { status: 403 },
      );
    }

    const field = group.fields?.find((f) => f.id === fieldId);
    const lookup = field && field.dataType === "short_text" ? resolveExternalCodeLookup(field) : undefined;
    if (!lookup || lookup.sourceId !== "congno_subcontractors") {
      return NextResponse.json(
        { error: "Trường này không bật ràng buộc mã tham chiếu ngoài nguồn Mã nhà thầu phụ." },
        { status: 403 },
      );
    }

    const ten = typeof body.ten === "string" ? body.ten.trim() : "";
    const mst = typeof body.mst === "string" ? body.mst.trim() : "";
    const tenVietTat = typeof body.tenVietTat === "string" ? body.tenVietTat.trim() : "";
    const diaChi = typeof body.diaChi === "string" ? body.diaChi.trim() : "";
    // Sếp chốt 01/10/2026: Tên vắn tắt, Nhóm, Địa chỉ đều BẮT BUỘC (trước đây
    // chỉ Tên nhà cung cấp + MST bắt buộc, Nhóm còn tự ép mặc định "THẦU PHỤ"
    // khi thiếu — CodeRabbit PR #59 từng chặn giá trị SAI nhưng vẫn cho phép
    // THIẾU; giờ thiếu cũng bị từ chối, không còn mặc định ngầm nào).
    if (typeof body.nhom !== "string" || !NHOM_VALUES.has(body.nhom)) {
      return NextResponse.json({ error: "Vui lòng chọn nhóm." }, { status: 400 });
    }
    const nhom = body.nhom as "THẦU PHỤ" | "TỔ ĐỘI";

    if (!ten) {
      return NextResponse.json({ error: "Thiếu tên nhà cung cấp." }, { status: 400 });
    }
    if (!tenVietTat) {
      return NextResponse.json({ error: "Thiếu tên vắn tắt." }, { status: 400 });
    }
    if (!mst) {
      return NextResponse.json({ error: "Thiếu MST hoặc CCCD." }, { status: 400 });
    }
    if (!diaChi) {
      return NextResponse.json({ error: "Thiếu địa chỉ." }, { status: 400 });
    }

    const { id, record } = await createSubcontractorInCongNo({
      ten,
      tenVietTat,
      mst,
      nhom,
      diaChi,
      // Tên người đã thêm lấy từ phiên đăng nhập thật, KHÔNG nhận từ body —
      // tránh client giả mạo tên người khác.
      nguoiThem: session.name,
    });

    return NextResponse.json({ id, record: { fields: record } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
