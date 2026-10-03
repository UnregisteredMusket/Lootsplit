import { AppLink } from "@/components/app-link";
import { FantasyIcon } from "@/components/fantasy-icon";
import { useEffect, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { Button, Modal } from "@/components/ui";
import {
  defaultShortcuts,
  normalizeShortcuts,
  shortcutDestinations,
  shortcutIcons,
} from "@/lib/quire/shortcuts.mjs";
type Shortcut = { destination: string; label: string; icon: string };
export function Shortcuts({ campaignId }: { campaignId: string }) {
  const key = `lootsplit.shortcuts.v1.${campaignId}`;
  const [items, setItems] = useState<Shortcut[]>(defaultShortcuts),
    [draft, setDraft] = useState<Shortcut[]>(defaultShortcuts),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let next: Shortcut[];
    try {
      next = normalizeShortcuts(JSON.parse(localStorage.getItem(key) || "null"));
    } catch {
      next = normalizeShortcuts(null);
    }
    setItems(next);
    if (new URLSearchParams(location.search).get("customize") === "1") {
      setDraft(next.map((x) => ({ ...x })));
      setOpen(true);
      history.replaceState(history.state, "", location.pathname + "?view=home");
    }
  }, [key]);
  useEffect(() => {
    const show = () => {
      setDraft(items.map((x) => ({ ...x })));
      setOpen(true);
    };
    window.addEventListener("lootsplit:shortcuts", show);
    return () => window.removeEventListener("lootsplit:shortcuts", show);
  }, [items]);
  function edit() {
    setDraft(items.map((x) => ({ ...x })));
    setOpen(true);
  }
  function patch(i: number, change: Partial<Shortcut>) {
    setDraft((rows) => rows.map((x, j) => (j === i ? { ...x, ...change } : x)));
  }
  function move(i: number, d: number) {
    setDraft((rows) => {
      const next = [...rows];
      [next[i], next[i + d]] = [next[i + d]!, next[i]!];
      return next;
    });
  }
  return (
    <section className="desk-shortcuts" aria-label="My shortcuts">
      <div className="panel-heading">
        <h2>My shortcuts</h2>
        <Button variant="secondary" className="shortcut-customize" onClick={edit}>
          Customize
        </Button>
      </div>
      <div className="shortcut-grid">
        {items.map((item, i) => {
          const target = shortcutDestinations.find((x) => x.id === item.destination)!;
          return (
            <AppLink key={i} href={target.href} className="shortcut-button">
              <FantasyIcon ui={item.icon} size={40} />
              <span>{item.label}</span>
            </AppLink>
          );
        })}
      </div>
      <p className="shortcut-hint">Your destinations, one tap away.</p>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Customize shortcuts"
        returnFocus=".shortcut-customize"
      >
        <p className="text-sm text-muted mb-4">
          Choose six destinations. Saved for this campaign on this device.
        </p>
        <div className="shortcut-editor">
          {draft.map((item, i) => (
            <div className="shortcut-edit-row" key={i}>
              <label>
                Button {i + 1}
                <select
                  aria-label={`Button ${i + 1}`}
                  value={item.destination}
                  onChange={(e) => {
                    const target = shortcutDestinations.find((x) => x.id === e.target.value)!;
                    patch(i, {
                      destination: target.id,
                      label: target.label,
                      icon: target.icon,
                    });
                  }}
                >
                  {shortcutDestinations.map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Label
                <input
                  maxLength={32}
                  value={item.label}
                  onChange={(e) => patch(i, { label: e.target.value })}
                />
              </label>
              <label>
                Icon
                <select
                  aria-label={`Button ${i + 1} icon`}
                  value={item.icon}
                  onChange={(e) => patch(i, { icon: e.target.value })}
                >
                  {shortcutIcons.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  aria-label={`Move button ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={18} />
                </Button>
                <Button
                  variant="secondary"
                  aria-label={`Move button ${i + 1} down`}
                  disabled={i === 5}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={18} />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              try {
                const next = normalizeShortcuts(draft);
                localStorage.setItem(key, JSON.stringify(next));
                setItems(next);
                setOpen(false);
                toast.success("Shortcuts saved");
              } catch {
                toast.error("Unable to save shortcuts on this device.");
              }
            }}
          >
            Save shortcuts
          </Button>
          <Button variant="secondary" onClick={() => setDraft(normalizeShortcuts(null))}>
            Restore defaults
          </Button>
        </div>
      </Modal>
    </section>
  );
}
