import { NextResponse } from "next/server";
import { HPCORE_PUSH_SETTINGS_URL, PUSH_MOVED_MESSAGE } from "@/lib/constants";

/**
 * NGỪNG DÙNG (08/10/2026): công tắc thông báo ra màn hình giờ nằm ở App Tổng
 * (apps.de_xuat, kinds.de_xuat[...]). Giữ route 1 bản phát hành cho trang cũ còn mở:
 * GET báo tính năng tại chỗ đã tắt; PATCH trả 410.
 */
export async function GET() {
  return NextResponse.json({ enabled: false, deprecated: true, settingsUrl: HPCORE_PUSH_SETTINGS_URL });
}

export async function PATCH() {
  return NextResponse.json({ error: `${PUSH_MOVED_MESSAGE}.`, settingsUrl: HPCORE_PUSH_SETTINGS_URL }, { status: 410 });
}
