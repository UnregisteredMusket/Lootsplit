import { PlayerDisplayButton } from "./player-display-controller";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";
import { PanelsTopLeft } from "lucide-react";
import { Button, Field, Modal, Select } from "./ui";
import { useSeat } from "@/lib/quire/seat";
import { featureScreens, screenName } from "@/lib/quire/feature-navigation";
import { openWorkspaceWindow } from "@/lib/quire/workspace-windows";
import { paneTitle, screenKey } from "@/lib/quire/split-view";
import { OPEN_WORKSPACE_WINDOWS, useSplitView } from "./split-view";
import { useEconomy } from "@/lib/quire/economy-context";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { useCampaignDisplayName } from "@/lib/quire/use-campaign-name";
import { campaignTabTitle } from "@/lib/quire/campaign-name";

export function WorkspaceWindows() {
  const [open, setOpen] = useState(false),
    [destination, setDestination] = useState("current"),
    [error, setError] = useState("");
  const href = useRouterState({ select: (s) => s.location.href });
  const seat = useSeat();
  const dm = seat.role === "dm";
  const { purses } = useEconomy();
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const campaign = useCampaignDisplayName();
  // A player in a shared room: "Mira · The Wayfarers" (plan Q17), after the screen name off Home.
  const character =
    cloud.joined && !dm
      ? purses.find((p) => p.kind === "character" && seat.purseIds.includes(p.id))?.name
      : undefined;
  const native = import.meta.env.VITE_MOBILE === "true";
  const split = useSplitView();
  // In split view the tab title names the focused pane's screen.
  const titleHref =
    split.open && split.focused === "secondary" && split.secondaryHref ? split.secondaryHref : href;
  const title = split.open ? paneTitle(titleHref, dm) : screenName(href, dm);
  const playerTitle =
    cloud.joined && !dm
      ? `${title === "Home" ? "" : `${title} · `}${campaignTabTitle(campaign, character)}`
      : null;
  useEffect(() => {
    const previous = document.title;
    document.title = playerTitle ?? `${title} · Lootsplitter`;
    return () => {
      document.title = previous;
    };
  }, [title, playerTitle]);
  // "Open in a separate window…" from the split-view menus opens this dialog for that screen.
  useEffect(() => {
    const open = (event: Event) => {
      const requested = (event as CustomEvent<string>).detail;
      const known = [
        "/?view=home",
        "/maps",
        "/encounters",
        "/characters",
        "/party",
        "/market",
        "/library",
        "/share?tab=chat",
      ].find((value) => typeof requested === "string" && screenKey(value) === screenKey(requested));
      const path =
        typeof requested === "string" ? new URL(requested, "https://lootsplit.invalid").pathname : "";
      const feature = /^\/features\/[a-z]+$/.test(path) ? path : "";
      setDestination(known || feature || "current");
      setError("");
      setOpen(true);
    };
    window.addEventListener(OPEN_WORKSPACE_WINDOWS, open);
    return () => window.removeEventListener(OPEN_WORKSPACE_WINDOWS, open);
  }, []);
  function launch(mode: "tab" | "window") {
    setError("");
    try {
      openWorkspaceWindow(destination === "current" ? href : destination, mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open workspace.");
    }
  }
  return (
    <>
      <PlayerDisplayButton icon />
      {/* Below 1024 px and in the Android app the header leaves this out (design M4); on the web
          it stays one tap away in Settings & Management → Appearance → Tabs & windows…. */}
      {!native && (
        <button
          type="button"
          className="header-icon workspace-windows-trigger"
          aria-label="Tabs & windows"
          title="Tabs & windows"
          aria-haspopup="dialog"
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        >
          <PanelsTopLeft size={23} />
        </button>
      )}
      <Modal open={open} onOpenChange={setOpen} title="Tabs & windows">
        <div className="space-y-4">
          <p>
            Keep different Lootsplitter screens open side by side. Move a separate window to another
            monitor using your computer’s window controls. On a wide screen, Split view in the
            header shows two screens in this window instead.
          </p>
          {native ? (
            <p role="status">
              Use the Lootsplitter website in your desktop browser for separate windows and multiple
              monitors. On a tablet in landscape (at least 1024 pixels wide), Split view in the
              header shows two screens side by side in this app; narrower screens keep their
              current navigation.
            </p>
          ) : (
            <>
              <Field label="Screen to open">
                <Select
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  aria-label="Screen to open"
                >
                  <option value="current">Current screen · {screenName(href, dm)}</option>
                  <option value="/?view=home">{dm ? "DM Desk" : "Home"}</option>
                  <option value="/maps">Maps</option>
                  {dm && <option value="/encounters">Encounters</option>}
                  <option value="/characters">Character sheet</option>
                  <option value="/party">{dm ? "Party" : "Party & inventory"}</option>
                  <option value="/market">Market</option>
                  <option value="/library">Library</option>
                  <option value="/share?tab=chat">Campaign chat</option>
                  {Object.entries(featureScreens)
                    .filter(([id, f]) => (!f.dm || dm) && !(dm && id === "finances"))
                    .map(([id, f]) => (
                      <option key={id} value={`/features/${id}`}>
                        {f.title}
                      </option>
                    ))}
                </Select>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => launch("tab")}>Open new tab</Button>
                <Button onClick={() => launch("window")}>Open separate window</Button>
              </div>
              <p className="text-sm text-muted">
                Each window keeps its own screen and selected campaign. Saved changes synchronize;
                unfinished form entries stay in the window where you typed them. Complete the
                opening screen in each new window. Closing a window does not end the hosted session.
              </p>
              <p className="text-sm text-muted">
                {dm
                  ? "A regular DM window still shows private information. Use Player display for a controlled map and tracker on a TV, or a player’s invitation in another browser profile for normal player access."
                  : "Every window retains your assigned-character permissions and your DM’s controls."}
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="text-negative">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
