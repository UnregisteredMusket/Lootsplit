import { PlayerDisplayButton } from "./player-display-controller";
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { PanelsTopLeft } from "lucide-react";
import { Button, Field, Modal, Select } from "./ui";
import { useSeat } from "@/lib/quire/seat";
import { featureScreens, screenName } from "@/lib/quire/feature-navigation";
import { openWorkspaceWindow } from "@/lib/quire/workspace-windows";

export function WorkspaceWindows() {
  const [open, setOpen] = useState(false),
    [destination, setDestination] = useState("current"),
    [error, setError] = useState("");
  const href = useRouterState({ select: (s) => s.location.href });
  const dm = useSeat().role === "dm";
  const native = import.meta.env.VITE_MOBILE === "true";
  useEffect(() => {
    const previous = document.title;
    document.title = `${screenName(href, dm)} · Lootsplit`;
    return () => {
      document.title = previous;
    };
  }, [href, dm]);
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
      <button
        type="button"
        className="header-icon"
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
      <Modal open={open} onOpenChange={setOpen} title="Tabs & windows">
        <div className="space-y-4">
          <p>
            Keep different Lootsplit screens open side by side. Move a separate window to another
            monitor using your computer’s window controls.
          </p>
          {native ? (
            <p role="status">
              Use the Lootsplit website in your desktop browser for separate windows and multiple
              monitors. The Android app keeps its current navigation.
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
                  <option value="/party">{dm ? "Party" : "Inventory"}</option>
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
