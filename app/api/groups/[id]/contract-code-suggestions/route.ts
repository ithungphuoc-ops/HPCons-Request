import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { isWithinUsedForScope } from "@/lib/permissions";
import { requireSession } from "@/lib/session";
import { loadContractCodeSuggestions } from "@/lib/congno";
import type { ProposalGroup } from "@/lib/types";

/**
 * Gợi ý Số Hợp Đồng CĐT thật cho field đã bật `contractCodeLookup` — xem
 * openspec/changes/add-contract-code-lookup. KHÁC hẳn route
 * field-suggestions/ (đọc lịch sử CHÍNH nhóm đề xuất): route này đọc dữ liệu
 * TOÀN CÔNG TY từ app Công nợ (project Firestore khác), không phụ thuộc
 * quyền XEM đề xuất — chỉ cần đã đăng nhập + nằm trong phạm vi "Sử dụng cho"
 * của nhóm + field đúng có bật cờ.
 *
 * `loadContractCodeSuggestions` (lib/congno.ts) đã tự cache 5 phút — dùng
 * CHUNG với hàm validate chặn gửi (lib/server/requests.ts), không tự cache
 * riêng ở đây nữa (trước đó có 2 lớp cache trùng key, CodeRabbit PR #41 chỉ
 * ra validate KHÔNG qua cache nào cả — gộp về đúng 1 nguồn).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id: groupId } = await params;
    const fieldId = request.nextUrl.searchParams.get("fieldId");
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
    if (!field || field.dataType !== "short_text" || !field.contractCodeLookup) {
      return NextResponse.json(
        { error: "Trường này chưa bật ràng buộc Số Hợp Đồng CĐT." },
        { status: 403 },
      );
    }

    const suggestions = await loadContractCodeSuggestions();
    return NextResponse.json({ suggestions });
  } catch (error) {
    // Thiếu CONGNO_FIREBASE_SERVICE_ACCOUNT hoặc lỗi kết nối app Công nợ —
    // trả lỗi rõ ràng, KHÔNG để field này làm sập cả trang gửi đề xuất (các
    // field khác của form vẫn hoạt động bình thường).
    return apiErrorResponse(error);
  }
}
