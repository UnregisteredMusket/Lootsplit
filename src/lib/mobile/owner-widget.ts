import { Capacitor, registerPlugin } from "@capacitor/core";

export type OwnerWidgetStatus = {
  connected: boolean;
  installed: number;
  pinSupported: boolean;
  companions?: number[];
  mainWidgets?: number[];
  mainAvailable?: boolean;
  companionAvailable?: boolean;
};
export const OwnerWidget = registerPlugin<{
  status(): Promise<OwnerWidgetStatus>;
  refreshRegistration(): Promise<OwnerWidgetStatus>;
  connect(options: { token: string }): Promise<void>;
  disconnect(options: { expectedToken?: string }): Promise<void>;
  refresh(): Promise<void>;
  sync(options: { expectedToken: string; snapshot: unknown }): Promise<void>;
  pin(options?: { kind?: "main" | "companion" }): Promise<{ requested: boolean }>;
  configure(options: { widgetId: number }): Promise<void>;
  consumeOpenRequest(): Promise<{ open: boolean; destination?: string }>;
  installId(): Promise<{ id: string }>;
  /** The widget's own stored session token ("" when disconnected); never the app's token. */
  sessionToken(): Promise<{ token: string }>;
}>("OwnerWidget");

export function hasOwnerWidget() {
  return import.meta.env.VITE_MOBILE === "true" && Capacitor.isPluginAvailable("OwnerWidget");
}

/** This installation's id from native no-backup storage; "" when unknown. */
export async function readInstallId(): Promise<string> {
  if (!hasOwnerWidget()) return "";
  const { id } = await OwnerWidget.installId();
  return typeof id === "string" ? id : "";
}

/**
 * Clears this device's widget. The widget has its own owner session (not the app's token), so an
 * app sign-out or re-sign-in no longer reaches it: `expectedToken` only matches a widget that is
 * still connected with that same app token (installs connected before 2026-10-28), which is the
 * legacy case this call still has to clear. An explicit disconnect also revokes the widget session.
 */
export async function disconnectOwnerWidget(expectedToken?: string) {
  if (!hasOwnerWidget()) return;
  if (expectedToken === undefined) {
    const { accountRequest } = await import("../account/client");
    const current = await OwnerWidget.status();
    if (current.connected) {
      const { token } = await OwnerWidget.sessionToken().catch(() => ({ token: "" }));
      if (token)
        await accountRequest("owner/monitor/widget-session", { action: "revoke", token }).catch(
          () => undefined,
        );
    }
  }
  await OwnerWidget.disconnect({ expectedToken });
}

/** Opens a dedicated owner session for the widget; the server refuses it for anyone but the owner. */
export async function connectOwnerWidget() {
  if (!localStorage.getItem("lootsplit.account.token.v1"))
    throw new Error("Sign in to your owner account first.");
  const { accountRequest } = await import("../account/client");
  const previous = await OwnerWidget.sessionToken().catch(() => ({ token: "" }));
  const session = await accountRequest<{ token: string; expiresAt: string }>(
    "owner/monitor/widget-session",
    { action: "create", previousToken: previous.token || undefined },
  );
  if (!session?.token) throw new Error("The widget session could not be opened.");
  await OwnerWidget.connect({ token: session.token });
}
