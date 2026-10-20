import { SyncStatus } from "./sync-status";
import { useMapSketches } from "./map-sketch-tools";
import { MapWorkspaceChrome, MapEmptyWorkspace } from "./map-workspace-chrome";
import { captureMutationScope } from "@/lib/quire/cloud-client";
import {
  mapViewKey,
  readMapView,
  saveMapView,
  accessibleMapId,
  mapViewStorage,
  type MapCamera,
} from "@/lib/quire/map-view-state";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeatKnown } from "@/lib/quire/seat";
import { MapCombatHud } from "./map-combat-hud";
import { MapConnectedTools } from "./map-connected-tools";
import {
  defaultLocationMap,
  mapsForLocation,
  mapAncestry,
  mapReferenceName,
} from "@/lib/quire/connected-maps";
import type { MapRecordReference } from "@/lib/quire/connected-maps-schema";
import { allowContextChange } from "@/lib/quire/use-draft-guard";
import { loadHandouts, type Handout } from "@/lib/quire/handouts";
import { subscribeWorkspaceChanges } from "@/lib/quire/workspace-events";
import { activeCampaignId } from "@/lib/quire/campaign-context";
import { GridEditor, PartyPlacement, CombatControls } from "./map-tile-controls";
import { mapType, partyEnvironment, tilePoint, routePosition } from "@/lib/quire/map-tiles";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { characterLocation, characterVisible } from "@/lib/quire/character-position";
import { SearchSelect } from "@/components/search-select";
import {
  lazy,
  Suspense,
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSeat } from "@/lib/quire/seat";
import { readWorld, mapTypes, type CampaignMap } from "@/lib/quire/world-schema";
import { anchorFor, recognizedAnchors, npcAvailableHere, shopVisible } from "@/lib/quire/world";
import { readMarketLocations, locationLabel, locationPath } from "@/lib/quire/shop-locations";
import { recognizeMap } from "@/lib/quire/map-image";
import { prepareMapMedia } from "@/lib/quire/map-media";
import { readMapInterchange, MAP_INTERCHANGE_LIMIT } from "@/lib/quire/map-import";
import { cacheMapAsset, publishMapAsset, loadMapAsset, mapAssetBlob } from "@/lib/quire/map-assets";
import { mapMediaReference, type MapAssetBundle } from "@/lib/quire/map-assets-schema";
import { readMapTabletop, readTabletopSession } from "@/lib/quire/tabletop";
import { MapArtwork } from "./map-artwork";
import { MapBrowser, MapSessionBar } from "./map-session-bar";
import { useMapTabletopTools } from "./map-tabletop-tools";
import { MapPlayerPreview } from "./map-player-preview";
import { sceneTokenPoint } from "@/lib/quire/tabletop-geometry";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { CommandForm, CommandButton } from "./world-tools";
import { LocationOptions, MarketLocationsPanel } from "./market-locations";
import { Button, Fold } from "./ui";
import { AppLink } from "./app-link";
import { libraryRecordHref } from "@/lib/quire/library-records";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  Users,
  UserRound,
  Store,
  House,
  Mail,
  Flag,
  MapPin,
  EyeOff,
  Ship as ShipIcon,
  Swords,
  Hand,
  MousePointer2,
  Ruler,
  Shapes,
  Pencil,
  CloudFog,
  Sun,
  PanelRight,
  Grid3X3,
  Undo2,
  Redo2,
  Crosshair,
  Maximize,
  X,
  MoreHorizontal,
  Menu,
} from "lucide-react";
import { MapFrame } from "./map-frame";
import {
  groupMapRecords,
  mapRecordKinds,
  pingColors,
  type MapRecord,
  type MapPingInput,
} from "@/lib/quire/map-signals";
import { useMapPings } from "@/lib/quire/use-map-pings";
import type { CloudTable } from "@/lib/quire/cloud";

const MapCombatWorkspace = lazy(() =>
  import("./map-combat-workspace").then((m) => ({ default: m.MapCombatWorkspace })),
);
const MapServicePanel = lazy(() =>
  import("./map-service-panel").then((m) => ({ default: m.MapServicePanel })),
);

