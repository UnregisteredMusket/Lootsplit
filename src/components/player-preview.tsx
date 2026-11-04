/**
 * "Preview as player" (docs/FEATURE-INVENTORY.md, "Preview as player"): the DM's entry point,
 * the persistent read-only banner and the screen gate. The preview itself (seat, projection,
 * refusals) lives in src/lib/quire/player-preview.ts.
 */
import "./player-preview.css";
import { useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { AppLink } from "./app-link";
import { Button, Modal } from "./ui";
import { useEconomy } from "@/lib/quire/economy-context";
import { previewScreenAllowed, startPreview, stopPreview } from "@/lib/quire/player-preview";
import { useActualDm, usePlayerPreview } from "@/lib/quire/use-player-preview";
import { characterControl } from "@/lib/quire/types";

/** Wraps the route outlet: during a preview, a screen outside the player's main screens shows no data. */
export function PreviewRouteGate({ children }: { children: ReactNode }) {
  const preview = usePlayerPreview();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  if (!preview || previewScreenAllowed(pathname)) return <>{children}</>;
  return (
    <main className="player-preview-unavailable" aria-labelledby="preview-unavailable-title">
      <h1 id="preview-unavailable-title">Not available in preview</h1>
      <p>
        This screen is not part of the player preview. Players' main screens are Home, Party &amp;
        inventory, Character sheet, Journal, Quests, Maps and Campaign chat.
      </p>
      <p>
        <AppLink href="/?view=home">Open the player's Home</AppLink>
      </p>
    </main>
  );
}

/** The persistent banner while a preview runs: who is previewed, read-only, and Stop preview. */
export function PlayerPreviewBanner() {
  const preview = usePlayerPreview();
  if (!preview) return null;
  return (
    <div className="player-preview-banner" role="status" aria-live="polite">
      <Eye size={18} aria-hidden="true" />
      <p>
        <strong>Previewing as {preview.name}</strong> — read-only
      </p>
      <Button
        variant="secondary"
        className="player-preview-stop"
        onClick={() => {
          stopPreview();
          toast.success("Preview ended. You are back in the DM view.");
        }}
      >
        <EyeOff size={16} aria-hidden="true" /> Stop preview
      </Button>
    </div>
  );
}

/**
 * DM only: choose a player character and see the app as that player. `openOnMount` opens the
 * chooser at once (the command palette's "Preview as player" link).
 */
export function PreviewAsPlayerButton({ openOnMount = false }: { openOnMount?: boolean }) {
  const dm = useActualDm();
  const preview = usePlayerPreview();
  const { purses, ready } = useEconomy();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openOnMount && dm && !preview) setOpen(true);
  }, [openOnMount, dm, preview]);
  if (!dm || preview) return null;
  const characters = purses
    .filter((p) => p.kind === "character" && characterControl(p) === "player")
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <Button variant="secondary" disabled={!ready} onClick={() => setOpen(true)}>
        <Eye size={16} aria-hidden="true" /> Preview as player
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Preview as player">
        <p className="text-sm text-muted">
          See the app exactly as this player does, to check that hidden NPCs, objectives, items
          and balances stay hidden. The preview is read-only: nothing can be changed, saved or
          sent until you stop it.
        </p>
        {characters.length === 0 ? (
          <p className="mt-3">Add a player character to the party first.</p>
        ) : (
          <ul className="player-preview-choices">
            {characters.map((p) => (
              <li key={p.id}>
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  onClick={() => {
                    try {
                      startPreview({ name: p.name, purseIds: [p.id] });
                      setOpen(false);
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "The preview could not start.");
                    }
                  }}
                >
                  {p.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
