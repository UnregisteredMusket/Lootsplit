import { Capacitor, registerPlugin } from "@capacitor/core";

export type OwnerWidgetStatus = {
  connected: boolean;
  installed: number;
  pinSupported: boolean;
  companions?: number[];
  mainWidgets?: number[];
};
export const OwnerWidget = registerPlugin<{
  status(): Promise<OwnerWidgetStatus>;
  connect(options: { token: string }): Promise<void>;
  disconnect(options: { expectedToken?: string }): Promise<void>;
  refresh(): Promise<void>;
  sync(options: { expectedToken: string; snapshot: unknown }): Promise<void>;
  pin(options?: { kind?: "main" | "companion" }): Promise<{ requested: boolean }>;
  configure(options: { widgetId: number }): Promise<void>;
  consumeOpenRequest(): Promise<{ open: boolean; destination?: string }>;
}>("OwnerWidget");

export function hasOwnerWidget() {
  return import.meta.env.VITE_MOBILE === "true" && Capacitor.isPluginAvailable("OwnerWidget");
}

/** Called before account switches/sign-out; no widget credential survives that transition. */
export async function disconnectOwnerWidget(expectedToken?: string) {
  if (hasOwnerWidget()) await OwnerWidget.disconnect({ expectedToken });
}

export async function connectOwnerWidget() {
  const token = localStorage.getItem("lootsplit.account.token.v1");
  if (!token) throw new Error("Sign in to your owner account first.");
  await OwnerWidget.connect({ token });
}
