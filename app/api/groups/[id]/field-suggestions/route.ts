import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { isWithinUsedForScope, type Role } from "@/lib/permissions";
import { canView } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";
import type { ProposalGroup, RequestInstance } from "@/lib/types";

const MAX_SUGGESTIONS = 50;
/** Chỉ xét N đề xuất GẦN NHẤT của nhóm (sắp trong bộ nhớ theo submittedAt,
 * không orderBy() ở Firestore — orderBy kèm where khác field cần composite
 * index riêng, xem ghi chú QUY ƯỚC HẠN MỨC FIRESTORE bên dưới). */
const MAX_REQUESTS_SCANNED = 300;

/**
 * ⚠️ QUY ƯỚC HẠN MỨC FIRESTORE — cùng nguyên tắc đã áp dụng khắp hệ sinh thái
 * sau sự cố RESOURCE_EXHAUSTED thật (app Kho công trình, 13/09/2026): route
 * này được gọi MỖI LẦN người dùng mở form gửi đề xuất của 1 nhóm có bật "gợi
 * ý từ lịch sử" (tần suất cao — nhiều nhân viên mở nhiều lần/ngày). Vá theo
 * đúng 2 quy tắc hợp lệ:
 * 1. GIỚI HẠN PHẠM VI — chỉ đọc `where("groupId","==",groupId)` (đúng nhóm),
 *    không quét toàn bộ collection `requests` của cả hệ thống (khác nhánh
 *    scope="system" ở app/api/requests/route.ts — đó là trang admin hiếm
 *    dùng, chấp nhận được; route này thì KHÔNG, vì tần suất gọi rất cao).
 *    KHÔNG orderBy()+limit() ở Firestore (dù nhanh hơn) vì where("groupId")
 *    kèm orderBy("submittedAt") khác field cần tạo composite index riêng
 *    trên Firebase Console — đổi hạ tầng chỉ để tối ưu 1 API "gợi ý mềm"
 *    tần suất vừa phải là không đáng, giữ sort/slice trong bộ nhớ.
 * 2. CACHE — 60 giây, đúng mức các API tương tự khác đã dùng. Không cần
 *    revalidateTag: đây là "gợi ý" mềm, không phải dữ liệu cần thấy ngay lập
 *    tức trong vòng 60 giây — độ trễ này không ảnh hưởng nghiệp vụ.
 *
 * Kết quả PHỤ THUỘC người xem (canView() — đúng quy tắc đã áp dụng cho
 * GET /api/requests?scope=group, xem route đó) nên `uid`/`role` PHẢI nằm
 * trong đối số hàm — unstable_cache khoá cache theo JSON.stringify(args),
 * thiếu 2 tham số này thì người này sẽ thấy gợi ý được cache cho người khác.
 */
const loadSuggestionsCached = unstable_cache(
  async (groupId: string, fieldId: string, uid: string, role: Role): Promise<string[]> => {
    const snap = await adminDb.collection("requests").where("groupId", "==", groupId).get();
    const docs = snap.docs
      .map((d) => d.data() as RequestInstance)
      // canView() đã bao gồm đúng luật "nháp chỉ chủ nhân xem được" — không
      // rò nội dung nháp riêng tư của người khác qua gợi ý autocomplete, và
      // đề xuất đã gửi chỉ tính nếu người gọi thật sự xem được (người tạo/
      // duyệt/theo dõi hoặc owner-admin) — khớp đúng quy tắc scope="group".
      .filter((r) => !r.deletedAt && canView(r, uid, role))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
      .slice(0, MAX_REQUESTS_SCANNED);

    const seen = new Set<string>();
    const suggestions: string[] = [];
    for (const r of docs) {
      const raw = r.values?.[fieldId];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (!value || seen.has(value)) continue;
      seen.add(value);
      suggestions.push(value);
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
    return suggestions;
  },
  ["group-field-suggestions"],
  { revalidate: 60 },
);

/**
 * Gợi ý (datalist) cho 1 field kiểu short_text có bật `suggestFromHistory` —
 * lấy các giá trị ĐÃ TỪNG NHẬP cho ĐÚNG field này trong CÙNG nhóm đề xuất,
 * gần nhất trước. Không ép buộc chọn — form vẫn cho gõ giá trị mới hoàn
 * toàn tự do, đây chỉ là gợi ý giảm rủi ro gõ sai/không nhất quán (Sếp chốt
 * 17/09/2026).
 *
 * GET /api/groups/[id]/field-suggestions?fieldId=xxx
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

    // §5.3 quy tắc 2 (usedFor) — cùng chặn đã áp dụng lúc gửi đề xuất thật ở
    // app/api/requests/route.ts: không nằm trong phạm vi "Sử dụng cho" của
    // nhóm thì không được đọc bất cứ gì của nhóm này, kể cả gợi ý.
    if (!isWithinUsedForScope(group.usedFor, { userId: session.uid, groupIds: [] })) {
      return NextResponse.json(
        { error: "Bạn không nằm trong phạm vi sử dụng của nhóm đề xuất này." },
        { status: 403 },
      );
    }

    // Chỉ phục vụ đúng field đã được Admin/Owner nhóm BẬT gợi ý — suggestFromHistory
    // là cờ cấu hình phía server, không chỉ là gợi ý UI phía client; không kiểm ở
    // đây thì ai cũng có thể đổi fieldId trên DevTools để dò giá trị field khác.
    const field = group.fields?.find((f) => f.id === fieldId);
    if (!field || field.dataType !== "short_text" || !field.suggestFromHistory) {
      return NextResponse.json({ error: "Trường này chưa bật gợi ý từ lịch sử." }, { status: 403 });
    }

    const suggestions = await loadSuggestionsCached(groupId, fieldId, session.uid, session.role);
    return NextResponse.json({ suggestions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
