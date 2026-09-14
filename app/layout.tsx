import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

// Chữ chính: Inter theo HPCons Design System V1.1 (Phần D). BẮT BUỘC khai
// subset "vietnamese" — thiếu nó thì chữ có dấu rơi về font dự phòng, mỗi
// dòng lẫn 2 bộ chữ nhìn rất lệch.
//
// Trước 14/09/2026 app khai Geist Sans nhưng globals.css lại ép body dùng
// Arial, nên Geist Sans được TẢI VỀ MÀ KHÔNG DÙNG Ở ĐÂU. Nay bỏ hẳn.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "vietnamese"],
  display: "swap",
});

// Geist Mono thì KHÁC — nó đang được dùng thật qua tiện ích `font-mono`
// (mã đề nghị ở RequestDetailView, mã trường trong mẫu in). Giữ nguyên.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Base Request",
  description: "Giao diện thiết lập Base Request",
  icons: { icon: "/logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className="h-full">
      <body
        className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      >
        {children}
        {/* Bong bóng góp ý/báo lỗi xuyên suốt hệ sinh thái (27/07/2026) — file
            phục vụ từ app tổng, đọc cookie SSO .hpcore.vn có sẵn để xác
            thực, không cần code riêng ở đây ngoài đúng 1 dòng này. */}
        <script src="https://account.hpcore.vn/feedback-widget.js" data-app="Đề xuất" async />
        {/* Bong bóng AI hướng dẫn (thí điểm, 27/07/2026) — widget RIÊNG, tách
            biệt hoàn toàn với feedback-widget.js phía trên (xem change
            cross-app-ai-guide-widget ở repo hpcons-portal). */}
        <script src="https://account.hpcore.vn/ai-guide-widget.js" data-app="Đề xuất" async />
      </body>
    </html>
  );
}
