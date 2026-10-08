/*
 * Service worker CHỈ để nhận thông báo "ra màn hình" (Web Push — cấp 3, Sếp duyệt
 * 08/10/2026). CỐ Ý không cache gì, không chặn fetch — app vẫn chạy y như trước, chỉ thêm
 * khả năng hiện thông báo khi tab đã đóng.
 *
 * Nội dung thư do máy chủ dựng sẵn (lib/web-push-payload.ts) — đã lọc: không số tiền,
 * không bình luận, không tên đề xuất người dùng gõ.
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
    actions: [{ action: "open", title: "Mở đề xuất" }],
  };
  // Sếp chốt (quyết định 3): LUÔN hiện, kể cả khi đang mở app.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/request", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Ưu tiên tab app đang mở cùng tên miền: đưa lên trước rồi chuyển tới đúng đề xuất.
      for (const client of list) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        try {
          const focused = await client.focus();
          if (focused && "navigate" in focused) await focused.navigate(target);
          return;
        } catch {
          // Tab không cho điều khiển (vd chưa do SW này quản) → thử tab khác / mở cửa sổ mới.
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
