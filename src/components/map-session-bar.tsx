import { useState, useSyncExternalStore } from "react";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { getCloudTable, getServerCloudTable, subscribeCloudTable } from "@/lib/quire/cloud-client";
import { readTabletopSession } from "@/lib/quire/tabletop";
import { mapType } from "@/lib/quire/map-tiles";
import type { CampaignMap } from "@/lib/quire/world-schema";
import { CommandButton } from "./world-tools";
import { Button } from "./ui";
import { PlayerDisplayButton } from "./player-display-controller";

export function MapSessionBar({ map }: { map?: CampaignMap }) {
  const table = useWorldTable(),
    dm = useSeat().role === "dm",
    session = readTabletopSession(table),
    cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable),
    active = table.journal.world?.maps.find((scene) => scene.id === session.activeMapId);
  return (
    <section className="map-session-bar" aria-label="Map session status">
      <div>
        <strong>Viewing: {map?.name ?? "No scene"}</strong>
        <span>{dm && map && (map.visible ? "Shared access" : "DM preparation · private")}</span>
        <span>Players’ active scene: {active?.name ?? "Not directed"}</span>
      </div>
      <div className="tabletop-tool-row">
        {dm && map?.visible && (
          <CommandButton
            input={{
              kind: "tabletop-session",
              before: table.journal.world?.tabletop ?? null,
              session: {
                ...session,
                activeMapId: map.id,
                activationId: crypto.randomUUID(),
                camera: null,
              },
            }}
          >
            Activate for players
          </CommandButton>
        )}
        {dm && map && !map.visible && (
          <span>Share this map in its editor before activating it.</span>
        )}
        {dm && session.activeMapId && (
          <CommandButton
            input={{
              kind: "tabletop-session",
              before: table.journal.world?.tabletop ?? null,
              session: {
                ...session,
                activeMapId: null,
                camera: null,
                activationId: crypto.randomUUID(),
              },
            }}
          >
            Clear active scene
          </CommandButton>
        )}
        {dm && session.activeMapId && (
          <CommandButton
            input={{
              kind: "tabletop-session",
              before: table.journal.world?.tabletop ?? null,
              session: { ...session, playerBrowsing: !session.playerBrowsing },
            }}
          >
            {session.playerBrowsing
              ? "Restrict browsing to active scene"
              : "Allow shared-scene browsing"}
          </CommandButton>
        )}
        {dm && (
          <CommandButton
            input={{
              kind: "tabletop-session",
              before: table.journal.world?.tabletop ?? null,
              session: { ...session, tvEnabled: !session.tvEnabled },
            }}
          >
            {session.tvEnabled
              ? "Disable TV / player display"
              : "Enable optional TV / player display"}
          </CommandButton>
        )}
        {dm && session.tvEnabled && (
          <PlayerDisplayButton
            mapId={map?.visible ? map.id : undefined}
            encounterId={map?.encounterId}
          />
        )}
      </div>
      <p className="text-sm text-muted">
        {cloud.joined
          ? `${cloud.live ? "Live online" : "Turn-based online"} · ${cloud.status}${cloud.viewOnly ? " · view only" : ""}`
          : "DM offline workspace"}{" "}
        · {session.tvEnabled ? "Optional display enabled" : "TV off"}.{" "}
        {dm
          ? "Browsing and preparation do not activate a scene or change a projected display."
          : "Your camera is independent until the DM explicitly shares a view."}
      </p>
    </section>
  );
}

export function MapBrowser({
  maps,
  current,
  select,
}: {
  maps: CampaignMap[];
  current?: string;
  select: (id: string) => void;
}) {
  const table = useWorldTable(),
    session = readTabletopSession(table),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const visible = maps.filter((map) =>
    `${map.name} ${mapType(map, table)}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="tabletop-map-browser" aria-label="Map library">
      <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        Map library · {maps.length}
      </Button>
      {open && (
        <div className="tabletop-browser-drawer">
          <label>
            Search maps
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or category"
            />
          </label>
          <div className="tabletop-scene-cards">
            {visible.map((map) => (
              <button
                key={map.id}
                type="button"
                className="tabletop-scene-card"
                aria-pressed={current === map.id}
                onClick={() => {
                  select(map.id);
                  setOpen(false);
                }}
              >
                <img src={map.image} alt="" loading="lazy" />
                <strong>{map.name}</strong>
                <span>
                  {mapType(map, table)} · {map.visible ? "Shared" : "Private"}
                </span>
                {session.activeMapId === map.id && <span>Active for players</span>}
              </button>
            ))}
          </div>
          {!visible.length && <p>No maps match this search.</p>}
        </div>
      )}
    </section>
  );
}
