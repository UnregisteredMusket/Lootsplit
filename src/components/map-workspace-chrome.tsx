import { ShellMapActions } from "./shell-map-actions";
import { WorkspaceWindows } from "./workspace-windows";
import { useEffect, useRef, useState, useContext, type ReactNode } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Search,
  Menu,
  EyeOff,
  X,
  Map as MapIcon,
} from "lucide-react";
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
}: {
  map?: CampaignMap;
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
  const [query, setQuery] = useState(""),
    [searching, setSearching] = useState(false),
    [index, setIndex] = useState(0),
    [menu, setMenu] = useState(false);
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
    if (!allowContextChange()) return;
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
    setQuery("");
  }, [map?.id]);
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
      if (e.key === "/") {
        e.preventDefault();
        setHidden(false);
        input.current?.focus();
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
          <div className="map-title-capsule">
            <AppLink href="/?view=home" aria-label="Back to Lootsplit" title="Back to Lootsplit">
              <ArrowLeft size={18} />
            </AppLink>
            <button
              aria-label="Map navigation menu"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <span>{map?.name || "Maps"}</span>
              <ChevronDown size={16} />
            </button>
          </div>
          {menu && (
            <section className="map-app-menu map-glass" aria-label="Map and application navigation">
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
                  <button aria-label="Select campaign" onClick={app.openCampaign}>
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
          <div className="map-top-controls">
            <div
              className="map-search map-glass"
              ref={searchRoot}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setSearching(false);
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
            <button
              className="map-glass map-icon-button"
              aria-label="Map settings"
              title="Settings"
              aria-expanded={settingsOpen}
              onClick={() => {
                setMenu(false);
                setSearching(false);
                toggleSettings();
              }}
            >
              <Menu size={21} />
            </button>
            <button
              className="map-glass map-icon-button map-hide-button"
              aria-label="Hide interface"
              title="Hide interface (H)"
              onClick={() => setHidden(true)}
            >
              <EyeOff size={19} />
            </button>
          </div>
          {map && (
            <div className="map-scene-stepper map-glass" aria-label="Scene navigation">
              <button
                className="map-icon-button"
                aria-label="Parent map"
                title="Parent map"
                disabled={!maps.some((m) => m.id === map.connected?.parentMapId)}
                onClick={() =>
                  selectResult({
                    key: "parent",
                    label: "Parent",
                    kind: "Map",
                    context: "",
                    mapId: map.connected!.parentMapId!,
                  })
                }
              >
                <ChevronUp size={18} />
              </button>
              <button
                className="map-icon-button"
                aria-label="Choose map"
                title="Choose map"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <MapIcon size={19} />
              </button>
              <button
                className="map-icon-button"
                aria-label="Connected maps"
                title="Connected maps"
                onClick={() => setMenu(!menu)}
              >
                <ChevronDown size={18} />
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
export function MapEmptyWorkspace({ dm, settings }: { dm: boolean; settings: ReactNode }) {
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
      <div className="map-empty-state">
        <MapIcon size={38} />
        <h2>No map available</h2>
        <p>
          {dm
            ? "Import your first map to begin exploring."
            : "The Dungeon Master has not shared an accessible map yet."}
        </p>
        {dm && <button onClick={() => setOpen(true)}>Open map library</button>}
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
