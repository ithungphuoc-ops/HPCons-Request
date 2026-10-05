import { NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/http";
import { layViecGanDay } from "@/lib/dong-bo/hang-cho";
import type { TrangThaiViec } from "@/lib/dong-bo/luat";
import { canManageGroupsAtAppScope } from "@/lib/permissions";
import { requireSession } from "@/lib/session";

/**
 * ★ Danh sách việc đồng bộ Kho / Thu mua cho trang "Lịch sử Webhook" (chỉ Owner / Admin) — đợt 1
 * "liên kết 4 app" (03/10/2026).  GET /api/dong-bo?trangThai=dung|cho|da_gui|huy
 */
const HOP_LE: readonly TrangThaiViec[] = ["cho", "da_gui", "dung", "huy"];

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    if (!canManageGroupsAtAppScope(session.role)) {
      return NextResponse.json({ error: "Chỉ Owner / Admin mới xem được." }, { status: 403 });
    }
    const tt = new URL(request.url).searchParams.get("trangThai");
    const trangThai = tt && (HOP_LE as readonly string[]).includes(tt) ? (tt as TrangThaiViec) : undefined;
    const viec = await layViecGanDay(trangThai, 150);
    return NextResponse.json({
      viec: viec.map((v) => ({
        id: v.id,
        requestId: v.requestId,
        requestCode: v.requestCode,
        dich: v.dich,
        loai: v.loai,
        nguoi: v.nguoi,
        trangThai: v.trangThai,
        soLanThu: v.soLanThu,
        taoLuc: v.taoLuc,
        henLuc: v.henLuc ?? null,
        xongLuc: v.xongLuc ?? null,
        capNhatLuc: v.capNhatLuc,
        loi: v.loi ?? null,
        ketQua: v.ketQua ?? null,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
