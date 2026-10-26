import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { appLinkDestination } from "@/lib/quire/feature-navigation";
import {
  GO_SHORTCUTS,
  paletteActions,
  paletteRecords,
  paletteScreens,
  searchPalette,
  singleKeyShortcutsAllowed,
  type PaletteEntry,
  type PaletteGroup,
} from "@/lib/quire/command-palette";
import "./command-palette.css";

const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

type PaletteState = "closed" | "search" | "shortcuts";
let paletteState: PaletteState = "closed";
const paletteListeners = new Set<() => void>();
function setPaletteState(next: PaletteState) {
  if (next === paletteState) return;
  paletteState = next;
  for (const listener of paletteListeners) listener();
}
const subscribePalette = (listener: () => void) => {
  paletteListeners.add(listener);
  return () => paletteListeners.delete(listener);
};
const getPaletteState = () => paletteState;
const getServerPaletteState = (): PaletteState => "closed";
/** Only app screens (the Shell) answer the shortcuts; the public website pages do not. */
const inApp = () => typeof document !== "undefined" && !!document.querySelector(".loot-shell");

/** Opens the keyboard cheat sheet (Settings & Management → Help). */
export const openShortcutSheet = () => setPaletteState("shortcuts");

/** The header's search button (every width; the phone entry point to the palette). */
export function CommandPaletteButton() {
  return (
    <button
      type="button"
      className="header-icon command-palette-trigger"
      aria-label={`Search (${isMac() ? "⌘" : "Ctrl+"}K)`}
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K /"
      onClick={() => setPaletteState("search")}
    >
      <Search size={21} aria-hidden="true" />
    </button>
  );
}

/**
 * Ctrl/⌘ K palette and the "?" keyboard cheat sheet (design D5, Q1, Q12), mounted once for the
 * app so the shortcuts keep working while screens change. The palette opens screens and existing
 * flows only; it never runs a campaign command.
 */
export function CommandPaletteHost() {
  const state = useSyncExternalStore(subscribePalette, getPaletteState, getServerPaletteState);
  const router = useRouter();
  const seat = useSeat();
  const dm = seat.role === "dm";
  const go = (href: string) => {
    const url = appLinkDestination(href, router.state.location.href);
    void router.navigate({
      to: url.pathname as never,
      search: router.options.parseSearch!(url.search) as never,
      hash: url.hash.slice(1),
    });
  };
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    let pendingG = 0;
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || !inApp()) return;
      // Ctrl/⌘ K works everywhere, even in a text field, like other apps' palettes.
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setPaletteState(paletteState === "search" ? "closed" : "search");
        return;
      }
      if (paletteState !== "closed" || event.repeat) return;
      const pathname = window.location.pathname;
      if (!singleKeyShortcutsAllowed(event.target as Element | null, pathname, event)) return;
      const now = Date.now();
      if (pendingG && now - pendingG < 1500) {
        pendingG = 0;
        const target = GO_SHORTCUTS[event.key.toLowerCase()];
        if (target && !event.shiftKey) {
          event.preventDefault();
          goRef.current(target.href);
        }
        return;
      }
      if (event.key === "/" && !event.shiftKey) {
        event.preventDefault();
        setPaletteState("search");
      } else if (event.key === "?") {
        event.preventDefault();
        setPaletteState("shortcuts");
      } else if (event.key === "g" && !event.shiftKey) {
        pendingG = now;
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  return (
    <>
      {state === "search" && (
        <PaletteDialog
          dm={dm}
          seat={seat}
          onClose={() => setPaletteState("closed")}
          onPick={(entry) => {
            setPaletteState("closed");
            go(entry.href);
          }}
          onShortcuts={() => setPaletteState("shortcuts")}
        />
      )}
      <ShortcutSheet
        open={state === "shortcuts"}
        onOpenChange={(open) => setPaletteState(open ? "shortcuts" : "closed")}
        dm={dm}
      />
    </>
  );
}

