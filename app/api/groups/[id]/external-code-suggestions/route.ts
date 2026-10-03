import { NextRequest, NextResponse } from "next/server";
import { canUseGroupHelpers } from "@/lib/server/hpcore-org";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { requireSession } from "@/lib/session";
import { EXTERNAL_CODE_SOURCES, resolveExternalCodeLookup } from "@/lib/external-code-sources";
import type { ExternalCodeSourceId, ProposalGroup } from "@/lib/types";

function isKnownSourceId(value: string | null): value is ExternalCodeSourceId {
  return value === "congno_contracts" || value === "congno_subcontractors";
}

/**
 * Gợi ý mã tham chiếu thật cho field đã bật ràng buộc mã tham chiếu ngoài —
 * thay thế `contract-code-suggestions/` (chỉ hỗ trợ Số Hợp Đồng CĐT), xem
 * openspec/changes/add-external-code-lookup-picker. Đọc dữ liệu TOÀN CÔNG TY
 * từ app Công nợ (project Firestore khác), không phụ thuộc quyền XEM đề
 * xuất — chỉ cần đã đăng nhập + nằm trong phạm vi "Sử dụng cho" của nhóm +
 * field đúng có bật ràng buộc.
 *
 * `?fieldId=`: field đã có sẵn ràng buộc (dùng lúc GỬI đề xuất thật — ô nhập
 * tự động của người gửi, xem submit/page.tsx) — xác định nguồn qua
 * `resolveExternalCodeLookup`, field phải đúng đã bật ràng buộc.
 * `?sourceId=`: dùng lúc ĐANG CẤU HÌNH field (màn Thêm/Sửa trường, bước xem
 * trước trước khi lưu — Decision 6 design.md) — field có thể CHƯA lưu ràng
 * buộc nào (đang chọn thử), nên không thể tra qua `fieldId`. Chỉ chấp nhận
 * đúng 1 trong 2 giá trị đã đăng ký (`isKnownSourceId`), không tin giá trị
 * bất kỳ. Truyền ĐÚNG MỘT trong 2 tham số này.
 * `?sample=1` (tuỳ chọn): chỉ trả về ĐÚNG 1 bản ghi đầu tiên — dùng cho bước
 * "xem trước", không cần tải toàn bộ danh sách chỉ để xem 1 dòng mẫu.
 *
 * `EXTERNAL_CODE_SOURCES[sourceId].loadRecords()` đã tự cache 5 phút — dùng
 * CHUNG với hàm validate chặn gửi (lib/server/requests.ts), không tự cache
 * riêng ở đây (bài học CodeRabbit PR #41 — gộp về đúng 1 nguồn).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id: groupId } = await params;
    const fieldId = request.nextUrl.searchParams.get("fieldId");
    const sourceIdParam = request.nextUrl.searchParams.get("sourceId");
    const sampleOnly = request.nextUrl.searchParams.get("sample") === "1";
    if (!fieldId && !sourceIdParam) {
      return NextResponse.json({ error: "Thiếu fieldId hoặc sourceId." }, { status: 400 });
    }

    const groupSnap = await adminDb.collection("groups").doc(groupId).get();
    if (!groupSnap.exists) {
      return NextResponse.json({ error: "Không tìm thấy nhóm." }, { status: 404 });
    }
    const group = groupSnap.data() as ProposalGroup;

    if (!(await canUseGroupHelpers(group, session))) {
      return NextResponse.json(
        { error: "Bạn không nằm trong phạm vi sử dụng của nhóm đề xuất này." },
        { status: 403 },
      );
    }

    let sourceId: keyof typeof EXTERNAL_CODE_SOURCES;
    if (fieldId) {
      const field = group.fields?.find((f) => f.id === fieldId);
      const lookup = field && field.dataType === "short_text" ? resolveExternalCodeLookup(field) : undefined;
      if (!lookup) {
        return NextResponse.json(
          { error: "Trường này chưa bật ràng buộc mã tham chiếu ngoài." },
          { status: 403 },
        );
      }
      sourceId = lookup.sourceId;
    } else {
      if (!isKnownSourceId(sourceIdParam)) {
        return NextResponse.json({ error: "sourceId không hợp lệ." }, { status: 400 });
      }
      sourceId = sourceIdParam;
    }

    const records = await EXTERNAL_CODE_SOURCES[sourceId].loadRecords();
    return NextResponse.json({ records: sampleOnly ? records.slice(0, 1) : records });
  } catch (error) {
    // Thiếu CONGNO_FIREBASE_SERVICE_ACCOUNT hoặc lỗi kết nối app Công nợ —
    // trả lỗi rõ ràng, KHÔNG để field này làm sập cả trang gửi đề xuất (các
    // field khác của form vẫn hoạt động bình thường).
    return apiErrorResponse(error);
  }
}
