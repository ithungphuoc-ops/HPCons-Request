import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getHpcoreDb } from "@/lib/hpcore";
import { apiErrorResponse } from "@/lib/http";
import { getCachedDepartments } from "@/lib/server/hpcore-org";
import { requireSession, requireWriteAccess } from "@/lib/session";

/**
 * Phòng ban App Tổng (departments) cho trình duyệt — thay endpoint public
 * "Nhóm thành viên" (account.hpcore.vn/api/member-groups/public) đã bỏ
 * 03/10/2026. Dùng cho ô "Chọn bộ phận" (department_select) và cây chọn
 * nhóm của "Phạm vi sử dụng". Yêu cầu đăng nhập.
 *
 * `?members=1` (CHỈ Owner/Admin — người cấu hình nhóm đề xuất): kèm đơn vị
 * chính/kiêm nhiệm của từng người đang hoạt động để giao diện đếm "số người
 * trong phạm vi" ngay trên trình duyệt, không cần gọi lại máy chủ mỗi lần tick.
 */
const getCachedMembers = unstable_cache(
  async (): Promise<{ uid: string; departmentId: string | null; secondaryDepartmentIds: string[] }[]> => {
    const snap = await getHpcoreDb().collection("users").where("isActive", "==", true).get();
    return snap.docs.map((doc) => {
      const data = doc.data() as { departmentId?: unknown; secondaryDepartmentIds?: unknown };
      return {
        uid: doc.id,
        departmentId: typeof data.departmentId === "string" && data.departmentId ? data.departmentId : null,
        secondaryDepartmentIds: Array.isArray(data.secondaryDepartmentIds)
          ? data.secondaryDepartmentIds.filter((v): v is string => typeof v === "string" && v !== "")
          : [],
      };
    });
  },
  ["request-department-members"],
  { revalidate: 60 },
);

export async function GET(request: NextRequest) {
  try {
    const wantsMembers = request.nextUrl.searchParams.get("members") === "1";
    if (wantsMembers) await requireWriteAccess();
    else await requireSession();

    const departments = (await getCachedDepartments()).map(({ id, name, parentId }) => ({ id, name, parentId }));
    if (!wantsMembers) return NextResponse.json({ departments });
    const members = await getCachedMembers();
    return NextResponse.json({ departments, members });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
