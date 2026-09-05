import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { apiErrorResponse } from "@/lib/http";
import { ensureApproverStepCodes, ensureFieldCodes } from "@/lib/server/groups";
import { duplicatePrintTemplates } from "@/lib/server/print-templates";
import { requireWriteAccess } from "@/lib/session";
import { sanitizeDescriptionHtml } from "@/lib/validation";
import type { ProposalGroup } from "@/lib/types";

/**
 * Nhân bản nhóm đề xuất — chép cấu hình (trường, bước duyệt, người theo dõi,
 * mẫu in, webhook, quyền, thông báo...) sang 1 nhóm mới, để Admin dùng làm
 * điểm khởi đầu chỉnh sửa thay vì dựng lại từ đầu mỗi lần cần 1 nhóm tương tự
 * (Sếp yêu cầu 04/09/2026).
 *
 * Liệt kê TỪNG field một (allowlist tường minh) thay vì spread nguyên
 * `sourceData` rồi override vài field — CỐ Ý khớp đúng phong cách
 * app/api/requests/[id]/duplicate/route.ts (agent review phát hiện bản đầu
 * dùng spread-rồi-override, khác hẳn route liền kề): khi `ProposalGroup`
 * thêm field mới sau này, TypeScript báo lỗi "thiếu property" ngay tại đây,
 * buộc người viết phải QUYẾT ĐỊNH tường minh chép hay reset field đó, thay vì
 * âm thầm kế thừa hành vi mặc định (spread) rồi phải tự nhớ rà lại.
 *
 * Nhóm mới LUÔN tạo ở trạng thái "closed" — khác trạng thái nhóm nguồn, cố ý:
 * tránh có 2 nhóm cấu hình y hệt nhau cùng "active" ngay lập tức, khiến nhân
 * viên lỡ gửi nhầm vào bản vừa nhân bản trước khi Admin kịp đổi tên/chỉnh sửa.
 * Admin tự bật lại ở Thiết lập chung khi đã sẵn sàng.
 *
 * `useOwnCounter` (nếu bật) không cần xử lý riêng — bộ đếm khoá theo ID nhóm
 * (`counters/group_{groupId}`, xem generateGroupRequestCode() trong
 * lib/server/requests.ts), nhóm mới có ID mới nên tự động có bộ đếm riêng từ
 * số 1, không đụng số của nhóm nguồn.
 *
 * Mẫu in (subcollection `groups/{id}/printTemplates`) KHÔNG nằm trong
 * document `groups/{id}` nên phải copy riêng, kèm copy cả file trong R2 sang
 * path mới — xem duplicatePrintTemplates(), gọi SAU khi tạo xong nhóm mới.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireWriteAccess();
    const { id } = await params;

    const sourceSnap = await adminDb.collection("groups").doc(id).get();
    if (!sourceSnap.exists) {
      return NextResponse.json({ error: "Không tìm thấy nhóm đề xuất." }, { status: 404 });
    }
    const source = { id: sourceSnap.id, ...sourceSnap.data() } as ProposalGroup;

    // Tự vá thiếu `code` cho fields/approverSteps trước khi chép — cùng lưới
    // an toàn GET /api/groups đã áp dụng, phòng trường hợp route này được gọi
    // trên 1 nhóm dữ liệu cũ chưa từng qua GET (nên chưa được backfill).
    const { fields } = ensureFieldCodes(source.fields);
    const { steps: approverSteps } = ensureApproverStepCodes(source.approverSteps ?? []);

    const groupRef = adminDb.collection("groups").doc();
    const duplicate: Omit<ProposalGroup, "id"> = {
      name: `${source.name} (Bản sao)`,
      description: source.description,
      descriptionHtml:
        source.descriptionHtml !== undefined ? sanitizeDescriptionHtml(source.descriptionHtml) : undefined,
      category: source.category,
      // Reset — trạng thái workflow của bản sao, KHÔNG kế thừa nhóm nguồn (xem giải thích ở trên).
      status: "closed",
      approvalFlow: source.approvalFlow,
      slaHours: source.slaHours,
      notifyManager: source.notifyManager,
      usedFor: JSON.parse(JSON.stringify(source.usedFor)),
      approverSteps: JSON.parse(JSON.stringify(approverSteps)),
      followers: JSON.parse(JSON.stringify(source.followers)),
      followersConditional: source.followersConditional
        ? JSON.parse(JSON.stringify(source.followersConditional))
        : undefined,
      fields: JSON.parse(JSON.stringify(fields)),
      // Reset — không kế thừa trạng thái ghim của nhóm nguồn.
      pinned: false,
      // Reset — ngày tạo THẬT của bản sao, cùng định dạng "chỉ ngày" với
      // POST /api/groups (khác định dạng sẽ làm lệch thứ tự orderBy("createdAt")
      // khi Firestore so sánh chuỗi giữa 2 định dạng).
      createdAt: new Date().toISOString().slice(0, 10),
      printFooterNote: source.printFooterNote,
      printRequireFullyApproved: source.printRequireFullyApproved,
      requiresSubmissionForm: source.requiresSubmissionForm,
      approverSlaEnabled: source.approverSlaEnabled,
      slaByWorkCalendar: source.slaByWorkCalendar,
      requireDecisionNote: source.requireDecisionNote
        ? JSON.parse(JSON.stringify(source.requireDecisionNote))
        : undefined,
      useOwnCounter: source.useOwnCounter,
      // Reset — người nhân bản là "người tạo" của bản sao, không phải người tạo nhóm gốc.
      createdBy: { uid: session.uid, name: session.name },
      approvalTimeFields: source.approvalTimeFields
        ? JSON.parse(JSON.stringify(source.approvalTimeFields))
        : undefined,
      permissionRules: source.permissionRules ? JSON.parse(JSON.stringify(source.permissionRules)) : undefined,
      notificationRules: source.notificationRules
        ? JSON.parse(JSON.stringify(source.notificationRules))
        : undefined,
      printOptions: source.printOptions ? JSON.parse(JSON.stringify(source.printOptions)) : undefined,
    };

    try {
      // groupRef.set() nằm CHUNG try/catch với duplicatePrintTemplates() —
      // không tách riêng — vì cùng 1 lý do "lỗi mập mờ" (ambiguous failure)
      // đã áp dụng ở duplicatePrintTemplates(): nếu chính groupRef.set() lỗi
      // ở phía client nhưng document ĐÃ được ghi thành công ở Firestore
      // (timeout/mất mạng, không đồng nghĩa lỗi server), phải rollback xoá
      // nốt — nếu tách riêng, trường hợp đó sẽ để lại 1 nhóm mồ côi vĩnh
      // viễn không bao giờ được dọn (CodeRabbit phát hiện).
      await groupRef.set(duplicate);
      await duplicatePrintTemplates(id, groupRef.id, { uid: session.uid, name: session.name });
    } catch (templateError) {
      // Rollback — KHÔNG được để nhóm mới tồn tại mà thiếu mẫu in trong khi
      // client nhận về 201 "thành công" (duplicatePrintTemplates() đã tự
      // dọn lại các file R2/document lỡ copy dở của chính nó, ở đây chỉ cần
      // xoá nốt document nhóm mới — .delete() trên 1 document CHƯA từng
      // được tạo là vô hại, không cần kiểm tra exists trước).
      await groupRef.delete().catch(() => {});
      throw templateError;
    }

    return NextResponse.json({ group: { id: groupRef.id, ...duplicate } }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
