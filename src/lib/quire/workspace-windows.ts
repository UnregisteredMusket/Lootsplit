import { safeReturn } from "./feature-navigation.ts";
import { pinCampaignContext, prepareWindowContext } from "./campaign-context.ts";

export function workspaceDestination(href: string, origin: string): string {
  const url = new URL(safeReturn(href), origin);
  // Opening another workspace never replays an invitation, account callback or imported seat link.
  for (const key of ["join", "invitation", "invite", "token", "as", "callbackURL", "redirect"])
    url.searchParams.delete(key);
  return url.href;
}

export function openWorkspaceWindow(href: string, mode: "tab" | "window") {
  const destination = workspaceDestination(href, window.location.origin);
  pinCampaignContext();
  // An initial same-origin blank page gives the child its own reconnect ticket.
  // No credentials or campaign contents enter the address or cross-window messages.
  const child = window.open(
    "about:blank",
    "_blank",
    mode === "window" ? "popup,width=1280,height=900" : "",
  );
  if (!child)
    throw Error(
      "Your browser blocked the new workspace. Allow pop-ups for Lootsplit, then try again.",
    );
  try {
    prepareWindowContext(child.sessionStorage);
    child.opener = null;
    child.location.replace(destination);
    child.focus();
  } catch {
    child.close();
    throw Error(
      "This browser could not open another workspace. Your current screen and drafts are retained.",
    );
  }
}
