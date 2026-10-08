import { NextResponse } from "next/server";
import { HPCORE_PUSH_SETTINGS_URL, PUSH_MOVED_MESSAGE } from "@/lib/constants";

/** NGỪNG DÙNG (08/10/2026): "Gửi thử" giờ ở trang cài đặt thông báo ra màn hình của App Tổng. */
export async function POST() {
  return NextResponse.json(
    { error: `${PUSH_MOVED_MESSAGE}. Mở App Tổng để bật và gửi thử.`, settingsUrl: HPCORE_PUSH_SETTINGS_URL },
    { status: 410 },
  );
}
