import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { guiLaiNgay, layViecCuaDeXuat, type ViecDongBo } from "@/lib/dong-bo/hang-cho";
import { canManageGroupsAtAppScope } from "@/lib/permissions";
import { canView, loadRequest } from "@/lib/server/requests";
import { requireSession } from "@/lib/session";

/**
 * ★ Tình trạng đồng bộ 1 đề xuất sang Kho / Thu mua — đợt 1 "liên kết 4 app" (03/10/2026).
 *   GET  → danh sách việc trong hàng chờ của đề xuất (ai xem được đề xuất thì xem được).
 *   POST { viecId } → "Gửi lại ngay" việc đã dừng (chỉ Owner / Admin).
 */
export const maxDuration = 60;

function rutGon(v: ViecDongBo) {
  return {
    id: v.id,
    dich: v.dich,
    loai: v.loai,
    trangThai: v.trangThai,
    soLanThu: v.soLanThu,
    taoLuc: v.taoLuc,
    henLuc: v.henLuc ?? null,
    xongLuc: v.xongLuc ?? null,
    capNhatLuc: v.capNhatLuc,
    loi: v.loi ?? null,
    ketQua: v.ketQua ?? null,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const found = await loadRequest(id);
    if (!found) return NextResponse.json({ error: "Không tìm thấy đề xuất." }, { status: 404 });
    if (!canView(found, session.uid, session.role)) {
      return NextResponse.json({ error: "Bạn không có quyền xem đề xuất này." }, { status: 403 });
    }
    const viec = await layViecCuaDeXuat(id);
    return NextResponse.json({ viec: viec.map(rutGon), coTheGuiLai: canManageGroupsAtAppScope(session.role) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    if (!canManageGroupsAtAppScope(session.role)) {
      return NextResponse.json({ error: "Chỉ Owner / Admin mới gửi lại được." }, { status: 403 });
    }
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { viecId?: unknown };
    const viecId = typeof body.viecId === "string" ? body.viecId : "";
    const cuaDeXuat = await layViecCuaDeXuat(id);
    if (!viecId || !cuaDeXuat.some((v) => v.id === viecId)) {
      return NextResponse.json({ error: "Không tìm thấy việc cần gửi lại." }, { status: 404 });
    }
    const ketQua = await guiLaiNgay(viecId);
    if (ketQua === "khong_hop_le") {
      return NextResponse.json({ error: "Việc này đã gửi xong hoặc đã huỷ, không cần gửi lại." }, { status: 400 });
    }
    const viec = await layViecCuaDeXuat(id);
    return NextResponse.json({ ketQua, viec: viec.map(rutGon), coTheGuiLai: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
