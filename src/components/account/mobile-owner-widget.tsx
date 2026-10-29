import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { App } from "@capacitor/app";
import { ShieldCheck, Smartphone } from "lucide-react";
import {
  connectOwnerWidget,
  disconnectNote,
  disconnectOwnerWidget,
  hasOwnerWidget,
  OwnerWidget,
  type OwnerWidgetStatus,
} from "@/lib/mobile/owner-widget";
import { confirmContextChange } from "@/lib/quire/use-draft-guard";

/** A widget tap uses the existing router and preserves the running app's draft guards. */
export function MobileOwnerWidgetBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!hasOwnerWidget()) return;
    let alive = true;
    const open = async () => {
      try {
        const request = await OwnerWidget.consumeOpenRequest();
        if (alive && request.open && (await confirmContextChange())) {
          await navigate({ to: "/account", hash: request.destination || "home-screen-widget" });
          window.dispatchEvent(new Event("lootsplit-monitor-destination"));
          window.dispatchEvent(new Event("lootsplit-monitor-sign-in"));
        }
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
  const connectButton = useRef<HTMLButtonElement>(null);
  // A widget's Sign in opens /account#home-screen-widget: scroll here and, while the widget is not
  // connected, put focus on Connect widget so connecting is one tap.
  const [openedFromWidget] = useState(
    () => typeof window !== "undefined" && window.location.hash === "#home-screen-widget",
  );
  useEffect(() => {
    if (openedFromWidget)
      document.getElementById("home-screen-widget")?.scrollIntoView({ block: "start" });
  }, [openedFromWidget]);
  useEffect(() => {
    if (openedFromWidget && status && !status.connected)
      connectButton.current?.focus({ preventScroll: true });
  }, [openedFromWidget, status]);
  const lastDisconnect = disconnectNote(status);
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
      style={{ scrollMarginTop: "6rem" }}
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
        activity, app analytics, monitoring logs, task timers and daily reports. Scroll inside the
        main widget for details. The separate 4×1 companion has two configurable summaries and two
        toolbar actions, with independent presets and appearance for each instance.
      </p>
      <p className="text-sm text-muted">
        Readings are dated. Android requests background checks about every 30 minutes and may delay
        them to save battery. Backend collection continues every 30 minutes even when your phone is
        asleep, offline or closed; tap Refresh to check directly from the home screen. Your last
        dated reading stays visible while refreshing. Provider data may be cached for five minutes.
        Unconnected Cloudflare traffic stays labeled.
      </p>
      <p className="text-sm text-muted">
        Your name and private totals will be visible on your home screen. The widget keeps its own
        owner session (valid for a year), so signing out of the app, switching accounts, updating
        the app or removing and re-adding widgets does not stop it; only Disconnect widget, losing
        owner access or a reset of the phone’s encryption key ends it. Server-revoked access clears
        on its next server check. While no widget is placed, no background checks run.
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
          {status && !status.connected && (
            <p className="text-sm" role="note">
              {lastDisconnect ? `Last disconnected: ${lastDisconnect}. ` : ""}
              Tap Connect widget to give the home-screen widget its own owner session.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              ref={connectButton}
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
              {status?.connected ? "Reconnect owner account" : "Connect widget"}
            </button>
            <button
              type="button"
              className="portal-button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (status?.pinSupported) {
                    const result = await OwnerWidget.pin();
                    setMessage(
                      result.requested
                        ? "Confirm Add in Android’s home-screen prompt. This does not place it automatically."
                        : "Your launcher did not accept the request. Add Lootsplitter Field monitor from its Widgets menu.",
                    );
                  } else
                    setMessage(
                      "Long-press your home screen, choose Widgets, then Lootsplitter Field monitor. Drag it into place.",
                    );
                })
              }
            >
              Add to home screen
            </button>
            <button
              type="button"
              className="portal-button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (status?.pinSupported) {
                    const result = await OwnerWidget.pin({ kind: "companion" });
                    setMessage(
                      result.requested
                        ? "Confirm Add to place the 4×1 companion. Tap its Settings action to choose summaries and controls. Owner access is only needed for private readings."
                        : "Add Lootsplitter 4×1 companion from your launcher’s Widgets menu.",
                    );
                  } else
                    setMessage(
                      "Long-press your home screen, choose Widgets, then Lootsplitter 4×1 companion. Configure its summaries and actions after placing it.",
                    );
                })
              }
            >
              Add 4×1 companion
            </button>
            <button
              type="button"
              className="portal-button secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await OwnerWidget.refreshRegistration();
                  setMessage(
                    result.mainAvailable && result.companionAvailable
                      ? "Android detects both Lootsplitter widgets. Close and reopen your home screen’s Widgets menu. You can also use Add 4×1 companion here."
                      : "Android has not detected both widget types yet. Open Lootsplitter again after the update finishes, then retry. Your saved data and placed widgets are preserved.",
                  );
                })
              }
            >
              Refresh widget list
            </button>
            {status?.mainWidgets?.map((id) => (
              <button
                key={id}
                type="button"
                className="portal-button secondary"
                disabled={busy}
                onClick={() => void run(() => OwnerWidget.configure({ widgetId: id }))}
              >
                Field monitor {id} appearance
              </button>
            ))}
            {status?.companions?.map((id) => (
              <button
                key={id}
                type="button"
                className="portal-button secondary"
                disabled={busy}
                onClick={() => void run(() => OwnerWidget.configure({ widgetId: id }))}
              >
                Configure companion {id}
              </button>
            ))}
            <button
              type="button"
              className="portal-button secondary"
              disabled={busy || !status?.connected}
              onClick={() =>
                void run(async () => {
                  await OwnerWidget.refresh();
                  setMessage(
                    "Widget refreshed. Return to your home screen to see the latest reading.",
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