export function CampaignMaps() {
  const seat = useSeat(),
    known = useSeatKnown();
  const { ready } = useEconomy();
  const scope = captureMutationScope();
  const key = mapViewKey(scope, seat.role, seat.purseIds);
  if (!known || !ready)
    return (
      <div className="map-workspace-loading" role="status">
        Opening Maps…
      </div>
    );
  return <CampaignMapWorkspace key={key} viewScope={{ key, ephemeral: scope.ephemeral }} />;
}
function CampaignMapWorkspace({ viewScope }: { viewScope: { key: string; ephemeral: boolean } }) {
  const [handouts, setHandouts] = useState<Handout[]>([]);
  useEffect(() => {
    let cancelled = false;
    const campaign = activeCampaignId();
    const load = () =>
      void loadHandouts()
        .then((rows) => {
          if (!cancelled && activeCampaignId() === campaign) setHandouts(rows);
        })
        .catch(() => {
          if (!cancelled) setHandouts([]);
        });
    load();
    const unsubscribe = subscribeWorkspaceChanges((change) => {
      if (change.kind === "data") load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  const t = { ...useWorldTable(), handouts },
    w = readWorld(t.journal.world),
    seat = useSeat(),
    dm = seat.role === "dm",
    tabletopSession = readTabletopSession(t),
    market = readMarketLocations(t.journal.market);
  const [remembered] = useState(() =>
    readMapView(viewScope.key, mapViewStorage(viewScope.ephemeral)),
  );
  const [selected, setSelected] = useState(""),
    [editing, setEditing] = useState<CampaignMap | null | undefined>(),
    [placement, setPlacement] = useState<"" | "anchor" | "marker" | "party" | "token" | "record">(
      "",
    ),
    [location, setLocation] = useState(""),
    [point, setPoint] = useState<{ x: number; y: number }>(),
    [label, setLabel] = useState(""),
    [description, setDescription] = useState(""),
    [secret, setSecret] = useState(false),
    [typeFilter, setTypeFilter] = useState(""),
    [tileMode, setTileMode] = useState(true),
    [selectedToken, setSelectedToken] = useState("");
  const requestedMap = useRouterState({ select: (s) => s.location.search.map });
  const navigate = useNavigate(),
    router = useRouter();
  const [entryCamera, setEntryCamera] = useState<{
    mapId: string;
    view: { x: number; y: number; zoom: number };
    nonce: string;
  }>();
  const [history, setHistory] = useState<string[]>([]),
    lastMap = useRef(""),
    returningMap = useRef("");
  useEffect(() => {
    if (typeof requestedMap === "string") {
      setSelected(requestedMap);
      setTypeFilter("");
    }
  }, [requestedMap]);
  function selectMap(
    id: string,
    entry?: { x: number; y: number; zoom: number },
    returning = false,
  ) {
    returningMap.current = returning ? id : "";
    if (entry) setEntryCamera({ mapId: id, view: entry, nonce: crypto.randomUUID() });
    else setEntryCamera(undefined);
    if (requestedMap === id) {
      if (allowContextChange()) {
        setSelected(id);
        setTypeFilter("");
      }
    } else
      void navigate({ to: "/maps", search: { map: id } }).then(() => {
        if (router.state.location.search.map === id) {
          setSelected(id);
          setTypeFilter("");
        }
      });
  }

  const seenActivation = useRef(tabletopSession.activationId);
  useEffect(() => {
    const changed = seenActivation.current !== tabletopSession.activationId;
    seenActivation.current = tabletopSession.activationId;
    if (!dm && tabletopSession.activeMapId && (changed || !tabletopSession.playerBrowsing)) {
      setTypeFilter("");
      setSelected(tabletopSession.activeMapId);
      setSelectedToken("");
      setPlacement("");
      setPoint(undefined);
    }
  }, [
    dm,
    tabletopSession.activeMapId,
    tabletopSession.activationId,
    tabletopSession.playerBrowsing,
  ]);
  const allMaps = w.maps.filter(
      (m) =>
        dm ||
        (m.visible &&
          (tabletopSession.playerBrowsing ||
            !tabletopSession.activeMapId ||
            tabletopSession.activeMapId === m.id)),
    ),
    maps = allMaps.filter((m) => !typeFilter || mapType(m, t) === typeFilter),
    best = [...locationPath(market, market.currentLocationId)]
      .reverse()
      .map((l) => maps.find((m) => m.locationId === l.id))
      .find(Boolean);
  const map =
    maps.find(
      (m) =>
        m.id ===
        accessibleMapId(
          maps.map((m) => m.id),
          selected || requestedMap || undefined,
          remembered.lastMapId,
          tabletopSession.activeMapId || undefined,
        ),
    ) ??
    maps.find((m) => m.id === w.partyPosition?.mapId) ??
    best ??
    maps.find((m) => !m.locationId) ??
    maps[0];
  const combatPresentation =
    dm && w.combat?.phase === "active" && w.combat.mapId === map?.id
      ? w.combat.mode
      : tabletopSession.presentation?.mapId === map?.id
        ? tabletopSession.presentation?.mode
        : undefined;
  const effectiveTileMode =
    !!map?.grid && (combatPresentation ? combatPresentation === "grid" : tileMode);
  const viewedMapId = map?.id;
  useEffect(() => {
    if (!viewedMapId || lastMap.current === viewedMapId) return;
    const previous = lastMap.current;
    lastMap.current = viewedMapId;
    saveMapView(viewScope.key, viewedMapId, undefined, mapViewStorage(viewScope.ephemeral));
    const returning = returningMap.current === viewedMapId;
    returningMap.current = "";
    setHistory((h) => (returning ? h.slice(0, -1) : previous ? [...h, previous].slice(-100) : h));
    setSelectedToken("");
    setPlacement("");
    setPoint(undefined);
  }, [viewedMapId, viewScope.key, viewScope.ephemeral]);
  const party =
    map &&
    (w.partyPosition?.mapId === map.id &&
    w.partyPosition.x !== undefined &&
    w.partyPosition.y !== undefined
      ? { x: w.partyPosition.x, y: w.partyPosition.y }
      : anchorFor(map, t, market.currentLocationId));
  function recordsForMap(map: CampaignMap): MapRecord[] {
    const inferredPins = [
      ...t.holdings
        .filter(
          (h) =>
            h.kind === "property" &&
            h.quantity > 0 &&
            (dm ||
              seat.purseIds.includes(h.purseId) ||
              t.journal.propertyOperations?.sites.some((s) => s.propertyId === h.id)),
        )
        .map((h) => ({
          id: h.id,
          label: h.name,
          kind: "Property",
          point: anchorFor(map, t, h.locationId),
          href: libraryRecordHref("property", h.id),
        })),
      ...t.shops
        .filter((s) => dm || shopVisible(s, t))
        .map((s) => ({
          id: s.id,
          label: s.name,
          kind: s.blackMarket ? "Black market" : "Shop",
          point: anchorFor(map, t, s.locationId),
          href: libraryRecordHref("shop", s.id),
        })),
      ...w.npcs
        .filter((n) => dm || npcAvailableHere(n, t))
        .map((n) => ({
          id: n.id,
          label: n.name,
          kind: "NPC",
          point: anchorFor(
            map,
            t,
            characterLocation(
              t,
              t.purses.find((p) => p.id === n.id)!,
            ),
          ),
          href: libraryRecordHref("npc", n.id),
        })),
      ...t.purses
        .filter(
          (p) =>
            p.kind === "character" &&
            !w.npcs.some((n) => n.id === p.id) &&
            (dm || characterVisible(t, p)),
        )
        .map((p) => ({
          id: p.id,
          label: p.name,
          kind: p.control === "npc" ? "NPC" : "Character",
          point: anchorFor(map, t, characterLocation(t, p)),
          href: libraryRecordHref("character", p.id),
        })),
      ...(t.journal.propertyOperations?.postal.offices ?? []).flatMap((p) => {
        const s = t.shops.find((s) => s.id === p.shopId);
        return s
          ? [
              {
                id: s.id,
                label: s.name,
                kind: "Post office",
                point: anchorFor(map, t, s.locationId),
                href: libraryRecordHref("shop", s.id),
              },
            ]
          : [];
      }),
      ...(t.journal.fleet?.voyages ?? [])
        .filter(
          (v) =>
            v.mapRoute?.mapId === map.id && ["active", "blocked", "arrived"].includes(v.status),
        )
        .map((v) => ({
          id: `voyage-${v.id}`,
          label: t.holdings.find((h) => h.id === v.propertyId)?.name ?? "Ship voyage",
          kind: "Ship",
          point: routePosition(v.mapRoute!, v.elapsedMinutes / v.durationMinutes),
          href: libraryRecordHref("property", v.propertyId),
        })),
    ].filter((p) => p.point);
    const referenceFor = (p: { id: string; kind: string }): MapRecordReference | undefined => {
      const kind = (
        {
          Property: "property",
          Shop: "shop",
          "Black market": "shop",
          NPC: "npc",
          Character: "character",
          "Post office": "shop",
          Location: "location",
        } as const
      )[p.kind as "Property"];
      return kind ? { kind, id: p.id } : undefined;
    };
    const placed = map?.connected?.placements ?? [];
    const placedRefs = map?.connected?.placedRecords ?? placed.map((p) => p.record);
    const recordKey = (r: MapRecordReference) => JSON.stringify([r.kind, r.id]);
    const placedKeys = new Set(placedRefs.map(recordKey));
    return [
      ...inferredPins.flatMap((p) => {
        const reference = referenceFor(p);
        return reference && placedKeys.has(recordKey(reference)) ? [] : [{ ...p, reference }];
      }),
      ...placed
        .filter((p) => dm || p.visibility === "party")
        .flatMap((p) => {
          const label = p.label ?? mapReferenceName(t, p.record);
          if (!label) return [];
          const kind = (
            {
              location: "Location",
              shop: "Shop",
              npc: "NPC",
              character: "Character",
              property: "Property",
              listing: "Listing",
              exchange: "Exchange",
              facility: "Dock",
              entry: "Journal",
              handout: "Handout",
            } as const
          )[p.record.kind];
          return [
            {
              id: p.record.id,
              label,
              kind,
              point: p,
              reference: p.record,
              href: libraryRecordHref(p.record.kind, p.record.id),
            },
          ];
        }),
      ...(map?.connected?.links ?? [])
        .filter((p) => dm || p.visibility === "party")
        .flatMap((l) =>
          allMaps.some((m) => m.id === l.targetMapId)
            ? [
                {
                  id: l.id,
                  label: l.label,
                  kind: "Map",
                  point: l,
                  targetMapId: l.targetMapId,
                  entry: l.entry,
                },
              ]
            : [],
        ),
    ];
  }
  const pins = map ? recordsForMap(map) : [];
  const placedKeys = new Set(
    (map?.connected?.placedRecords ?? map?.connected?.placements.map((p) => p.record) ?? []).map(
      (r) => JSON.stringify([r.kind, r.id]),
    ),
  );
  const recordKey = (r: MapRecordReference) => JSON.stringify([r.kind, r.id]);
  const navigation = map && (
    <nav className="map-scene-navigation" aria-label="Connected map navigation">
      <Button
        disabled={!history.some((id) => maps.some((m) => m.id === id))}
        onClick={() => {
          const id = [...history].reverse().find((id) => maps.some((m) => m.id === id));
          if (id) selectMap(id, undefined, true);
        }}
      >
        Back to map
      </Button>
      <div className="map-breadcrumbs">
        {mapAncestry(maps, map).map((m) => (
          <Button
            key={m.id}
            aria-current={m.id === map.id ? "page" : undefined}
            onClick={() => selectMap(m.id)}
          >
            {m.name}
          </Button>
        ))}
      </div>
      <label>
        Map
        <SearchSelect aria-label="Map" value={map.id} onValueChange={(id) => selectMap(id)}>
          {maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.visible ? "" : " (DM only)"}
            </option>
          ))}
        </SearchSelect>
      </label>
    </nav>
  );
  const management = (
    <>
      <SyncStatus compact />{" "}
      <p className="text-muted">
        {partyEnvironment(w.partyPosition) || locationLabel(market, market.currentLocationId)} ·{" "}
        {party
          ? "Party position shown"
          : "Choose a map position or link a location to show the party"}
      </p>
      <MapBrowser maps={maps} current={map?.id} select={(id) => selectMap(id)} />
      <div className="world-toolbar">
        <AppLink className="settings-link" href="/features/npcs">
          People & NPCs →
        </AppLink>
        <AppLink className="settings-link" href="/features/trading">
          Trading & Barter →
        </AppLink>
        <label>
          Map type
          <SearchSelect
            aria-label="Map type filter"
            value={typeFilter}
            onValueChange={(v) => {
              setTypeFilter(v);
              setSelected("");
              setPlacement("");
              setPoint(undefined);
              setSelectedToken("");
            }}
          >
            <option value="">All map types</option>
            {mapTypes.map((v) => (
              <option key={v} value={v}>
                {v[0].toUpperCase() + v.slice(1)}
              </option>
            ))}
          </SearchSelect>
        </label>
        {dm && (
          <>
            <Button onClick={() => setEditing(null)}>Import map</Button>
            {map && <Button onClick={() => setEditing(map)}>Edit map & anchors</Button>}
          </>
        )}
      </div>
      {dm && (
        <Fold title="Manage campaign locations">
          <MarketLocationsPanel />
        </Fold>
      )}
    </>
  );
  const setup = map && (
    <>
      {" "}
      <p className="text-sm text-muted">
        Drag to pan. Pinch or use the scroll wheel to zoom. Keyboard: arrows, +, − and Home. Markers
        update through the shared campaign.
      </p>
      {dm && (
        <PartyPlacement
          key={`party-placement-${map.id}`}
          map={map}
          table={t}
          point={placement === "party" ? point : undefined}
          begin={() => {
            setPlacement("party");
            setPoint(undefined);
          }}
          done={() => {
            setPoint(undefined);
            setPlacement("");
          }}
        />
      )}
      {dm && (
        <Fold
          title="Place map markers & locations"
          reveal={placement === "marker" || placement === "anchor"}
        >
          <div className="world-toolbar">
            <Button
              onClick={() => {
                setPlacement("marker");
                setPoint(undefined);
              }}
            >
              Choose marker position
            </Button>
            <Button
              onClick={() => {
                setPlacement("anchor");
                setPoint(undefined);
              }}
            >
              Link location
            </Button>
            <Button
              onClick={() => {
                setPlacement("");
                setPoint(undefined);
              }}
            >
              Stop placing
            </Button>
          </div>
          {placement && (
            <p role="status">
              Tap the map to place{" "}
              {placement === "anchor"
                ? "a location anchor"
                : placement === "party"
                  ? "the party"
                  : placement === "token"
                    ? "a combat token"
                    : "a marker"}
              .
            </p>
          )}
          {point && placement === "anchor" && (
            <CommandForm
              label="Save location anchor"
              dirty
              submit={() => {
                if (!location) throw Error("Choose an existing location.");
                return {
                  kind: "map-save",
                  mapId: map.id,
                  before: map,
                  map: {
                    ...map,
                    anchors: [
                      ...map.anchors.filter((a) => a.locationId !== location),
                      { locationId: location, ...point },
                    ],
                  },
                };
              }}
              onDone={() => {
                setPoint(undefined);
                setPlacement("");
              }}
            >
              <label>
                Linked location
                <SearchSelect
                  aria-label="Linked location"
                  required
                  value={location}
                  onValueChange={(selectedValue) => setLocation(selectedValue)}
                >
                  <option value="">Choose location</option>
                  {LocationOptions({ market: market })}
                </SearchSelect>
              </label>
            </CommandForm>
          )}
          {point && placement === "marker" && (
            <CommandForm
              label="Save live marker"
              dirty
              submit={() => {
                const id = crypto.randomUUID();
                return {
                  kind: "map-marker",
                  mapId: map.id,
                  markerId: id,
                  before: null,
                  marker: {
                    id,
                    label,
                    description,
                    visibility: secret ? "dm" : "party",
                    ...point,
                  },
                };
              }}
              onDone={() => {
                setPoint(undefined);
                setPlacement("");
                setLabel("");
                setDescription("");
              }}
            >
              <label>
                Marker name
                <input
                  required
                  maxLength={160}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <label>
                Details
                <textarea
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={secret}
                  onChange={(e) => setSecret(e.target.checked)}
                />
                DM only
              </label>
            </CommandForm>
          )}
        </Fold>
      )}
      <section className="world-register">
        <h2>Map register</h2>
        {map.anchors.map((a) => (
          <div key={a.locationId} className="world-row">
            <span>
              <AppLink href={libraryRecordHref("location", a.locationId)}>
                {locationLabel(market, a.locationId)} →
              </AppLink>
              {a.locationId === market.currentLocationId ? " · Party here" : ""}
            </span>
            {dm && (
              <CommandButton
                input={{
                  kind: "party-location",
                  beforePosition: canonicalJson(t.journal.world?.partyPosition ?? null),
                  before: market.currentLocationId,
                  locationId: a.locationId,
                }}
              >
                Move party here
              </CommandButton>
            )}
          </div>
        ))}
        {map.markers
          .filter((m) => dm || m.visibility === "party")
          .map((m) => (
            <div key={m.id} className="world-row">
              <span>
                <strong>
                  {m.label}
                  {m.visibility === "dm" ? " · DM only" : ""}
                </strong>
                <p>{m.description}</p>
              </span>
              {dm && (
                <CommandButton
                  input={{
                    kind: "map-marker",
                    mapId: map.id,
                    markerId: m.id,
                    before: m,
                    marker: null,
                  }}
                >
                  Remove marker
                </CommandButton>
              )}
            </div>
          ))}
        {pins.map((p) =>
          p.targetMapId ? (
            <Button key={p.id} onClick={() => selectMap(p.targetMapId!, p.entry)}>
              Open {p.label}
            </Button>
          ) : p.href ? (
            <AppLink key={`${p.kind}-${p.id}`} className="settings-link" href={p.href}>
              {p.kind} · {p.label} →
            </AppLink>
          ) : null,
        )}
        {!party && (
          <p>No party position on this map. Link a location anchor or place the party freely.</p>
        )}
      </section>
    </>
  );
  return (
    <div className="campaign-maps">
      {map ? (
        <>
          <MapViewport
            map={map}
            navigation={navigation}
            maps={allMaps}
            indexedRecords={allMaps.flatMap((m) =>
              recordsForMap(m).map((record) => ({ mapId: m.id, context: m.name, record })),
            )}
            settings={
              <>
                {management}
                {setup}
              </>
            }
            viewScope={viewScope}
            toggleGrid={() => {
              if (!combatPresentation) setTileMode(!tileMode);
            }}
            gridLocked={!!combatPresentation}
            beginMarker={() => {
              setPlacement("marker");
              setPoint(undefined);
            }}
            beginRecord={() => {
              setPlacement("record");
              setPoint(undefined);
            }}
            placementKind={placement}
            recordTable={t}
            entryCamera={entryCamera}
            selectMap={selectMap}
            locationMaps={(id) => mapsForLocation(allMaps, id)}
            openLocation={(id) => {
              const target = defaultLocationMap(
                allMaps.filter((m) => m.id !== map.id),
                id,
              );
              if (target) {
                selectMap(target.id);
                return true;
              }
              return false;
            }}
            party={party}
            selectedToken={selectedToken}
            tileMode={effectiveTileMode}
            routes={(t.journal.fleet?.voyages ?? [])
              .filter(
                (v) =>
                  v.mapRoute?.mapId === map.id &&
                  ["active", "blocked", "arrived"].includes(v.status),
              )
              .map((v) => ({
                id: v.id,
                points: v.mapRoute!.points.map((p) => tilePoint(v.mapRoute!.grid, p)),
              }))}
            onTokenSelect={(id) => {
              setSelectedToken(id);
              setPlacement("");
              setPoint(undefined);
            }}
            controls={
              <>
                <MapSessionBar map={map} />
                {dm && (
                  <MapConnectedTools
                    reveal={placement === "record"}
                    key={`connected-${map.id}`}
                    map={map}
                    table={t}
                    point={placement === "record" ? point : undefined}
                    begin={() => {
                      setPlacement("record");
                      setPoint(undefined);
                    }}
                    done={() => {
                      setPlacement("");
                      setPoint(undefined);
                    }}
                  />
                )}

                {map.grid && (
                  <Button
                    aria-pressed={effectiveTileMode}
                    disabled={!!combatPresentation}
                    title={
                      combatPresentation
                        ? "Return to exploration to change the local grid view."
                        : undefined
                    }
                    onClick={() => {
                      setTileMode(!tileMode);
                      setPlacement("");
                      setPoint(undefined);
                    }}
                  >
                    {combatPresentation
                      ? effectiveTileMode
                        ? "Encounter grid active"
                        : "Encounter theatre view"
                      : tileMode
                        ? "Leave tile mode"
                        : "Enter tile mode"}
                  </Button>
                )}
                {effectiveTileMode &&
                  map.grid &&
                  (dm ? (
                    <Fold title="Combat tiles" defaultOpen>
                      <CombatControls
                        key={`combat-${map.id}`}
                        map={map}
                        table={t}
                        point={placement === "token" ? point : undefined}
                        selected={selectedToken}
                        select={(id) => {
                          setSelectedToken(id);
                          setPoint(undefined);
                        }}
                        begin={() => {
                          setPlacement("token");
                          setPoint(undefined);
                        }}
                        done={() => {
                          setPoint(undefined);
                          setPlacement("");
                        }}
                      />
                    </Fold>
                  ) : (
                    <p>
                      Combat grid · {map.grid.feetPerTile} ft per tile. Move assigned tokens when
                      permitted by the DM; only authorized combatants are shown.
                    </p>
                  ))}
              </>
            }
            placing={!!placement}
            stopPlacing={() => {
              setPlacement("");
              setPoint(undefined);
            }}
            point={point}
            onPlace={setPoint}
            entities={[
              ...pins,
              ...map.anchors
                .filter((a) => !placedKeys.has(recordKey({ kind: "location", id: a.locationId })))
                .map((a) => ({
                  id: a.locationId,
                  label: locationLabel(market, a.locationId),
                  kind: "Location",
                  reference: { kind: "location" as const, id: a.locationId },
                  point: a,
                  href: libraryRecordHref("location", a.locationId),
                })),
            ]}
          />
        </>
      ) : (
        <MapEmptyWorkspace dm={dm} settings={management} />
      )}
      {editing !== undefined && dm && (
        <MapEditor
          key={editing?.id ?? "new"}
          map={editing ?? undefined}
          table={t}
          close={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}
function MapEditor({
  map,
  table,
  close,
}: {
  map?: CampaignMap;
  table: CloudTable;
  close: () => void;
}) {
  const [draft, setDraft] = useState<CampaignMap>(
      map ?? {
        id: crypto.randomUUID(),
        name: "",
        image: "",
        locationId: null,
        visible: false,
        anchors: [],
        markers: [],
      },
    ),
    [mediaBundle, setMediaBundle] = useState<MapAssetBundle>(),
    [importWarnings, setImportWarnings] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const market = readMarketLocations(table.journal?.market);
  return (
    <MapFrame
      editor
      onClose={() => {
        if (allowContextChange()) close();
      }}
    >
      <section className="journal-entry">
        <h2>{map ? "Edit map" : "Import a map"}</h2>
        <CommandForm
          label="Save map"
          dirty
          submitDisabled={busy}
          submit={async () => {
            if (busy) throw Error("Wait for the image to finish processing.");
            if (!draft.image)
              throw Error("Choose a map image before saving. Your draft is retained.");
            if (!draft.name.trim()) throw Error("Enter a map name before saving.");
            if (mediaBundle) await publishMapAsset(mediaBundle, setProgress);
            return { kind: "map-save", mapId: draft.id, before: map ?? null, map: draft };
          }}
          onDone={close}
        >
          <label>
            Map name
            <input
              required
              maxLength={160}
              value={draft.name}
              onChange={(e) => {
                const name = e.target.value;
                setDraft((current) => ({ ...current, name }));
              }}
            />
          </label>
          <label>
            Map category
            <SearchSelect
              aria-label="Map category"
              value={mapType(draft, table)}
              onValueChange={(type) => setDraft({ ...draft, type: type as CampaignMap["type"] })}
            >
              {mapTypes.map((v) => (
                <option key={v} value={v}>
                  {v[0].toUpperCase() + v.slice(1)}
                </option>
              ))}
            </SearchSelect>
          </label>
          <label>
            Linked property / ship
            <SearchSelect
              aria-label="Linked property / ship"
              value={draft.propertyId ?? ""}
              onValueChange={(id) => setDraft({ ...draft, propertyId: id || undefined })}
            >
              <option value="">No property link</option>
              {table.holdings
                .filter((h) => h.kind === "property" && h.quantity > 0)
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
            </SearchSelect>
          </label>
          <GridEditor map={draft} set={setDraft} />
          <label>
            Map location
            <SearchSelect
              aria-label="Map location"
              value={draft.locationId ?? ""}
              onValueChange={(selectedValue) => {
                const locationId = selectedValue || null;
                setDraft((current) => ({ ...current, locationId }));
              }}
            >
              <option value="">World / campaign map</option>
              {LocationOptions({ market: market })}
            </SearchSelect>
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.visible}
              onChange={(e) => {
                const visible = e.target.checked;
                setDraft((current) => ({ ...current, visible }));
              }}
            />
            Share this map image with players
          </label>
          <label>
            Map artwork or video
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,.uvtt,.dd2vtt,.df2vtt"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                setError("");
                setProgress("Preparing map image… You can fill in the map details while you wait.");
                try {
                  const interchange = /\.(uvtt|dd2vtt|df2vtt)$/i.test(file.name);
                  if (interchange && file.size > MAP_INTERCHANGE_LIMIT)
                    throw Error("Choose a Universal VTT file up to 30 MB.");
                  const imported = interchange ? readMapInterchange(await file.text()) : undefined;
                  if (imported && map?.tokens?.length)
                    throw Error(
                      "Import this file as a new map to preserve the existing scene's tokens and grid.",
                    );
                  const bundle = await prepareMapMedia(
                    imported
                      ? new File([imported.bytes.buffer as ArrayBuffer], "map", {
                          type: imported.mime,
                        })
                      : file,
                  );
                  if (
                    imported &&
                    (bundle.manifest.width !== imported.width ||
                      bundle.manifest.height !== imported.height)
                  )
                    throw Error(
                      "Embedded image dimensions do not match the exported grid. Correct the export before importing.",
                    );
                  await cacheMapAsset(bundle);
                  setMediaBundle(bundle);
                  setImportWarnings(imported?.warnings ?? []);
                  setDraft((current) => ({
                    ...current,
                    ...(imported
                      ? { visible: false, grid: imported.grid, type: "battle" as const }
                      : {}),
                    image: bundle.manifest.preview,
                    anchors: [],
                    tabletop: {
                      ...(imported?.settings ?? readMapTabletop(current)),
                      media: mapMediaReference(bundle.manifest),
                      frames: [],
                    },
                  }));
                  setProgress("Map image ready. Review the details, then save the map.");
                } catch (e) {
                  setProgress("");
                  setError(e instanceof Error ? e.message : "Map import failed.");
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          {importWarnings.length > 0 && (
            <section className="map-import-review" aria-label="Map import review">
              <strong>Review imported map before saving</strong>
              <p>
                {draft.tabletop?.walls.length ?? 0} walls / doors ·{" "}
                {draft.tabletop?.lights.length ?? 0} lights · {draft.grid?.columns} ×{" "}
                {draft.grid?.rows} cells
              </p>
              <ul>
                {importWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </section>
          )}
          <p className="text-sm text-muted">
            PNG, JPEG, WebP, MP4 or WebM up to 20 MB, 8192 pixels per edge and 64 megapixels.
            Original detail is retained separately from optimized previews. Video starts paused.
            Protected video scenes use a still player view. Share only artwork you have permission
            to use.
          </p>
          {draft.image && (
            <>
              <img className="map-preview" src={draft.image} alt="Imported map preview" />
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  setProgress("Reading location labels… You can continue editing the map details.");
                  try {
                    let url: string | undefined;
                    try {
                      if (draft.tabletop?.media?.mime.startsWith("image/"))
                        url = URL.createObjectURL(
                          await mapAssetBlob(
                            mediaBundle ?? (await loadMapAsset(draft.id, draft.tabletop.media)),
                          ),
                        );
                      const result = await recognizeMap(url ?? draft.image, setProgress);
                      const matches = recognizedAnchors(
                        result.lines,
                        result.width,
                        result.height,
                        table,
                      );
                      setDraft((current) => ({
                        ...current,
                        anchors: [
                          ...current.anchors,
                          ...matches.filter(
                            (a) => !current.anchors.some((b) => a.locationId === b.locationId),
                          ),
                        ],
                      }));
                      setProgress(
                        `${matches.length} unique location labels matched. Review their positions before saving; ambiguous or unreadable labels can be linked manually.`,
                      );
                    } finally {
                      if (url) URL.revokeObjectURL(url);
                    }
                  } catch (e) {
                    setProgress("");
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Recognition failed. Link locations manually.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Read location labels
              </Button>
            </>
          )}
          {draft.anchors.map((a) => (
            <div className="world-row" key={a.locationId}>
              <span>
                {locationLabel(market, a.locationId)} · {Math.round(a.x * 100)}%,{" "}
                {Math.round(a.y * 100)}%
              </span>
              <Button
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    anchors: current.anchors.filter((b) => b !== a),
                  }))
                }
              >
                Remove anchor
              </Button>
            </div>
          ))}
          {progress && <p role="status">{progress}</p>}
          {error && <p role="alert">{error}</p>}
        </CommandForm>
        <Button onClick={close}>Close editor</Button>
        {map && (
          <CommandButton input={{ kind: "map-save", mapId: map.id, before: map, map: null }}>
            Remove map
          </CommandButton>
        )}
      </section>
    </MapFrame>
  );
}
function MapViewport({
  map,
  maps,
  indexedRecords,
  settings: setupSettings,
  viewScope,
  toggleGrid,
  gridLocked,
  beginMarker,
  beginRecord,
  placementKind,
  navigation,
  entryCamera,
  selectMap,
  locationMaps,
  openLocation,
  recordTable,
  party,
  placing,
  point,
  onPlace,
  entities,
  stopPlacing,
  tileMode,
  routes,
  controls,
  onTokenSelect,
  selectedToken,
}: {
  map: CampaignMap;
  maps: CampaignMap[];
  indexedRecords: { mapId: string; context: string; record: MapRecord }[];
  settings: ReactNode;
  viewScope: { key: string; ephemeral: boolean };
  toggleGrid: () => void;
  gridLocked: boolean;
  beginMarker: () => void;
  beginRecord: () => void;
  placementKind: string;
  navigation: ReactNode;
  recordTable: CloudTable;
  entryCamera?: { mapId: string; view: { x: number; y: number; zoom: number }; nonce: string };
  selectMap: (id: string, entry?: { x: number; y: number; zoom: number }) => void;
  locationMaps: (id: string) => CampaignMap[];
  openLocation: (id: string) => boolean;
  party?: { x: number; y: number };
  placing: boolean;
  point?: { x: number; y: number };
  onPlace: (p: { x: number; y: number }) => void;
  entities: MapRecord[];
  stopPlacing: () => void;
  tileMode: boolean;
  routes: { id: string; points: { x: number; y: number }[] }[];
  controls: ReactNode;
  onTokenSelect?: (id: string) => void;
  selectedToken: string;
}) {
  const [visible, setVisible] = useState<string[]>([...mapRecordKinds]),
    [filtersOpen, setFiltersOpen] = useState(false),
    [gridVisible, setGridVisible] = useState(true),
    [details, setDetails] = useState<MapRecord[]>([]),
    [service, setService] = useState<MapRecordReference>(),
    [serviceExpanded, setServiceExpanded] = useState(false),
    [combatOpen, setCombatOpen] = useState(false),
    [pinging, setPinging] = useState(false),
    [color, setColor] = useState<MapPingInput["color"]>("blue"),
    [full] = useState(true),
    [drawerOpen, setDrawerOpen] = useState(false),
    [interfaceHidden, setInterfaceHidden] = useState(false),
    [hotbarOpen, setHotbarOpen] = useState(true),
    [moreTools, setMoreTools] = useState(false),
    [contextOpen, setContextOpen] = useState(false),
    [settingsTab, setSettingsTab] = useState<"settings" | "places">("settings");
  const serviceTable = recordTable;
  const closeService = () => {
    if (allowContextChange()) {
      setService(undefined);
      setServiceExpanded(false);
    }
  };
  useLayoutEffect(() => {
    setDetails([]);
    setService(undefined);
    setServiceExpanded(false);
    setPinging(false);
    setDrawerOpen(false);
  }, [map.id]);
  useEffect(() => {
    if (placing && full) {
      setDrawerOpen(!!point);
      if (point) setSettingsTab("settings");
    }
  }, [placing, point, full]);
  const signals = useMapPings(map.id),
    useDm = useSeat().role === "dm",
    tools = useMapTabletopTools(map, selectedToken, onTokenSelect);
  const sketches = useMapSketches(viewScope, map.id);
  useEffect(() => {
    if (full && tools.inspecting) setDrawerOpen(false);
  }, [full, tools.inspecting]);
  const records: MapRecord[] = [
    ...map.markers
      .filter((m) => m.visibility === "party" || useDm)
      .map((m) => ({
        id: m.id,
        label: m.label,
        description: m.description,
        kind: "Marker",
        point: m,
        href: libraryRecordHref("marker", map.id, m.id),
      })),
    ...entities,
    ...(tileMode && map.grid
      ? (map.tokens ?? [])
          .filter((t) => useDm || t.visibility === "party")
          .map((token) => ({
            id: token.id,
            label: token.label,
            kind: token.kind === "ship" ? "Ship" : "Combatant",
            point: sceneTokenPoint(map.grid!, token),
            description: `Column ${token.column + 1}, row ${token.row + 1}${token.visibility === "dm" ? " · DM only" : ""}`,
          }))
      : []),
    ...(party ? [{ id: "party", label: "Party", kind: "Party", point: party }] : []),
  ];
  const groups = groupMapRecords(records, visible);
  const currentDetails = details.flatMap((d) => {
    const match = records.filter((r) => r.id === d.id && r.kind === d.kind);
    return match.length
      ? match
      : d.kind === "Location" && map.anchors.some((a) => a.locationId === d.id)
        ? [d]
        : [];
  });
  useEffect(() => {
    setDetails([]);
  }, [selectedToken]);
  useEffect(() => {
    if (placing || signals.viewOnly) setPinging(false);
    if (placing) setDetails([]);
  }, [placing, signals.viewOnly]);
  const root = useRef<HTMLDivElement>(null),
    toolPointer = useRef<number | undefined>(undefined),
    [artwork, setArtwork] = useState({ mapId: "", ratio: 1 }),
    [size, setSize] = useState({ w: 1, h: 1 }),
    [view, setView] = useState({ x: 0, y: 0, scale: 1 }),
    viewRef = useRef(view),
    pointers = useRef(new Map<number, { x: number; y: number }>()),
    moved = useRef(false),
    start = useRef({ x: 0, y: 0 });
  const ratio = map.tabletop?.media
    ? map.tabletop.media.width / map.tabletop.media.height
    : artwork.mapId === map.id
      ? artwork.ratio
      : 1;
  const artworkReady = !!map.tabletop?.media || artwork.mapId === map.id;
  const w = Math.min(size.w, size.h * ratio),
    h = w / ratio;
  const fit = () => setView({ x: (size.w - w) / 2, y: (size.h - h) / 2, scale: 1 });
  viewRef.current = view;
  useEffect(() => {
    const el = root.current!;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [cameras] = useState(
    () =>
      new Map(
        Object.entries(readMapView(viewScope.key, mapViewStorage(viewScope.ephemeral)).cameras),
      ),
  );
  const cameraNonce =
    entryCamera?.mapId === map.id
      ? entryCamera.nonce
      : !useDm && tools.session.camera?.mapId === map.id
        ? tools.session.camera.nonce
        : undefined;
  const previousViewport = useRef<
    | {
        mapId: string;
        nonce?: string;
        width: number;
        height: number;
        w: number;
        h: number;
      }
    | undefined
  >(undefined);
  useLayoutEffect(() => {
    if (!artworkReady || size.w <= 1 || size.h <= 1) return;
    const previous = previousViewport.current;
    if (previous && previous.mapId !== map.id && previous.w > 1 && previous.h > 1) {
      const v = viewRef.current;
      const previousCamera = {
        x: (previous.width / 2 - v.x) / (previous.w * v.scale),
        y: (previous.height / 2 - v.y) / (previous.h * v.scale),
        zoom: v.scale,
        basis: previous.w,
      };
      cameras.set(previous.mapId, previousCamera);
      saveMapView(
        viewScope.key,
        previous.mapId,
        previousCamera,
        mapViewStorage(viewScope.ephemeral),
      );
    }
    previousViewport.current = {
      mapId: map.id,
      nonce: cameraNonce,
      width: size.w,
      height: size.h,
      w,
      h,
    };
    if (
      previous &&
      previous.mapId === map.id &&
      previous.nonce === cameraNonce &&
      previous.width > 1 &&
      previous.height > 1
    ) {
      // Rotating a phone or resizing the workspace keeps the
      // same world point at the center instead of unexpectedly fitting the map.
      setView((v) => {
        const scale = Math.min(8, Math.max(0.5, (v.scale * previous.w) / w));
        return {
          scale,
          x: size.w / 2 - ((previous.width / 2 - v.x) * w * scale) / (previous.w * v.scale),
          y: size.h / 2 - ((previous.height / 2 - v.y) * h * scale) / (previous.h * v.scale),
        };
      });
      return;
    }
    const camera: MapCamera | undefined =
      entryCamera?.mapId === map.id
        ? entryCamera.view
        : !useDm && tools.session.camera?.mapId === map.id
          ? tools.session.camera.view
          : (cameras.get(map.id) ?? map.tabletop?.initialView);
    const cover = Math.min(8, Math.max(size.w / w, size.h / h));
    const restoredScale = camera
      ? Math.min(8, Math.max(0.5, (camera.zoom * (camera.basis ?? w)) / w))
      : cover;
    setView(
      camera
        ? {
            x: size.w / 2 - camera.x * w * restoredScale,
            y: size.h / 2 - camera.y * h * restoredScale,
            scale: restoredScale,
          }
        : { x: (size.w - w * cover) / 2, y: (size.h - h * cover) / 2, scale: cover },
    );
    // A DM camera action applies once. Ordinary room polling never drags a player's camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, w, h, map.id, cameraNonce, artworkReady]);
  const currentCamera = useCallback(
    () => ({
      x: Math.max(-5, Math.min(5, (size.w / 2 - view.x) / (w * view.scale))),
      y: Math.max(-5, Math.min(5, (size.h / 2 - view.y) / (h * view.scale))),
      zoom: view.scale,
    }),
    [size.w, size.h, view.x, view.y, view.scale, w, h],
  );
  const savedView = useRef<{ id: string; camera: MapCamera } | undefined>(undefined);
  useEffect(() => {
    if (artworkReady && size.w > 1 && size.h > 1 && previousViewport.current?.mapId === map.id)
      savedView.current = { id: map.id, camera: { ...currentCamera(), basis: w } };
    const timer = window.setTimeout(() => {
      const last = savedView.current;
      if (last)
        saveMapView(viewScope.key, last.id, last.camera, mapViewStorage(viewScope.ephemeral));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    map.id,
    view.x,
    view.y,
    view.scale,
    size.w,
    size.h,
    w,
    h,
    viewScope.key,
    viewScope.ephemeral,
    artworkReady,
    currentCamera,
  ]);
  useEffect(() => {
    const flush = () => {
      const last = savedView.current;
      if (last)
        saveMapView(viewScope.key, last.id, last.camera, mapViewStorage(viewScope.ephemeral));
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [viewScope.key, viewScope.ephemeral]);
  function zoom(factor: number, x: number, y: number) {
    setView((v) => {
      const scale = Math.min(8, Math.max(0.5, v.scale * factor)),
        f = scale / v.scale;
      return { scale, x: x - (x - v.x) * f, y: y - (y - v.y) * f };
    });
  }
  useEffect(() => {
    const el = root.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect(),
        v = viewRef.current,
        scale = Math.min(8, Math.max(0.5, v.scale * Math.exp(-e.deltaY * 0.002))),
        f = scale / v.scale,
        x = e.clientX - rect.left,
        y = e.clientY - rect.top;
      setView({ scale, x: x - (x - v.x) * f, y: y - (y - v.y) * f });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const center = (ps: { x: number; y: number }[]) => ({
    x: ps.reduce((n, p) => n + p.x, 0) / ps.length,
    y: ps.reduce((n, p) => n + p.y, 0) / ps.length,
  });
  function mapPoint(clientX: number, clientY: number) {
    const rect = root.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left - view.x) / (w * view.scale))),
      y: Math.max(0, Math.min(1, (clientY - rect.top - view.y) / (h * view.scale))),
    };
  }
  const openSettings = () => {
    if (!drawerOpen && (tools.inspecting || service || combatOpen) && !allowContextChange()) return;
    tools.hideInspector();
    setDetails([]);
    setService(undefined);
    setCombatOpen(false);
    setContextOpen(false);
    setDrawerOpen(!drawerOpen);
  };
  const openCombat = () => {
    if (!allowContextChange()) return;
    setCombatOpen(true);
    setMoreTools(false);
    setDetails([]);
    setService(undefined);
    setDrawerOpen(false);
    setContextOpen(false);
    tools.hideInspector();
  };
  const chooseTool = (tool: Parameters<typeof tools.activateTool>[0]) => {
    if (!tools.activateTool(tool)) return;
    stopPlacing();
    sketches.cancel();
    setPinging(false);
    setMoreTools(false);
    setDrawerOpen(false);
    setDetails([]);
    setService(undefined);
    setCombatOpen(false);
    setContextOpen(!["pan", "select"].includes(tool));
    root.current?.focus();
  };
  const focusRecord = (record: MapRecord) => {
    if (!allowContextChange()) return;
    if (record.point)
      setView((v) => ({
        ...v,
        x: size.w / 2 - record.point!.x * w * v.scale,
        y: size.h / 2 - record.point!.y * h * v.scale,
      }));
    setDetails([record]);
    setService(undefined);
    setDrawerOpen(false);
    setContextOpen(false);
    tools.hideInspector();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        (e.target as HTMLElement).closest(
          'dialog,[role="dialog"],[role="alertdialog"],.record-select-menu',
        )
      )
        return;
      if (e.key === "Escape") {
        if (drawerOpen) setDrawerOpen(false);
        else if (moreTools) setMoreTools(false);
        else if (service || details.length || combatOpen || tools.inspecting) {
          if (!allowContextChange()) return;
          setService(undefined);
          setDetails([]);
          setCombatOpen(false);
          tools.hideInspector();
        } else if (
          contextOpen ||
          placing ||
          pinging ||
          sketches.active ||
          !["pan", "select"].includes(tools.tool)
        ) {
          if (!allowContextChange()) return;
          tools.cancel();
          sketches.cancel();
          stopPlacing();
          setPinging(false);
          setContextOpen(false);
        } else return;
        e.preventDefault();
        root.current?.focus();
      }
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"],.map-viewport',
        ) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      const tool = ({ v: "pan", s: "select", m: "measure", t: "template" } as const)[
        e.key.toLowerCase() as "v"
      ];
      if (
        e.key.toLowerCase() === "p" &&
        !signals.viewOnly &&
        !drawerOpen &&
        !service &&
        !combatOpen &&
        allowContextChange()
      ) {
        e.preventDefault();
        tools.cancel();
        sketches.cancel();
        stopPlacing();
        setPinging(!pinging);
        root.current?.focus();
      }
      if (tool && !drawerOpen && !service && !combatOpen) {
        e.preventDefault();
        chooseTool(tool);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  const searchResults = [
    ...maps.map((m) => ({
      key: `map:${m.id}`,
      label: m.name,
      kind: "Map",
      context: mapType(m, recordTable),
      mapId: m.id,
    })),
    ...records.map((r) => ({
      key: `record:${map.id}:${r.kind}:${r.id}`,
      label: r.label,
      kind: r.kind,
      context: map.name,
      mapId: map.id,
      record: r,
    })),
    ...indexedRecords
      .filter((row) => row.mapId !== map.id)
      .map(({ mapId, context, record }) => ({
        key: `record:${mapId}:${record.kind}:${record.id}`,
        label: record.label,
        kind: record.kind,
        context,
        mapId,
        record,
      })),
    ...maps.flatMap((m) => [
      ...m.anchors
        .filter(
          (a) =>
            m.id !== map.id &&
            !(
              m.connected?.placedRecords ??
              m.connected?.placements.map((p) => p.record) ??
              []
            ).some((r) => r.kind === "location" && r.id === a.locationId),
        )
        .map((a) => ({
          key: `anchor:${m.id}:${a.locationId}`,
          label: locationLabel(readMarketLocations(recordTable.journal?.market), a.locationId),
          kind: "Location",
          context: m.name,
          mapId: m.id,
          record: {
            id: a.locationId,
            label: locationLabel(readMarketLocations(recordTable.journal?.market), a.locationId),
            kind: "Location",
            point: a,
            reference: { kind: "location" as const, id: a.locationId },
          },
        })),
      ...(m.id === map.id
        ? []
        : m.markers
            .filter((p) => useDm || p.visibility === "party")
            .map((p) => ({
              key: `marker:${m.id}:${p.id}`,
              label: p.label,
              kind: "Marker",
              context: m.name,
              mapId: m.id,
              record: { ...p, kind: "Marker", point: p },
            }))),
    ]),
  ];
  return (
    <MapFrame title={map.name} interfaceHidden={interfaceHidden}>
      <MapWorkspaceChrome
        map={map}
        maps={maps}
        navigation={navigation}
        results={searchResults}
        selectResult={(result) => {
          if (!allowContextChange()) return;
          if (result.mapId === map.id) {
            if (result.record) focusRecord(result.record);
          } else
            selectMap(
              result.mapId,
              result.record?.point ? { ...result.record.point, zoom: 1.5 } : undefined,
            );
        }}
        settingsOpen={drawerOpen}
        toggleSettings={openSettings}
        hidden={interfaceHidden}
        setHidden={(hidden) => {
          if (allowContextChange()) setInterfaceHidden(hidden);
        }}
      />
      <div
        id="map-settings"
        className="map-tool-drawer map-settings-drawer map-glass"
        hidden={!drawerOpen || interfaceHidden}
        role="region"
        aria-label="Map settings"
        onKeyDown={(e) => {
          if (
            e.defaultPrevented ||
            (e.target as HTMLElement).closest(
              'dialog,[role="dialog"],[role="alertdialog"],.record-select-menu',
            )
          )
            return;
          if (e.key === "Escape") {
            e.stopPropagation();
            setDrawerOpen(false);
            root.current?.focus();
          }
        }}
      >
        <div className="map-panel-heading">
          <div
            role="tablist"
            aria-label="Map settings tabs"
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
              e.preventDefault();
              const next =
                e.key === "Home"
                  ? "settings"
                  : e.key === "End"
                    ? "places"
                    : settingsTab === "settings"
                      ? "places"
                      : "settings";
              setSettingsTab(next);
              e.currentTarget.querySelector<HTMLButtonElement>(`#map-tab-${next}`)?.focus();
            }}
          >
            <button
              role="tab"
              id="map-tab-settings"
              aria-controls="map-panel-settings"
              tabIndex={settingsTab === "settings" ? 0 : -1}
              aria-selected={settingsTab === "settings"}
              onClick={() => setSettingsTab("settings")}
            >
              Settings
            </button>
            <button
              role="tab"
              id="map-tab-places"
              aria-controls="map-panel-places"
              tabIndex={settingsTab === "places" ? 0 : -1}
              aria-selected={settingsTab === "places"}
              onClick={() => setSettingsTab("places")}
            >
              Places
            </button>
          </div>
          <button
            className="map-icon-button"
            aria-label="Close settings"
            onClick={() => {
              setDrawerOpen(false);
              root.current?.focus();
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div
          role="tabpanel"
          id="map-panel-places"
          aria-labelledby="map-tab-places"
          hidden={settingsTab !== "places"}
        >
          {records.map((record) => (
            <button
              className="map-place-row"
              key={`${record.kind}:${record.id}`}
              onClick={() => focusRecord(record)}
            >
              <strong>{record.label}</strong>
              <span>{record.kind}</span>
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="map-panel-settings"
          aria-labelledby="map-tab-settings"
          hidden={settingsTab !== "settings"}
        >
          {setupSettings}
          {tools.configurationControls}
          <button className="settings-link" onClick={() => tools.openInspector()}>
            Open inspector and object controls
          </button>
          <div className="world-toolbar map-controls">
            <Button aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
              Filters
            </Button>
            <label>
              Ping color
              <select
                aria-label="Ping color"
                value={color}
                onChange={(e) => setColor(e.target.value as MapPingInput["color"])}
              >
                {pingColors.map((c) => (
                  <option key={c} value={c}>
                    {c[0].toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            {useDm && (
              <>
                <Button
                  disabled={tools.busy || !map.visible}
                  onClick={() => void tools.shareCamera(currentCamera())}
                >
                  Share this view
                </Button>
                <Button
                  disabled={tools.busy}
                  onClick={() => void tools.saveInitialView(currentCamera())}
                >
                  Save starting view
                </Button>
              </>
            )}
          </div>
          {filtersOpen && (
            <fieldset className="map-filters">
              <legend>Show on map</legend>
              {mapRecordKinds.map((kind) => (
                <label key={kind}>
                  <input
                    type="checkbox"
                    checked={visible.includes(kind)}
                    onChange={(e) =>
                      setVisible((v) =>
                        e.target.checked ? [...v, kind] : v.filter((k) => k !== kind),
                      )
                    }
                  />
                  {kind === "NPC" ? "Characters / NPCs" : kind}
                </label>
              ))}
              <Button onClick={() => setVisible([...mapRecordKinds])}>Show all</Button>
              <Button onClick={() => setVisible([])}>Hide all</Button>
            </fieldset>
          )}
          {useDm && tools.showPreview && <MapPlayerPreview map={map} />}
          {pinging && (
            <p className="text-sm text-muted">
              Keyboard: pan to a point, then press Enter to ping the center crosshair. Escape turns
              ping mode off.
            </p>
          )}
          <div className="map-tile-control-area">{controls}</div>
        </div>
      </div>
      {!interfaceHidden && (
        <>
          <div className="map-hotbar-anchor">
            {hotbarOpen && (
              <div className="map-hotbar map-glass" role="toolbar" aria-label="Map tools">
                <button
                  className="map-icon-button"
                  title="Pan (V)"
                  aria-label="Pan"
                  aria-pressed={tools.tool === "pan" && !pinging && !placing && !sketches.active}
                  onClick={() => chooseTool("pan")}
                >
                  <Hand size={19} />
                </button>
                <button
                  className="map-icon-button"
                  title="Select / move (S)"
                  aria-label="Select / move"
                  aria-pressed={tools.tool === "select" && !pinging && !placing && !sketches.active}
                  onClick={() => chooseTool("select")}
                >
                  <MousePointer2 size={19} />
                </button>
                <button
                  className="map-icon-button"
                  title="Ping (P)"
                  aria-label="Ping"
                  disabled={signals.viewOnly}
                  aria-pressed={pinging}
                  onClick={() => {
                    if (!allowContextChange()) return;
                    tools.cancel();
                    sketches.cancel();
                    stopPlacing();
                    setPinging(!pinging);
                    setContextOpen(false);
                    setDrawerOpen(false);
                    root.current?.focus();
                  }}
                >
                  <Crosshair size={19} />
                </button>
                <button
                  className="map-icon-button"
                  title="Measure (M)"
                  aria-label="Measure"
                  aria-pressed={tools.tool === "measure"}
                  onClick={() => chooseTool("measure")}
                >
                  <Ruler size={19} />
                </button>
                {tools.playerTemplates && (
                  <button
                    className="map-icon-button"
                    title="Area template (T)"
                    aria-label="Area template"
                    aria-pressed={tools.tool === "template"}
                    onClick={() => chooseTool("template")}
                  >
                    <Shapes size={19} />
                  </button>
                )}
                {useDm && (
                  <button
                    className="map-icon-button"
                    title="Place marker"
                    aria-label="Place marker"
                    aria-pressed={placementKind === "marker"}
                    onClick={() => {
                      if (!allowContextChange()) return;
                      tools.cancel();
                      sketches.cancel();
                      setPinging(false);
                      beginMarker();
                      setDrawerOpen(false);
                      setContextOpen(false);
                      root.current?.focus();
                    }}
                  >
                    <MapPin size={19} />
                  </button>
                )}
                <button
                  className="map-icon-button"
                  aria-label="Drawing & annotations"
                  title="Drawing & annotations"
                  aria-pressed={sketches.active}
                  onClick={() => {
                    if (!allowContextChange()) return;
                    chooseTool("pan");
                    sketches.setActive(true);
                    setContextOpen(true);
                  }}
                >
                  <Pencil size={19} />
                </button>
                <button
                  className="map-icon-button"
                  title="More map tools"
                  aria-label="More map tools"
                  aria-expanded={moreTools}
                  onClick={() => {
                    if (!moreTools) setContextOpen(false);
                    setMoreTools(!moreTools);
                  }}
                >
                  <MoreHorizontal size={20} />
                </button>
              </div>
            )}
            <button
              className="map-hotbar-toggle map-glass map-icon-button"
              aria-label="Map tools hotbar"
              aria-expanded={hotbarOpen}
              title="Map tools"
              onClick={() => setHotbarOpen(!hotbarOpen)}
            >
              <Pencil size={20} />
            </button>
            {hotbarOpen && moreTools && (
              <div
                className="map-hotbar-more map-glass"
                role="toolbar"
                aria-label="Additional map tools"
              >
                {useDm && (
                  <>
                    <button
                      className="map-icon-button"
                      title="Fog brush"
                      aria-label="Fog brush"
                      aria-pressed={tools.tool === "fog-brush"}
                      onClick={() => chooseTool("fog-brush")}
                    >
                      <CloudFog size={19} />
                    </button>
                    <button
                      className="map-icon-button"
                      title="Fog rectangle"
                      aria-label="Fog rectangle"
                      aria-pressed={tools.tool === "fog-rectangle"}
                      onClick={() => chooseTool("fog-rectangle")}
                    >
                      <Grid3X3 size={19} />
                    </button>
                    <button
                      className="map-icon-button"
                      title="Fog polygon"
                      aria-label="Fog polygon"
                      aria-pressed={tools.tool === "fog-polygon"}
                      onClick={() => chooseTool("fog-polygon")}
                    >
                      <Shapes size={19} />
                    </button>
                    <button
                      className="map-icon-button"
                      title="Wall / door"
                      aria-label="Wall / door"
                      aria-pressed={tools.tool === "wall"}
                      onClick={() => chooseTool("wall")}
                    >
                      <PanelRight size={19} />
                    </button>
                    <button
                      className="map-icon-button"
                      title="Light"
                      aria-label="Light"
                      aria-pressed={tools.tool === "light"}
                      onClick={() => chooseTool("light")}
                    >
                      <Sun size={19} />
                    </button>
                    <button
                      className="map-icon-button"
                      title="Place existing record"
                      aria-label="Place existing record"
                      onClick={() => {
                        if (!allowContextChange()) return;
                        tools.cancel();
                        sketches.cancel();
                        setPinging(false);
                        beginRecord();
                        setDrawerOpen(true);
                        setSettingsTab("settings");
                      }}
                    >
                      <Store size={19} />
                    </button>
                    <button
                      className="map-icon-button"
                      title="Start encounter here"
                      aria-label={
                        recordTable.journal?.world?.combat
                          ? "Open encounter map controls"
                          : "Start encounter here"
                      }
                      onClick={openCombat}
                    >
                      <Swords size={19} />
                    </button>
                    <button
                      className="map-icon-button"
                      title="Undo fog"
                      aria-label="Undo fog"
                      disabled={!tools.canUndoFog}
                      onClick={() => void tools.undoFog()}
                    >
                      <Undo2 size={19} />
                    </button>
                    <button
                      className="map-icon-button"
                      title="Redo fog"
                      aria-label="Redo fog"
                      disabled={!tools.canRedoFog}
                      onClick={() => void tools.redoFog()}
                    >
                      <Redo2 size={19} />
                    </button>
                  </>
                )}
                {map.grid && (
                  <button
                    className="map-icon-button"
                    title={gridLocked ? "Encounter controls the grid" : "Grid display"}
                    aria-label="Grid display"
                    aria-pressed={tileMode && (gridLocked || gridVisible)}
                    disabled={gridLocked}
                    onClick={() => {
                      if (!tileMode) toggleGrid();
                      setGridVisible(tileMode ? !gridVisible : true);
                    }}
                  >
                    <Grid3X3 size={19} />
                  </button>
                )}
                <button
                  className="map-icon-button"
                  title="Inspector"
                  aria-label="Inspector"
                  onClick={() => {
                    setDrawerOpen(false);
                    tools.openInspector();
                  }}
                >
                  <Menu size={19} />
                </button>
              </div>
            )}
          </div>
          {contextOpen && !drawerOpen && (
            <aside className="map-tool-context map-glass" aria-label="Tool options">
              <div className="map-panel-heading">
                <strong>{sketches.active ? "Drawing & annotations" : tools.toolLabel}</strong>
                <button
                  className="map-icon-button"
                  aria-label="Close tool options"
                  onClick={() => setContextOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
              {sketches.active ? sketches.controls : tools.contextControls}
              <button
                onClick={() => {
                  if (allowContextChange()) {
                    tools.cancel();
                    sketches.cancel();
                    setContextOpen(false);
                  }
                }}
              >
                Cancel tool
              </button>
            </aside>
          )}
          <div className="world-toolbar map-navigation map-glass" aria-label="Map navigation">
            <Button onClick={() => zoom(1.4, size.w / 2, size.h / 2)} aria-label="Zoom in">
              +
            </Button>
            <Button onClick={() => zoom(1 / 1.4, size.w / 2, size.h / 2)} aria-label="Zoom out">
              −
            </Button>
            <Button onClick={fit} aria-label="Fit map" title="Fit map">
              <Maximize size={18} />
            </Button>
            <button
              className="map-icon-button"
              aria-label="Center on party or selection"
              title="Center on party or selection"
              disabled={!party && !currentDetails[0]?.point && !selectedToken}
              onClick={() => {
                const p =
                  currentDetails[0]?.point ??
                  (map.grid && map.tokens?.find((t) => t.id === selectedToken)
                    ? sceneTokenPoint(
                        map.grid,
                        map.tokens!.find((t) => t.id === selectedToken)!,
                      )
                    : party);
                if (p)
                  setView((v) => ({
                    ...v,
                    x: size.w / 2 - p.x * w * v.scale,
                    y: size.h / 2 - p.y * h * v.scale,
                  }));
              }}
            >
              <Crosshair size={18} />
            </button>
            <output aria-label="Map zoom" aria-live="polite">
              {Math.round(view.scale * 100)}%
            </output>
          </div>
        </>
      )}
      {!interfaceHidden && <MapCombatHud map={map} />}
      <div className="map-feedback" hidden={interfaceHidden}>
        {full && (
          <p className="map-active-tool" role="status">
            {pinging
              ? `Ping · ${color}`
              : sketches.active
                ? "Personal annotations"
                : tools.toolLabel}
            {tools.measurement && ` · ${tools.measurement}`}
          </p>
        )}
        {tools.feedback}
        {pinging && (
          <p role="status">
            Tap the map to ping in {color}.{" "}
            {signals.joined
              ? "Everyone viewing this map in the room will see it for five seconds."
              : "Offline preview; join a room to share pings."}
          </p>
        )}
        {signals.viewOnly && <p className="text-sm text-muted">Resume play to share map pings.</p>}
        {signals.error && <p role="alert">{signals.error}</p>}
      </div>
      <div className={`tabletop-workspace ${tools.panel ? "has-inspector" : ""}`}>
        <div className="tabletop-surface">
          <div
            ref={root}
            className={`map-viewport ${placing || pinging ? "placing" : ""}`}
            role="region"
            aria-label="Interactive campaign map"
            tabIndex={0}
            onKeyDown={(e) => {
              if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                const shortcut = ({ v: "pan", s: "select", m: "measure", t: "template" } as const)[
                  e.key.toLowerCase() as "v"
                ];
                if (shortcut) {
                  e.preventDefault();
                  chooseTool(shortcut);
                  return;
                }
                if (e.key.toLowerCase() === "p" && !signals.viewOnly) {
                  e.preventDefault();
                  if (allowContextChange()) {
                    tools.cancel();
                    sketches.cancel();
                    stopPlacing();
                    setPinging(!pinging);
                  }
                  return;
                }
              }
              if (
                tools.keyboard(e, {
                  x: Math.max(0, Math.min(1, (size.w / 2 - view.x) / (w * view.scale))),
                  y: Math.max(0, Math.min(1, (size.h / 2 - view.y) / (h * view.scale))),
                })
              )
                return;
              if (
                ["+", "=", "-", "Home", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
                  e.key,
                )
              )
                e.preventDefault();
              if ((pinging || placing) && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                const x = (size.w / 2 - view.x) / (w * view.scale),
                  y = (size.h / 2 - view.y) / (h * view.scale);
                if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
                  if (pinging) void signals.send({ x, y }, color);
                  else onPlace({ x, y });
                }
              }
              if (e.key === "Escape") {
                setPinging(false);
                sketches.cancel();
                setContextOpen(false);
                stopPlacing();
              }
              if (e.key === "Home") fit();
              else if (e.key === "+" || e.key === "=") zoom(1.2, size.w / 2, size.h / 2);
              else if (e.key === "-") zoom(1 / 1.2, size.w / 2, size.h / 2);
              else if (e.key.startsWith("Arrow"))
                setView((v) => ({
                  ...v,
                  x: v.x + (e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0),
                  y: v.y + (e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0),
                }));
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              if (sketches.active) {
                sketches.down(mapPoint(e.clientX, e.clientY));
                e.currentTarget.setPointerCapture(e.pointerId);
                toolPointer.current = e.pointerId;
                return;
              }
              const token = (e.target as Element).closest<HTMLElement>("[data-map-token]")?.dataset
                .mapToken;
              if (
                !placing &&
                !pinging &&
                !sketches.active &&
                tools.pointerDown(mapPoint(e.clientX, e.clientY), token, e.shiftKey)
              ) {
                moved.current = false;
                e.currentTarget.setPointerCapture(e.pointerId);
                toolPointer.current = e.pointerId;
                return;
              }
              const target = (e.target as HTMLElement).closest("button") ?? e.currentTarget;
              target.setPointerCapture(e.pointerId);
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (pointers.current.size === 1) {
                start.current = { x: e.clientX, y: e.clientY };
                moved.current = false;
              } else moved.current = true;
            }}
            onPointerMove={(e) => {
              if (toolPointer.current === e.pointerId) {
                moved.current = true;
                if (sketches.active) sketches.move(mapPoint(e.clientX, e.clientY));
                else tools.pointerMove(mapPoint(e.clientX, e.clientY));
                return;
              }
              if (!pointers.current.has(e.pointerId)) return;
              const before = [...pointers.current.values()],
                previous = pointers.current.get(e.pointerId)!;
              pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 6)
                moved.current = true;
              const after = [...pointers.current.values()];
              if (after.length === 1)
                setView((v) => ({
                  ...v,
                  x: v.x + e.clientX - previous.x,
                  y: v.y + e.clientY - previous.y,
                }));
              else {
                const a = center(before),
                  b = center(after),
                  dist = (ps: { x: number; y: number }[]) =>
                    Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y),
                  factor = dist(after) / Math.max(1, dist(before)),
                  rect = root.current!.getBoundingClientRect();
                setView((v) => {
                  const scale = Math.min(8, Math.max(0.5, v.scale * factor)),
                    f = scale / v.scale;
                  return {
                    scale,
                    x: b.x - rect.left - (a.x - rect.left - v.x) * f,
                    y: b.y - rect.top - (a.y - rect.top - v.y) * f,
                  };
                });
              }
            }}
            onPointerUp={(e) => {
              if (toolPointer.current === e.pointerId) {
                if (sketches.active) sketches.up(mapPoint(e.clientX, e.clientY));
                else tools.pointerUp(mapPoint(e.clientX, e.clientY));
                toolPointer.current = undefined;
                return;
              }
              if (
                (placing || pinging) &&
                (pinging || !(e.target as Element).closest("button")) &&
                !moved.current &&
                pointers.current.has(e.pointerId) &&
                pointers.current.size === 1
              ) {
                const r = e.currentTarget.getBoundingClientRect(),
                  x = (e.clientX - r.left - view.x) / (w * view.scale),
                  y = (e.clientY - r.top - view.y) / (h * view.scale);
                if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
                  if (pinging) void signals.send({ x, y }, color);
                  else onPlace({ x, y });
                }
              }
              pointers.current.delete(e.pointerId);
            }}
            onPointerCancel={(e) => {
              pointers.current.delete(e.pointerId);
              if (toolPointer.current === e.pointerId) {
                toolPointer.current = undefined;
                tools.cancel();
              }
            }}
          >
            {!artworkReady && (
              <span className="map-loading-artwork" role="status">
                Opening map…
              </span>
            )}
            <div
              className="map-layer"
              style={{
                width: w,
                height: h,
                visibility: artworkReady && size.w > 1 ? "visible" : "hidden",
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              }}
            >
              <MapArtwork
                controlsInWorkspace
                key={map.id}
                map={map}
                onRatio={(ratio) =>
                  setArtwork((current) =>
                    current.mapId === map.id && current.ratio === ratio
                      ? current
                      : { mapId: map.id, ratio },
                  )
                }
              />
              {sketches.overlay}
              {visible.includes("Ship") && routes.length > 0 && (
                <svg
                  className="map-route-trails"
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {routes.map((route) => (
                    <polyline
                      key={route.id}
                      points={route.points.map((p) => `${p.x * 1000},${p.y * 1000}`).join(" ")}
                    />
                  ))}
                </svg>
              )}
              {tileMode && (gridLocked || gridVisible) && map.grid && (
                <svg
                  className="map-tile-grid"
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {Array.from({ length: map.grid.columns + 1 }, (_, i) => (
                    <line
                      key={`c${i}`}
                      x1={(map.grid!.x + (i * map.grid!.width) / map.grid!.columns) * 1000}
                      x2={(map.grid!.x + (i * map.grid!.width) / map.grid!.columns) * 1000}
                      y1={map.grid!.y * 1000}
                      y2={(map.grid!.y + map.grid!.height) * 1000}
                    />
                  ))}
                  {Array.from({ length: map.grid.rows + 1 }, (_, i) => (
                    <line
                      key={`r${i}`}
                      y1={(map.grid!.y + (i * map.grid!.height) / map.grid!.rows) * 1000}
                      y2={(map.grid!.y + (i * map.grid!.height) / map.grid!.rows) * 1000}
                      x1={map.grid!.x * 1000}
                      x2={(map.grid!.x + map.grid!.width) * 1000}
                    />
                  ))}
                </svg>
              )}
              {tools.overlay}
            </div>
            {groups.map((group) => (
              <div
                key={group.id}
                className="map-icon-group"
                style={{
                  left: view.x + group.point.x * w * view.scale,
                  top: view.y + group.point.y * h * view.scale,
                }}
              >
                {group.kinds.map((type) => (
                  <button
                    type="button"
                    key={type.kind}
                    data-map-token={
                      type.records.find((record) =>
                        map.tokens?.some((token) => token.id === record.id),
                      )?.id
                    }
                    className={`map-record-icon map-kind-${type.kind.toLowerCase().replaceAll(" ", "-")}`}
                    title={`${type.kind}: ${type.records.map((r) => r.label).join(", ")}`}
                    aria-label={`${type.kind}: ${type.records.length} ${type.records.length === 1 ? "record" : "records"}`}
                    aria-pressed={
                      currentDetails.length > 0
                        ? currentDetails.length === type.records.length &&
                          type.records.every((r) =>
                            currentDetails.some((d) => d.id === r.id && d.kind === r.kind),
                          )
                        : type.records.some(
                            (r) =>
                              r.id === selectedToken &&
                              (r.kind === "Combatant" || r.kind === "Ship") &&
                              map.tokens?.some((t) => t.id === r.id),
                          )
                    }
                    onClick={(event) => {
                      if (
                        !moved.current &&
                        !pinging &&
                        !sketches.active &&
                        ["pan", "select"].includes(tools.tool) &&
                        (!(service || combatOpen) || allowContextChange())
                      ) {
                        setService(undefined);
                        setCombatOpen(false);
                        const token = type.records.find(
                          (r) =>
                            r.kind === "Combatant" ||
                            (r.kind === "Ship" && map.tokens?.some((t) => t.id === r.id)),
                        );
                        if (token && onTokenSelect) {
                          setDetails([]);
                          if (event.detail === 0) tools.choose(token.id, event.shiftKey);
                        } else if (!placing) {
                          if (type.records.length === 1 && type.records[0].targetMapId)
                            selectMap(type.records[0].targetMapId, type.records[0].entry);
                          else if (
                            type.records.length === 1 &&
                            type.records[0].reference?.kind === "location" &&
                            openLocation(type.records[0].reference.id)
                          )
                            setDetails([]);
                          else setDetails(type.records);
                        }
                      }
                    }}
                  >
                    <MapRecordGlyph
                      kind={type.kind}
                      records={type.records}
                      map={map}
                      selected={type.records.some((record) => tools.selected.includes(record.id))}
                    />
                    {type.records.length > 1 && (
                      <span className="map-count">{type.records.length}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
            {point && (
              <span
                className="map-place-point"
                style={{
                  left: view.x + point.x * w * view.scale,
                  top: view.y + point.y * h * view.scale,
                }}
                aria-label="Selected placement"
              >
                ✚
              </span>
            )}
            {signals.pings.map((p) => (
              <span
                key={p.id}
                className={`map-ping map-ping-${p.color}`}
                style={{ left: view.x + p.x * w * view.scale, top: view.y + p.y * h * view.scale }}
                role="img"
                aria-label={`${p.color} map ping`}
              />
            ))}
            {pinging && (
              <span className="map-ping-crosshair" aria-hidden="true">
                +
              </span>
            )}
          </div>
          {combatOpen && useDm && (
            <section
              className="map-record-details map-service-open map-combat-panel"
              aria-label="Encounter map panel"
            >
              <div className="world-row">
                <strong>Encounter</strong>
                <Button
                  onClick={() => {
                    if (allowContextChange()) {
                      setCombatOpen(false);
                      root.current?.focus();
                    }
                  }}
                >
                  Close encounter panel
                </Button>
              </div>
              <Suspense fallback={<p>Opening encounter controls…</p>}>
                <MapCombatWorkspace map={map} camera={currentCamera} openMap={selectMap} />
              </Suspense>
            </section>
          )}
          {currentDetails.length > 0 && (
            <section
              className={`map-record-details ${service ? "map-service-open" : ""} ${serviceExpanded ? "map-service-expanded" : ""}`}
              aria-label="Map record details"
            >
              <div className="world-row">
                <strong>
                  {currentDetails[0].kind} · {currentDetails.length}{" "}
                  {currentDetails.length === 1 ? "record" : "records"}
                </strong>
                {service && (
                  <Button onClick={() => setServiceExpanded((v) => !v)}>
                    {serviceExpanded ? "Collapse service" : "Expand service"}
                  </Button>
                )}
                <Button
                  onClick={() => {
                    if (allowContextChange()) {
                      setDetails([]);
                      setService(undefined);
                      root.current?.focus();
                    }
                  }}
                >
                  Close details
                </Button>
              </div>
              {currentDetails.map((r) => (
                <div key={r.id}>
                  {r.href ? (
                    <AppLink className="settings-link" href={r.href}>
                      {r.label} →
                    </AppLink>
                  ) : (
                    <strong>{r.label}</strong>
                  )}
                  {r.reference && (
                    <Button
                      onClick={() => {
                        if (allowContextChange()) {
                          setService(r.reference);
                          setDrawerOpen(false);
                          tools.hideInspector();
                        }
                      }}
                    >
                      Open in map
                    </Button>
                  )}
                  {r.targetMapId && (
                    <Button onClick={() => selectMap(r.targetMapId!, r.entry)}>Open map</Button>
                  )}
                  {r.reference?.kind === "location" &&
                    locationMaps(r.reference.id)
                      .filter((m) => m.id !== map.id)
                      .map((m) => (
                        <Button key={m.id} onClick={() => selectMap(m.id)}>
                          Open {m.name}
                        </Button>
                      ))}
                  {r.description && <p>{r.description}</p>}
                </div>
              ))}
              {service && (
                <Suspense fallback={<p role="status">Opening service…</p>}>
                  <MapServicePanel
                    key={`${service.kind}:${service.id}`}
                    reference={service}
                    table={serviceTable}
                    close={closeService}
                  />
                </Suspense>
              )}
            </section>
          )}
        </div>
        <div hidden={interfaceHidden}>{tools.panel}</div>
      </div>
    </MapFrame>
  );
}
function MapRecordGlyph({
  kind,
  records,
  map,
  selected,
}: {
  kind: string;
  records: MapRecord[];
  map: CampaignMap;
  selected: boolean;
}) {
  const table = useWorldTable(),
    token = map.tokens?.find((token) => records.some((record) => record.id === token.id)),
    portrait =
      token?.kind === "character"
        ? table.purses.find((person) => person.id === token.entityId)?.portrait
        : undefined;
  return (
    <>
      {portrait ? (
        <img className="tabletop-token-portrait" src={portrait} alt="" draggable={false} />
      ) : (
        <RecordIcon kind={kind} />
      )}
      {token?.style &&
        (token.style.labels === "always" || (token.style.labels === "selected" && selected)) && (
          <span className="tabletop-token-label">{token.label}</span>
        )}
    </>
  );
}
function RecordIcon({ kind }: { kind: string }) {
  const Icon =
    kind === "Ship"
      ? ShipIcon
      : kind === "Combatant"
        ? Swords
        : kind === "NPC" || kind === "Character"
          ? UserRound
          : kind === "Party"
            ? Users
            : kind === "Shop"
              ? Store
              : kind === "Black market"
                ? EyeOff
                : kind === "Property"
                  ? House
                  : kind === "Post office"
                    ? Mail
                    : kind === "Marker"
                      ? Flag
                      : MapPin;
  return <Icon size={18} aria-hidden="true" />;
}
