import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { TAG_HOP_DONG_CONG_NO, TAG_NHA_THAU_PHU_CONG_NO } from "@/lib/congno";

export const dynamic = "force-dynamic";

/**
 * ★ (03/10/2026, Sếp chốt — đợt 2 "liên kết 4 app", L20) App Công nợ thêm / sửa / xoá hợp đồng hoặc nhà
 * thầu phụ thì máy chủ Công nợ báo sang đây → xoá bản nhớ tạm danh sách tương ứng, lần gõ số hợp đồng /
 * chọn nhà thầu kế tiếp đọc dữ liệu mới. Không nhận dữ liệu nào — chỉ là tín hiệu "có thay đổi".
 *   POST /api/cong-no/co-thay-doi   body: { doiTuong?: ("hop_dong" | "nha_thau_phu")[] }
 * Khoá: header x-api-key so với CONGNO_WEBHOOK_KEY (bên Công nợ gửi bằng REQUEST_APP_WEBHOOK_KEY).
 * Chưa khai khoá → cổng đóng, trả loaiLoi "vinh_vien" để Công nợ dừng + báo Admin (nhớ tạm khi đó tự
 * giữ 5 phút như cũ — xem NHO_TAM_CONG_NO_GIAY).
 */
export async function POST(request: Request) {
  const khoa = process.env.CONGNO_WEBHOOK_KEY;
  if (!khoa) {
    return NextResponse.json(
      { ok: false, loaiLoi: "vinh_vien", error: "App Đề xuất chưa khai CONGNO_WEBHOOK_KEY — cổng nhận báo từ Công nợ đang đóng." },
      { status: 503 },
    );
  }
  if (request.headers.get("x-api-key") !== khoa) {
    return NextResponse.json({ ok: false, loaiLoi: "vinh_vien", error: "Thiếu hoặc sai x-api-key." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { doiTuong?: unknown };
  const doiTuong = Array.isArray(body.doiTuong) ? body.doiTuong : [];
  // Không nói rõ thay đổi gì → xoá cả 2 cho chắc (chỉ tốn thêm 1 lượt đọc lần dùng kế tiếp).
  const xoaHopDong = doiTuong.length === 0 || doiTuong.includes("hop_dong");
  const xoaNhaThau = doiTuong.length === 0 || doiTuong.includes("nha_thau_phu");
  if (xoaHopDong) revalidateTag(TAG_HOP_DONG_CONG_NO);
  if (xoaNhaThau) revalidateTag(TAG_NHA_THAU_PHU_CONG_NO);
  return NextResponse.json({ ok: true, daLamMoi: { hopDong: xoaHopDong, nhaThauPhu: xoaNhaThau } });
}
