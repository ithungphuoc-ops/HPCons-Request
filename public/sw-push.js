/*
 * Service worker CHỈ để nhận thông báo "ra màn hình" (Web Push — cấp 3, Sếp duyệt
 * 08/10/2026). CỐ Ý không cache gì, không chặn fetch — app vẫn chạy y như trước, chỉ thêm
 * khả năng hiện thông báo khi tab đã đóng.
 *
 * Nội dung thư do máy chủ dựng sẵn (lib/web-push-payload.ts) — tiêu đề có biểu tượng,
 * thân 2 dòng (trích bình luận/lý do/tên đề xuất + mã · nhóm), chữ trên nút theo từng loại.
 */

self.addEventListener("install", () => {
  // Bản SW mới thay bản cũ ngay, không đợi đóng hết tab.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || "HPCore Đề xuất";
  const options = {
    body: data.body || "Có cập nhật mới trong app Đề xuất.",
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    // Cùng 1 đề xuất → thông báo mới THAY cái cũ; renotify để vẫn kêu/rung lại.
    tag: data.tag || "hpcore-de-xuat",
    renotify: !!data.tag,
    data: { url: data.url || "/request" },
    // Chữ nút theo loại: "Mở để duyệt" / "Sửa và gửi lại" / "Mở đề xuất" (máy chủ chọn sẵn).
    actions: [{ action: "open", title: typeof data.actionTitle === "string" && data.actionTitle ? data.actionTitle.slice(0, 40) : "Mở đề xuất" }],
  };
  // Sếp chốt (quyết định 3): LUÔN hiện, kể cả khi đang mở app.
  event.waitUntil(self.registration.showNotification(title, options));
});

/** Chỉ mở đường dẫn CÙNG tên miền app — thư lạ/hỏng thì về trang chính của app. */
function safeTarget(raw) {
  try {
    const url = new URL(raw || "/request", self.location.origin);
    if (url.origin === self.location.origin) return url;
  } catch {
    // Đường dẫn hỏng → dùng mặc định bên dưới.
  }
  return new URL("/request", self.location.origin);
}

function samePage(a, b) {
  return a.origin === b.origin && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "") && a.search === b.search;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeTarget(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // CHỈ dùng lại tab ĐANG MỞ ĐÚNG đề xuất đó (đưa lên trước). KHÔNG điều hướng tab khác —
      // tab đó có thể đang gõ dở bình luận/đề xuất, chuyển trang là mất chữ.
      const existing = list.find((client) => {
        try {
          return samePage(new URL(client.url), target);
        } catch {
          return false;
        }
      });
      if (existing) {
        try {
          await existing.focus();
          return;
        } catch {
          // Không đưa lên được (trình duyệt chặn) → mở cửa sổ mới bên dưới, đúng 1 lần.
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