function PaletteDialog({
  dm,
  seat,
  onClose,
  onPick,
  onShortcuts,
}: {
  dm: boolean;
  seat: ReturnType<typeof useSeat>;
  onClose: () => void;
  onPick: (entry: PaletteEntry) => void;
  onShortcuts: () => void;
}) {
  const { journal, purses, holdings, shops } = useEconomy();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const listId = `${id}-list`;
  const sessionActive = journal.sessions.some((s) => !s.endedAt);
  const entries = useMemo(
    () => [
      ...paletteActions(dm, sessionActive),
      ...paletteScreens(dm),
      ...paletteRecords({ journal, purses, holdings, shops }, seat),
    ],
    [dm, sessionActive, journal, purses, holdings, shops, seat],
  );
  // One heading per group, groups in the order of their best match, ranking kept inside each.
  const results = useMemo(() => {
    const ranked = searchPalette(entries, query);
    const order = [...new Set(ranked.map((e) => e.group))];
    return order.flatMap((group) => ranked.filter((e) => e.group === group));
  }, [entries, query]);
  const current = Math.min(active, Math.max(0, results.length - 1));
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);
  const groups: [PaletteGroup, { entry: PaletteEntry; index: number }[]][] = [];
  results.forEach((entry, index) => {
    const last = groups.at(-1);
    if (last && last[0] === entry.group) last[1].push({ entry, index });
    else groups.push([entry.group, [{ entry, index }]]);
  });
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(results.length ? (current + 1) % results.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(results.length ? (current - 1 + results.length) % results.length : 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (results[current]) onPick(results[current]);
    }
  };
  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay fixed inset-0 z-40" />
        <Dialog.Content className="command-palette" aria-describedby={`${id}-hint`}>
          <Dialog.Title className="sr-only">Search Lootsplitter</Dialog.Title>
          <div className="command-palette-field">
            <Search size={18} aria-hidden="true" />
            <input
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={results.length ? `${id}-option-${current}` : undefined}
              aria-label="Search screens, records and actions"
              placeholder={dm ? "Search screens, characters, shops, actions…" : "Search screens, characters, shops…"}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
            <Dialog.Close className="command-palette-close" aria-label="Close">
              <X size={18} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="command-palette-list" id={listId} role="listbox" aria-label="Results" ref={listRef}>
            {groups.map(([group, rows]) => (
              <div key={group} role="group" aria-labelledby={`${id}-${group}`}>
                <div role="presentation" id={`${id}-${group}`} className="command-palette-group">
                  {group}
                </div>
                {rows.map(({ entry, index }) => (
                  <div
                    key={entry.id}
                    id={`${id}-option-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={index === current}
                    className="command-palette-option"
                    onMouseMove={() => index !== current && setActive(index)}
                    onClick={() => onPick(entry)}
                  >
                    <span>{entry.label}</span>
                    <small>{entry.hint}</small>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {!results.length && (
            <p className="command-palette-empty" role="status">
              Nothing matches “{query}”. Try a shorter word, or open Library to browse every record.
            </p>
          )}
          <p className="command-palette-hint" id={`${id}-hint`}>
            ↑ ↓ to move · Enter to open · Esc to close ·{" "}
            <button type="button" onClick={onShortcuts}>
              Keyboard shortcuts (?)
            </button>
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ShortcutSheet({
  open,
  onOpenChange,
  dm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dm: boolean;
}) {
  const mod = isMac() ? "⌘" : "Ctrl";
  const rows: [string[], string][] = [
    [[mod, "K"], "Search screens, records and actions"],
    [["/"], "Search (outside text fields)"],
    [["?"], "This list"],
    ...Object.entries(GO_SHORTCUTS).map(
      ([letter, target]): [string[], string] => [["g", letter], `Go to ${target.label(dm)}`],
    ),
    [["Esc"], "Close a sheet, dialog or menu"],
    [["F6"], "Switch panes in split view"],
  ];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay fixed inset-0 z-40" />
        <Dialog.Content className="modal-pop shortcut-sheet rounded-xl border border-border bg-elevated p-4 text-fg" aria-describedby={undefined}>
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-2xl leading-tight tracking-tight">
              Keyboard shortcuts
            </Dialog.Title>
            <Dialog.Close className="grid size-11 shrink-0 place-items-center rounded-sm hover:bg-subtle" aria-label="Close">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <dl className="shortcut-sheet-list">
            {rows.map(([keys, label]) => (
              <div key={keys.join("+")}>
                <dt>
                  {keys.map((k, i) => (
                    <span key={k}>
                      {i > 0 && <span aria-hidden="true"> {keys[0] === "g" ? "then" : "+"} </span>}
                      <kbd>{k}</kbd>
                    </span>
                  ))}
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted">
            Letter shortcuts never fire while you type in a field. Maps keeps its own tool keys
            (listed in Help → Maps); there, use {mod}+K to search.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
