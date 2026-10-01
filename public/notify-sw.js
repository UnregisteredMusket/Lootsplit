self.addEventListener("push", (event) => {
  event.waitUntil(self.registration.showNotification("New Lootsplit message", {
    body: "Open Multiplayer to read your party’s messages.",
    icon: "/favicon.svg",
    tag: "lootsplit-chat",
    data: { url: "/share?chat=1" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("/share?chat=1", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
    const open = list.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) { await open.navigate(target); return open.focus(); }
    return self.clients.openWindow(target);
  }));
});
