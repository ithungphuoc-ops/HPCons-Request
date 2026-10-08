import { NextResponse } from "next/server";
import { HPCORE_PUSH_SETTINGS_URL } from "@/lib/constants";

/**
 * NGỪNG DÙNG (08/10/2026): thông báo ra màn hình chuyển sang App Tổng. Giữ route 1 bản phát
 * hành cho trang cũ còn mở — luôn trả "chưa đăng ký" và chỉ sang trang cài đặt mới.
 */
export async function POST() {
  return NextResponse.json({ registered: false, deprecated: true, settingsUrl: HPCORE_PUSH_SETTINGS_URL });
}
