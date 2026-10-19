import { PlayerDisplayButton } from "./player-display-controller";
import { GridEditor, PartyPlacement, CombatControls } from "./map-tile-controls";
import { mapType, partyEnvironment, tilePoint, routePosition } from "@/lib/quire/map-tiles";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { characterLocation, characterVisible } from "@/lib/quire/character-position";
import { SearchSelect } from "@/components/search-select";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSeat } from "@/lib/quire/seat";
import { readWorld, mapTypes, type CampaignMap } from "@/lib/quire/world-schema";
import { anchorFor, recognizedAnchors, npcAvailableHere, shopVisible } from "@/lib/quire/world";
import { readMarketLocations, locationLabel, locationPath } from "@/lib/quire/shop-locations";
import { recognizeMap } from "@/lib/quire/map-image";
import { prepareMapMedia } from "@/lib/quire/map-media";
import { cacheMapAsset, publishMapAsset, loadMapAsset, mapAssetBlob } from "@/lib/quire/map-assets";
import { mapMediaReference, type MapAssetBundle } from "@/lib/quire/map-assets-schema";
import { readMapTabletop } from "@/lib/quire/tabletop";
import { MapArtwork } from "./map-artwork";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { CommandForm, CommandButton } from "./world-tools";
import { LocationOptions, MarketLocationsPanel } from "./market-locations";
import { Button, Fold } from "./ui";
import { AppLink } from "./app-link";
import { libraryRecordHref } from "@/lib/quire/library-records";
import { useRouterState } from "@tanstack/react-router";
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

