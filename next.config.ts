import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Service worker thông báo ra màn hình (public/sw-push.js, Web Push 08/10/2026): KHÔNG cho
  // trình duyệt/CDN giữ bản cũ — sửa SW mà máy người dùng còn bản cũ thì lỗi khó dò.
  async headers() {
    return [
      {
        source: "/sw-push.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
