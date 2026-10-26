import { ShellMapActions } from "./shell-map-actions";
import { WorkspaceWindows } from "./workspace-windows";
import { useEffect, useRef, useState, useContext, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Search,
  Menu,
  EyeOff,
  SlidersHorizontal,
  X,
  Map as MapIcon,
} from "lucide-react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { registerBackHandler } from "@/lib/mobile/back-handlers";
import { mapBackStep, mapExitHref } from "@/lib/quire/map-navigation";
import { AppLink } from "./app-link";
import { MapFrame } from "./map-frame";
import { allowContextChange } from "@/lib/quire/use-draft-guard";
import type { CampaignMap } from "@/lib/quire/world-schema";
import type { MapRecord } from "@/lib/quire/map-signals";

export type MapSearchResult = {
  key: string;
  label: string;
  kind: string;
  context: string;
  mapId: string;
  record?: MapRecord;
};
export function MapWorkspaceChrome({
  map,
  maps,
  navigation,
  results,
  selectResult,
  settingsOpen,
  toggleSettings,
  hidden,
  setHidden,
  parent,
  onBack,
  closePanel,
  compactSearch = false,
}: {
  map?: CampaignMap;
  /** The parent map, only when this viewer can open it (otherwise no Back button). */
  parent?: CampaignMap;
  onBack?: () => void;
  /** Closes an open map panel or sheet; returns false when none was open (Android Back). */
  closePanel?: () => boolean;
  /** Phones with the DM setup bar in row 2: search becomes a row-1 icon that opens the field. */
  compactSearch?: boolean;
  maps: CampaignMap[];
  navigation?: ReactNode;
  results: MapSearchResult[];
  selectResult: (result: MapSearchResult) => void;
  settingsOpen: boolean;
  toggleSettings: () => void;
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}) {
  const app = useContext(ShellMapActions);
  const navigate = useNavigate(),
    router = useRouter();
  const exitHref = mapExitHref();
  const [query, setQuery] = useState(""),
    [searching, setSearching] = useState(false),
    [index, setIndex] = useState(0),
    [menu, setMenu] = useState(false),
    [searchOpen, setSearchOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    searchRoot = useRef<HTMLDivElement>(null);
  const matches = results
    .filter((r) =>
      `${r.label} ${r.kind} ${r.context}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .slice(0, 40);
  const choose = (result: MapSearchResult) => {
    if (!allowContextChange(() => choose(result))) return;
    selectResult(result);
    setSearching(false);
    setQuery("");
    input.current?.blur();
  };
  useEffect(() => {
    if (searching)
      document.getElementById(`map-result-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [index, searching]);
  useEffect(() => {
    setMenu(false);
    setSearching(false);
    setSearchOpen(false);
    setQuery("");
  }, [map?.id]);
  const parentRef = useRef(parent),
    backRef = useRef(onBack),
    stateRef = useRef({ menu, searching, closePanel, exitHref });
  parentRef.current = parent;
  backRef.current = onBack;
  stateRef.current = { menu, searching, closePanel, exitHref };
  // Android Back: menu/search → open panel → parent map → close the map (same as X).
  useEffect(
    () =>
      registerBackHandler(() => {
        const s = stateRef.current;
        const step = mapBackStep({
          menu: s.menu || s.searching,
          panel: !!s.closePanel && s.closePanel(),
          parent: !!parentRef.current && !!backRef.current,
        });
        if (step === "menu") {
          setMenu(false);
          setSearching(false);
          input.current?.blur();
        } else if (step === "parent") backRef.current!();
        else if (step === "close") {
          const url = new URL(s.exitHref, "https://app.invalid");
          const leave = () =>
            void navigate({
              to: url.pathname as never,
              search: router.options.parseSearch!(url.search) as never,
              hash: url.hash.slice(1),
            });
          if (allowContextChange(leave)) leave();
        }
        return true;
      }),
    [navigate, router],
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        (e.target as HTMLElement).closest(
          'dialog,[role="dialog"],[role="alertdialog"],.record-select-menu',
        )
      )
        return;
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))
        return;
      if (
        (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey) ||
        // Alt+↑ from the top bar, rails or panels; on the map canvas Alt+arrows keep panning.
        (e.key === "ArrowUp" && e.altKey)
      ) {
        if (!parentRef.current) return;
        e.preventDefault();
        backRef.current?.();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setHidden(false);
        setSearchOpen(true);
        input.current?.focus();
        requestAnimationFrame(() => input.current?.focus());
      }
      if (e.key.toLowerCase() === "h" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setHidden(!hidden);
      }
      if (e.key === "Escape") {
        setMenu(false);
        setSearching(false);
        if (hidden) setHidden(false);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [hidden, setHidden]);
  return (
    <>
      {hidden ? (
        <button
          className="map-show-interface map-glass map-icon-button"
          aria-label="Show interface"
          title="Show interface (H)"
          onClick={() => setHidden(false)}
        >
          <Menu size={20} />
        </button>
      ) : (
        <>
          <div
            className="map-title-capsule map-glass"
            data-has-back={parent ? "" : undefined}
            data-compact={compactSearch || undefined}
          >
            {parent && onBack && (
              <button
                className="map-back-button"
                aria-label={`Back to ${parent.name}`}
                title={`Back to ${parent.name} (Backspace)`}
                aria-keyshortcuts="Backspace Alt+ArrowUp"
                onClick={onBack}
              >
                <ArrowLeft size={18} />
              </button>
            )}
            <button
              className="map-title-button"
              aria-label="Map navigation menu"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <span>
                {parent && <small className="map-title-parent">{parent.name} › </small>}
                {map?.name || "Maps"}
              </span>
              <ChevronDown size={16} />
            </button>
          </div>
          {menu && (
            <section className="map-app-menu map-glass" aria-label="Map and application navigation">
              <button
                className="map-menu-settings"
                aria-expanded={settingsOpen}
                onClick={() => {
                  setMenu(false);
                  toggleSettings();
                }}
              >
                <SlidersHorizontal size={16} aria-hidden="true" />
                Map settings
              </button>
              {navigation}
              {map && (
                <div className="map-connected-scene-list" aria-label="Connected scenes">
                  {maps
                    .filter(
                      (m) =>
                        m.connected?.parentMapId === map.id ||
                        map.connected?.links.some(
                          (l) => l.targetMapId === m.id && (app?.dm || l.visibility === "party"),
                        ),
                    )
                    .map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          choose({
                            key: m.id,
                            label: m.name,
                            kind: "Map",
                            context: map.name,
                            mapId: m.id,
                          });
                          setMenu(false);
                        }}
                      >
                        <MapIcon size={16} />
                        {m.name}
                      </button>
                    ))}
                </div>
              )}
              <nav aria-label="Sections">
                {[
                  ...(app?.dm
                    ? [
                        ["Desk", "/?view=home"],
                        ["Encounters", "/encounters"],
                        ["Party", "/party"],
                      ]
                    : [
                        ["Home", "/?view=home"],
                        ["Inventory", "/party"],
                        ["Campaign", "/share"],
                      ]),
                  ["Market", "/market"],
                  ["Library", "/library"],
                  ["Maps", "/maps"],
                ].map(([name, href]) => (
                  <AppLink
                    key={name}
                    href={href}
                    aria-current={name === "Maps" ? "page" : undefined}
                  >
                    {name}
                  </AppLink>
                ))}
              </nav>
              {app && (
                <div className="map-app-actions">
                  <button aria-label={`Select campaign: ${app.campaignName}`} onClick={app.openCampaign}>
                    {app.campaignName}
                  </button>
                  <button
                    aria-label={app.dm ? "Dungeon master. Change role." : "Player. Change role."}
                    disabled={!app.seatKnown}
                    onClick={app.changeRole}
                  >
                    {app.dm ? "Dungeon Master" : "Player"}
                  </button>
                  <WorkspaceWindows />
                  <AppLink href="/share?chat=1">
                    Messages{app.unreadCount ? ` (${app.unreadCount})` : ""}
                  </AppLink>
                  <button aria-label="Settings & Management" onClick={app.openManagement}>
                    Settings & Management
                  </button>
                </div>
              )}
              <AppLink href="/account">My account</AppLink>
              <AppLink href="/settings">Application settings</AppLink>
              <button
                onClick={() => {
                  setMenu(false);
                  setHidden(true);
                }}
              >
                Hide interface
              </button>
            </section>
          )}
          <div
            className="map-top-controls"
            data-compact={compactSearch || undefined}
            data-open={searchOpen || undefined}
          >
            <div
              className="map-search map-glass"
              ref={searchRoot}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setSearching(false);
                  if (!query) setSearchOpen(false);
                }
              }}
            >
              <Search size={18} aria-hidden="true" />
              <input
                ref={input}
                role="combobox"
                aria-label="Search maps and places"
                aria-expanded={searching && !!query.trim()}
                aria-autocomplete="list"
                aria-controls="map-search-results"
                aria-activedescendant={
                  searching && query.trim() && matches[index] ? `map-result-${index}` : undefined
                }
                placeholder="Search maps, places and people"
                value={query}
                onFocus={() => setSearching(true)}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setIndex(0);
                  setSearching(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setIndex((n) =>
                      Math.max(
                        0,
                        Math.min(matches.length - 1, n + (e.key === "ArrowDown" ? 1 : -1)),
                      ),
                    );
                  }
                  if (e.key === "Enter" && matches[index]) {
                    e.preventDefault();
                    choose(matches[index]);
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setSearching(false);
                    setSearchOpen(false);
                    input.current?.blur();
                  }
                }}
              />
              {query && (
                <button
                  className="map-icon-button"
                  aria-label="Clear map search"
                  onClick={() => {
                    setQuery("");
                    input.current?.focus();
                  }}
                >
                  <X size={16} />
                </button>
              )}
              {searching && !!query.trim() && (
                <div
                  className="map-search-results map-glass"
                  id="map-search-results"
                  role="listbox"
                  aria-label="Map search results"
                >
                  {matches.map((r, i) => (
                    <button
                      id={`map-result-${i}`}
                      type="button"
                      role="option"
                      aria-selected={index === i}
                      key={r.key}
                      onClick={() => choose(r)}
                    >
                      <strong>{r.label}</strong>
                      <span>
                        {r.kind} · {r.context}
                      </span>
                    </button>
                  ))}
                  {!matches.length && <p>No accessible maps or places found.</p>}
                </div>
              )}
            </div>
          </div>
          <div className="map-top-actions">
            {compactSearch && (
              <button
                className="map-search-toggle map-glass map-icon-button"
                aria-label="Search maps and places"
                title="Search (/)"
                aria-expanded={searchOpen}
                onClick={() => {
                  setSearchOpen(true);
                  requestAnimationFrame(() => input.current?.focus());
                }}
              >
                <Search size={19} />
              </button>
            )}
            <button
              className="map-settings-toggle map-glass map-icon-button"
              aria-label="Map settings"
              title="Map settings"
              aria-expanded={settingsOpen}
              onClick={() => {
                setMenu(false);
                setSearching(false);
                toggleSettings();
              }}
            >
              <SlidersHorizontal size={20} />
            </button>
            <button
              className="map-glass map-icon-button map-hide-button"
              aria-label="Hide interface"
              title="Hide interface (H)"
              onClick={() => setHidden(true)}
            >
              <EyeOff size={19} />
            </button>
            <AppLink
              className="map-glass map-icon-button map-close-button"
              href={exitHref}
              aria-label="Close map"
              title="Close map"
            >
              <X size={20} />
            </AppLink>
          </div>
        </>
      )}
    </>
  );
}
export function MapEmptyWorkspace({
  dm,
  settings,
  travel,
}: {
  dm: boolean;
  settings: ReactNode;
  /** The party's journey for a player whose DM keeps its map private (text only). */
  travel?: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [hidden, setHidden] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        (e.target as HTMLElement).closest(
          'dialog,[role="dialog"],[role="alertdialog"],.record-select-menu',
        )
      )
        return;
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  return (
    <MapFrame title="Maps">
      <MapWorkspaceChrome
        maps={[]}
        results={[]}
        selectResult={() => {}}
        settingsOpen={open}
        toggleSettings={() => setOpen(!open)}
        hidden={hidden}
        setHidden={setHidden}
      />
      <div className={`map-empty-state${travel ? " map-empty-state-travel" : ""}`}>
        <MapIcon size={38} />
        <h2>No map available</h2>
        <p>
          {dm
            ? "Import your first map to begin exploring."
            : "The Dungeon Master has not shared an accessible map yet."}
        </p>
        {dm && <button onClick={() => setOpen(true)}>Open map library</button>}
        {travel}
      </div>
      <aside
        hidden={!open || hidden}
        id="map-settings"
        className="map-settings-drawer map-glass"
        aria-label="Map settings"
      >
        <div className="map-panel-heading">
          <strong>Settings</strong>
          <button
            className="map-icon-button"
            aria-label="Close settings"
            onClick={() => setOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        {settings}
      </aside>
    </MapFrame>
  );
}
