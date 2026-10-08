import "server-only";
import { NextResponse } from "next/server";
import { CURRENT_APP_HOST } from "@/lib/constants";

/**
 * Chặn gọi chéo trang (CSRF) cho các API thông báo ra màn hình có GHI dữ liệu: chỉ nhận
 * JSON (form HTML của trang lạ không gửi được `application/json` nếu không qua CORS) và
 * header `Origin` phải đúng tên miền của chính app. Cookie SSO dùng chung *.hpcore.vn nên
 * không thể chỉ dựa vào cookie.
 */
const APP_ORIGIN = `https://${CURRENT_APP_HOST}`;

function allowedOrigins(request: Request): Set<string> {
  const out = new Set<string>([APP_ORIGIN]);
  try {
    out.add(new URL(request.url).origin);
  } catch {
    // request.url lạ — bỏ qua, vẫn còn APP_ORIGIN.
  }
  // Sau proxy (Vercel) host thật nằm ở x-forwarded-host / host.
  for (const h of [request.headers.get("x-forwarded-host"), request.headers.get("host")]) {
    if (h) {
      out.add(`https://${h}`);
      if (process.env.NODE_ENV !== "production") out.add(`http://${h}`);
    }
  }
  return out;
}

/** Trả response lỗi nếu không hợp lệ, null nếu cho qua. */
export function rejectUnlessJsonSameOrigin(request: Request): NextResponse | null {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    return NextResponse.json({ error: "Yêu cầu phải là JSON." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(request).has(origin)) {
    return NextResponse.json({ error: "Không cho phép gọi từ trang khác." }, { status: 403 });
  }
  return null;
}
