import type { MetadataRoute } from "next";

/**
 * Web app manifest (Web Push 08/10/2026). Cần cho iPhone: Safari CHỈ cho nhận thông báo
 * ra màn hình khi app được "Thêm vào Màn hình chính" (iOS 16.4+) và mở ở chế độ
 * `standalone`. Android/Chrome máy tính cũng dùng để cài app như ứng dụng riêng.
 * Phục vụ ở /manifest.webmanifest — ngoài matcher của middleware nên không bị đòi đăng nhập.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HPCore Đề xuất",
    short_name: "Đề xuất",
    description: "Gửi, duyệt và theo dõi đề xuất HP Cons",
    start_url: "/request",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#096AA7",
    lang: "vi",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
