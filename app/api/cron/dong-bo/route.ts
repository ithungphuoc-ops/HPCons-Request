import { NextResponse } from "next/server";
import { quetHangDem } from "@/lib/dong-bo/hang-cho";

/**
 * ★ QUÉT HẰNG ĐÊM hàng chờ đồng bộ Kho / Thu mua — đợt 1 "liên kết 4 app" (Sếp chốt 03/10/2026).
 *
 * Vercel Cron gọi lúc 19:00 UTC = 2:00 sáng giờ VN (khai trong vercel.json). Gói miễn phí chỉ cho
 * cron 1 lần/ngày nên đây là lưới vét cuối: gửi mọi việc còn chờ, việc quá 1 ngày vẫn lỗi thì dừng +
 * báo. Đường gửi lại chính trong ngày là `quetViecToiHan()` chạy kèm API người dùng mở.
 *
 * 🔐 BẮT BUỘC khai biến CRON_SECRET trên Vercel (chuỗi ngẫu nhiên bất kỳ) — Vercel tự gửi header
 * `Authorization: Bearer <CRON_SECRET>` khi chạy cron. Chưa khai thì route TỪ CHỐI (QA 03/10: để mở
 * thì ai biết địa chỉ cũng gọi được, bỏ qua giờ hẹn và đốt hết 5 lượt gửi lại của mọi việc).
 */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron/dong-bo] chưa khai CRON_SECRET — bỏ qua lượt quét đêm.");
    return NextResponse.json({ error: "Chưa cấu hình CRON_SECRET." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Không có quyền." }, { status: 401 });
  }
  try {
    const ketQua = await quetHangDem();
    return NextResponse.json({ ok: true, ...ketQua });
  } catch (err) {
    console.error("[cron/dong-bo] lỗi:", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
