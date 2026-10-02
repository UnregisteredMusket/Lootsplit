import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell } from "lucide-react";
import { Button } from "./ui";
import { getCloudTable, subscribeCloudTable, roomCredentials } from "@/lib/quire/cloud-client";
import { getRoomPushSettings, updateRoomPushSubscription } from "@/lib/quire/cloud-api";

export function PushNotices() {
  const room = useSyncExternalStore(subscribeCloudTable, getCloudTable, getCloudTable);
  const native = import.meta.env.VITE_MOBILE === "true";
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState(
    "Receive new-message alerts even when the website is closed. Message text stays out of notifications.",
  );
  useEffect(() => {
    let cancelled = false;
    setEnabled(false);
    if (native || !room.joined || !("serviceWorker" in navigator) || !("PushManager" in window))
      return;
    void (async () => {
      const reg = await navigator.serviceWorker.getRegistration("/notify-sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        const config = await getRoomPushSettings({
          data: { ...roomCredentials(), endpoint: sub.endpoint },
        });
        if (!cancelled) setEnabled(config.subscribed);
      }
    })().catch(() => {
      if (!cancelled)
        setHint("Could not check notification status. Try enabling again when connected.");
    });
    return () => {
      cancelled = true;
    };
  }, [room.code, room.seatId, room.joined]);
  async function toggle() {
    setBusy(true);
    try {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      )
        throw new Error(
          "This browser does not support background push. Try the website in Chrome, or install it to your home screen.",
        );
      if (!enabled && Notification.permission !== "granted") {
        const allowed = await Notification.requestPermission();
        if (allowed !== "granted")
          throw new Error(
            "Notifications weren’t allowed. You can change that in this website’s browser settings.",
          );
      }
      const reg = await navigator.serviceWorker.register("/notify-sw.js");
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (enabled) {
        if (sub)
          await updateRoomPushSubscription({
            data: { ...roomCredentials(), endpoint: sub.endpoint, enabled: false },
          });
        setEnabled(false);
        setHint("Background alerts are off for this room on this device.");
        return;
      }
      const config = await getRoomPushSettings({ data: roomCredentials() });
      if (!config.available)
        throw new Error("Background push is not available on this deployment.");
      if (!sub) {
        const key = Uint8Array.from(
          atob(config.publicKey.replaceAll("-", "+").replaceAll("_", "/")),
          (c) => c.charCodeAt(0),
        );
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await updateRoomPushSubscription({
        data: { ...roomCredentials(), endpoint: sub.endpoint, enabled: true },
      });
      setEnabled(true);
      setHint(
        "Background message alerts are enabled for this room on this device. Delivery depends on your browser and phone settings.",
      );
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Could not enable background notifications.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mb-5 border-b border-border pb-5">
      <h3 className="text-xl">Background message alerts</h3>
      <p className="mt-2 text-sm text-muted" role="status">
        {native
          ? "Background push is available on the website in a supported browser. This Android app does not yet receive native push while closed. Live chat remains available while connected."
          : room.joined
            ? hint
            : "Join a room to enable background message alerts."}
      </p>
      <Button
        className="mt-3"
        variant="secondary"
        disabled={native || !room.joined || busy}
        onClick={() => void toggle()}
      >
        <Bell size={16} />
        {busy
          ? "Please wait…"
          : enabled
            ? "Turn off background alerts"
            : "Enable background alerts"}
      </Button>
    </div>
  );
}