export function CampaignMaps() {
  const t = useWorldTable(),
    w = readWorld(t.journal.world),
    seat = useSeat(),
    dm = seat.role === "dm",
    market = readMarketLocations(t.journal.market);
  const [selected, setSelected] = useState(""),
    [editing, setEditing] = useState<CampaignMap | null | undefined>(),
    [placement, setPlacement] = useState<"" | "anchor" | "marker" | "party" | "token">(""),
    [location, setLocation] = useState(""),
    [point, setPoint] = useState<{ x: number; y: number }>(),
    [label, setLabel] = useState(""),
    [description, setDescription] = useState(""),
    [secret, setSecret] = useState(false),
    [typeFilter, setTypeFilter] = useState(""),
    [tileMode, setTileMode] = useState(false),
    [selectedToken, setSelectedToken] = useState("");
  const requestedMap = useRouterState({ select: (s) => s.location.search.map });
  const maps = w.maps.filter(
      (m) => (dm || m.visible) && (!typeFilter || mapType(m, t) === typeFilter),
    ),
    best = [...locationPath(market, market.currentLocationId)]
      .reverse()
      .map((l) => maps.find((m) => m.locationId === l.id))
      .find(Boolean);
  const map =
    maps.find((m) => m.id === (selected || requestedMap)) ??
    maps.find((m) => m.id === w.partyPosition?.mapId) ??
    best ??
    maps.find((m) => !m.locationId) ??
    maps[0];
  const party =
    map &&
    (w.partyPosition?.mapId === map.id &&
    w.partyPosition.x !== undefined &&
    w.partyPosition.y !== undefined
      ? { x: w.partyPosition.x, y: w.partyPosition.y }
      : anchorFor(map, t, market.currentLocationId));
  const pins = map
    ? [
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
      ].filter((p) => p.point)
    : [];
  return (
    <div className="campaign-maps">
      <p className="text-muted">
        {partyEnvironment(w.partyPosition) || locationLabel(market, market.currentLocationId)} ·{" "}
        {party
          ? "Party position shown"
          : "Choose a map position or link a location to show the party"}
      </p>
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
        <label>
          Map
          <SearchSelect
            aria-label="Map"
            value={map?.id ?? ""}
            onValueChange={(selectedValue) => {
              setSelected(selectedValue);
              setSelectedToken("");
              setPlacement("");
              setPoint(undefined);
            }}
          >
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.visible ? "" : " (DM only)"}
              </option>
            ))}
          </SearchSelect>
        </label>
        {dm && (
          <>
            <Button onClick={() => setEditing(null)}>Import map</Button>
            <PlayerDisplayButton
              mapId={map?.visible ? map.id : undefined}
              encounterId={map?.encounterId}
            />
            {map && <Button onClick={() => setEditing(map)}>Edit map & anchors</Button>}
          </>
        )}
      </div>
      {map ? (
        <>
          <MapViewport
            key={`viewport-${map.id}`}
            map={map}
            party={party}
            selectedToken={selectedToken}
            tileMode={tileMode && !!map.grid}
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
            onTokenSelect={
              dm
                ? (id) => {
                    setSelectedToken(id);
                    setPlacement("token");
                    setPoint(undefined);
                  }
                : undefined
            }
            controls={
              <>
                {map.grid && (
                  <Button
                    aria-pressed={tileMode}
                    onClick={() => {
                      setTileMode(!tileMode);
                      setPlacement("");
                      setPoint(undefined);
                    }}
                  >
                    {tileMode ? "Leave tile mode" : "Enter tile mode"}
                  </Button>
                )}
                {tileMode &&
                  map.grid &&
                  (dm ? (
                    <Fold title="Combat tiles" defaultOpen>
                      <CombatControls
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
                      Combat grid · {map.grid.feetPerTile} ft per tile. The DM moves tokens; only
                      shared combatants are shown.
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
              ...map.anchors.map((a) => ({
                id: a.locationId,
                label: locationLabel(market, a.locationId),
                kind: "Location",
                point: a,
                href: libraryRecordHref("location", a.locationId),
              })),
            ]}
          />
          <p className="text-sm text-muted">
            Drag to pan. Pinch or use the scroll wheel to zoom. Keyboard: arrows, +, − and Home.
            Markers update through the shared campaign.
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
            <Fold title="Place map markers & locations" defaultOpen>
              <div className="world-toolbar">
                <Button
                  onClick={() => {
                    setPlacement("marker");
                    setPoint(undefined);
                  }}
                >
                  Place marker
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
            {pins.map((p) => (
              <AppLink key={`${p.kind}-${p.id}`} className="settings-link" href={p.href}>
                {p.kind} · {p.label} →
              </AppLink>
            ))}
            {!party && (
              <p>
                No party position on this map. Link a location anchor or place the party freely.
              </p>
            )}
          </section>
        </>
      ) : (
        <p>
          No maps match this view. The DM can import regional, city, dungeon, property, wilderness,
          battle and ship maps.
        </p>
      )}
      {dm && (
        <Fold title="Manage campaign locations">
          <MarketLocationsPanel />
        </Fold>
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
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const market = readMarketLocations(table.journal?.market);
  return (
    <MapFrame editor>
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
              accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                setBusy(true);
                setError("");
                setProgress("Preparing map image… You can fill in the map details while you wait.");
                try {
                  const bundle = await prepareMapMedia(file);
                  await cacheMapAsset(bundle);
                  setMediaBundle(bundle);
                  setDraft((current) => ({
                    ...current,
                    image: bundle.manifest.preview,
                    anchors: [],
                    tabletop: {
                      ...readMapTabletop(current),
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
    [details, setDetails] = useState<MapRecord[]>([]),
    [pinging, setPinging] = useState(false),
    [color, setColor] = useState<MapPingInput["color"]>("blue");
  const signals = useMapPings(map.id),
    useDm = useSeat().role === "dm";
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
            point: tilePoint(map.grid!, token),
            description: `Column ${token.column + 1}, row ${token.row + 1}${token.visibility === "dm" ? " · DM only" : ""}`,
          }))
      : []),
    ...(party ? [{ id: "party", label: "Party", kind: "Party", point: party }] : []),
  ];
  const groups = groupMapRecords(records, visible);
  const currentDetails = details.flatMap((d) =>
    records.filter((r) => r.id === d.id && r.kind === d.kind),
  );
  useEffect(() => {
    setDetails([]);
  }, [selectedToken]);
  useEffect(() => {
    if (placing || signals.viewOnly) setPinging(false);
    if (placing) setDetails([]);
  }, [placing, signals.viewOnly]);
  const root = useRef<HTMLDivElement>(null),
    [ratio, setRatio] = useState(1),
    [size, setSize] = useState({ w: 1, h: 1 }),
    [view, setView] = useState({ x: 0, y: 0, scale: 1 }),
    viewRef = useRef(view),
    pointers = useRef(new Map<number, { x: number; y: number }>()),
    moved = useRef(false),
    start = useRef({ x: 0, y: 0 });
  const w = Math.min(size.w, size.h * ratio),
    h = w / ratio;
  const fit = () => setView({ x: (size.w - w) / 2, y: (size.h - h) / 2, scale: 1 });
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    const el = root.current!;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setView({ x: (size.w - w) / 2, y: (size.h - h) / 2, scale: 1 });
  }, [size.w, size.h, w, h]);
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
  return (
    <MapFrame>
      <div className="world-toolbar map-controls">
        <Button aria-expanded={filtersOpen} onClick={() => setFiltersOpen((v) => !v)}>
          Filters
        </Button>
        <Button
          disabled={signals.viewOnly}
          aria-pressed={pinging}
          onClick={() => {
            stopPlacing();
            setPinging((v) => !v);
          }}
        >
          Ping
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
        <Button onClick={() => zoom(1.4, size.w / 2, size.h / 2)} aria-label="Zoom in">
          +
        </Button>
        <Button onClick={() => zoom(1 / 1.4, size.w / 2, size.h / 2)} aria-label="Zoom out">
          −
        </Button>
        <Button onClick={fit}>Fit map</Button>
        <span aria-live="polite">{Math.round(view.scale * 100)}%</span>
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
                  setVisible((v) => (e.target.checked ? [...v, kind] : v.filter((k) => k !== kind)))
                }
              />
              {kind === "NPC" ? "Characters / NPCs" : kind}
            </label>
          ))}
          <Button onClick={() => setVisible([...mapRecordKinds])}>Show all</Button>
          <Button onClick={() => setVisible([])}>Hide all</Button>
        </fieldset>
      )}
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
      <div
        ref={root}
        className={`map-viewport ${placing || pinging ? "placing" : ""}`}
        role="region"
        aria-label="Interactive campaign map"
        tabIndex={0}
        onKeyDown={(e) => {
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
          const target = (e.target as HTMLElement).closest("button") ?? e.currentTarget;
          target.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 1) {
            start.current = { x: e.clientX, y: e.clientY };
            moved.current = false;
          } else moved.current = true;
        }}
        onPointerMove={(e) => {
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
          if (
            (placing || pinging) &&
            !(e.target as Element).closest("button") &&
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
        onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
      >
        <div
          className="map-layer"
          style={{
            width: w,
            height: h,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <MapArtwork map={map} onRatio={setRatio} />
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
          {tileMode && map.grid && (
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
                onClick={() => {
                  if (!moved.current && !pinging) {
                    const token = type.records.find(
                      (r) =>
                        r.kind === "Combatant" ||
                        (r.kind === "Ship" && map.tokens?.some((t) => t.id === r.id)),
                    );
                    if (token && onTokenSelect) {
                      setDetails([]);
                      onTokenSelect(token.id);
                    } else if (!placing) {
                      setDetails(type.records);
                    }
                  }
                }}
              >
                <RecordIcon kind={type.kind} />
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
      {currentDetails.length > 0 && (
        <section className="map-record-details" aria-label="Map record details">
          <div className="world-row">
            <strong>
              {currentDetails[0].kind} · {currentDetails.length}{" "}
              {currentDetails.length === 1 ? "record" : "records"}
            </strong>
            <Button onClick={() => setDetails([])}>Close details</Button>
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
              {r.description && <p>{r.description}</p>}
            </div>
          ))}
        </section>
      )}
      {pinging && (
        <p className="text-sm text-muted">
          Keyboard: pan to a point, then press Enter to ping the center crosshair. Escape turns ping
          mode off.
        </p>
      )}
      <div className="map-tile-control-area">{controls}</div>
    </MapFrame>
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
