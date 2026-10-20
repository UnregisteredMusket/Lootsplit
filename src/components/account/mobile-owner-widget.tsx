import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { App } from "@capacitor/app";
import { ShieldCheck, Smartphone } from "lucide-react";
import {
  connectOwnerWidget,
  disconnectOwnerWidget,
  hasOwnerWidget,
  OwnerWidget,
  type OwnerWidgetStatus,
} from "@/lib/mobile/owner-widget";
import { allowContextChange } from "@/lib/quire/use-draft-guard";

/** A widget tap uses the existing router and preserves the running app's draft guards. */
export function MobileOwnerWidgetBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!hasOwnerWidget()) return;
    let alive = true;
    const open = async () => {
      try {
        const request = await OwnerWidget.consumeOpenRequest();
        if (alive && request.open && allowContextChange())
          await navigate({ to: "/account", hash: "home-screen-widget" });
      } catch {
        // The launcher action is optional and never blocks normal app startup.
      }
    };
    void open();
    const resumed = App.addListener("resume", () => void open());
    window.addEventListener("lootsplit-open-owner-widget", open);
    return () => {
      alive = false;
      window.removeEventListener("lootsplit-open-owner-widget", open);
      void resumed.then((listener) => listener.remove());
    };
  }, [navigate]);
  return null;
}

export function MobileOwnerWidget({ name, email }: { name: string; email: string }) {
  const [status, setStatus] = useState<OwnerWidgetStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const supported = hasOwnerWidget();
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    const read = () =>
      void OwnerWidget.status()
        .then((next) => {
          if (alive) setStatus(next);
        })
        .catch(() => {
          if (alive) setMessage("Widget controls are unavailable. Reopen the app to try again.");
        });
    read();
    const resumed = App.addListener("resume", read);
    return () => {
      alive = false;
      void resumed.then((listener) => listener.remove());
    };
  }, [supported]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setStatus(await OwnerWidget.status());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Widget action could not finish.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id="home-screen-widget"
      className="portal-card space-y-3"
      aria-labelledby="mobile-widget-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="mobile-widget-title" className="flex items-center gap-2 font-semibold">
            <Smartphone size={18} /> Home-screen Field monitor
          </h2>
          <p className="mt-1 flex items-center gap-2 text-sm">
            <ShieldCheck size={15} /> Owner access
          </p>
          <p className="break-words font-medium">{name}</p>
          <p className="break-all text-sm text-muted">{email}</p>
        </div>
      </div>
      <p className="text-sm text-muted">
        Add the green terminal widget to your Android home screen for service checks, account
        activity, app analytics and recent GitHub deployment activity. Resize it vertically for full
        or compact details.
      </p>
      <p className="text-sm text-muted">
        Readings are dated. Android requests background checks about every 30 minutes and may delay
        them to save battery; tap Refresh when you need a new check. Provider data may be cached for
        five minutes. Unconnected Cloudflare traffic stays labeled.
      </p>
      <p className="text-sm text-muted">
        Your name, email and private totals will be visible on your home screen. Signing out,
        switching accounts or disconnecting clears this device’s widget. Server-revoked access
        clears on its next server check. Removing the final widget disconnects it.
      </p>
      {!supported ? (
        <p className="text-sm">
          Install the Android update with Field monitor support to use these controls.
        </p>
      ) : (
        <>
          <p className="text-sm" role="status">
            {status
              ? `${status.connected ? "Connected" : "Not connected"} · ${status.installed} on home screen`
              : "Checking widget…"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="portal-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await connectOwnerWidget();
                  setMessage(
                    "Owner access verified. Add the widget below, or refresh one already on your home screen.",
                  );
                })
              }
            >
              {status?.connected ? "Reconnect owner account" : "Connect owner account"}
            </button>
            <button
              type="button"
              className="portal-button secondary"
              disabled={busy || !status?.connected}
              onClick={() =>
                void run(async () => {
                  if (status?.pinSupported) {
                    const result = await OwnerWidget.pin();
                    setMessage(
                      result.requested
                        ? "Confirm Add in Android’s home-screen prompt. This does not place it automatically."
                        : "Your launcher did not accept the request. Add Lootsplit Field monitor from its Widgets menu.",
                    );
                  } else
                    setMessage(
                      "Long-press your home screen, choose Widgets, then Lootsplit Field monitor. Drag it into place.",
                    );
                })
              }
            >
              Add to home screen
            </button>
            <button
              type="button"
              className="portal-button secondary"
              disabled={busy || !status?.connected}
              onClick={() =>
                void run(async () => {
                  await OwnerWidget.refresh();
                  setMessage(
                    "Refresh requested. Android will run it when a network connection is available.",
                  );
                })
              }
            >
              Refresh widget
            </button>
            <button
              type="button"
              className="portal-button secondary"
              disabled={busy || !status?.connected}
              onClick={() =>
                void run(async () => {
                  await disconnectOwnerWidget();
                  setMessage("Widget disconnected and private readings cleared.");
                })
              }
            >
              Disconnect widget
            </button>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
