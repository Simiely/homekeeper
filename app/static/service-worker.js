// HomeKeeper Service Worker - 接收 Web Push 通知
self.addEventListener("push", (event) => {
  let data = { title: "📦 物管家", body: "" };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch {
    // 非 JSON 格式，使用默认值
  }

  const options = {
    body: data.body,
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    vibrate: [200, 100, 200],
    data: { url: "/" },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // 如果已有打开的窗口，聚焦到它
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      // 否则打开新窗口
      return clients.openWindow(url);
    })
  );
});
