"use client";

import { useEffect, useRef, useState } from "react";

/** Liên kết trong tệp Word do NGƯỜI KHÁC tải lên: chỉ giữ http(s)/mailto/neo nội bộ (mở tab
 * mới), bỏ mọi kiểu khác (vd `javascript:`) để bấm vào không chạy được gì trong app. */
function neutralizeLinks(root: ParentNode) {
  for (const a of Array.from(root.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    } else if (!href.startsWith("#")) {
      a.removeAttribute("href");
    }
  }
}

/**
 * Xem nhanh Word (.docx) trong popup tệp đính kèm — từng trang như Word: chữ, bảng, căn lề,
 * logo ở đầu trang, ảnh trong nội dung, số trang (thư viện docx-preview, chỉ tải khi mở tệp
 * Word). Chỉ xem, không sửa; bố cục phức tạp có thể lệch đôi chút so với Word — cần đúng
 * 100% thì "Tải về". Word đời cũ .doc không đọc được (FilePreviewModal báo riêng).
 * Sếp chốt 02/10/2026.
 *
 * 🔴 Tệp Word là nội dung NGƯỜI KHÁC tải lên — QA 02/10/2026 tái hiện được 2 lỗ hổng, đã chặn:
 *  1. `renderAltChunks` (mặc định BẬT trong docx-preview) đặt HTML nhúng trong tệp vào
 *     <iframe srcdoc> không sandbox → chạy được script, đọc cookie của app. TẮT hẳn.
 *  2. Style trong tệp được chép nguyên vào <style> → áp lên CẢ trang app (vd `html{…}`).
 *     Dựng toàn bộ nội dung trong Shadow DOM (style chỉ có hiệu lực bên trong), khung
 *     chứa có `contain: layout paint` để kể cả `position: fixed`/`:host` trong tệp cũng
 *     không vẽ đè ra ngoài khung xem. Bỏ font nhúng (`ignoreFonts`) — @font-face trong
 *     Shadow DOM không dùng được, font tiếng Việt thông dụng đã có sẵn trên máy.
 */
export default function WordPreview({ data }: { data: ArrayBuffer }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    setState("loading");
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const styles = document.createElement("div");
    const body = document.createElement("div");
    shadow.replaceChildren(styles, body);
    (async () => {
      try {
        const { renderAsync } = await import("docx-preview");
        if (cancelled) return;
        await renderAsync(data, body, styles, {
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          renderHeaders: true,
          renderFooters: true,
          renderAltChunks: false,
          ignoreFonts: true,
          // Ảnh nhúng dạng data: URL — không phải tự thu hồi object URL khi đóng popup.
          useBase64URL: true,
        });
        if (cancelled) return;
        neutralizeLinks(body);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      shadow.replaceChildren();
    };
  }, [data]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[3px] border border-[var(--color-border)]">
      {state !== "ready" && (
        <p className="absolute inset-0 z-10 flex items-center justify-center bg-white px-6 text-center text-[14px] text-gray-400 dark:bg-[var(--color-card-bg)]">
          {state === "loading"
            ? "Đang mở tệp…"
            : 'Không đọc được nội dung tệp (có thể tệp bị hỏng hoặc có mật khẩu). Bấm "Tải về" để xem trên máy.'}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-[#e5e7eb]" style={{ contain: "layout paint" }}>
        <div ref={hostRef} />
      </div>
    </div>
  );
}
