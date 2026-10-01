self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("/share", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((client) => client.url.startsWith(self.location.origin));
      if (open) {
        open.focus();
        return;
      }
      return self.clients.openWindow(target);
    }),
  );
});
