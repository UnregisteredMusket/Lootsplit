import { SyncStatus } from "./sync-status";
import {
  groupInfo,
  groupPlace,
  groupRefs,
  MAIN_GROUP,
  partySplit,
  seatGroups,
} from "@/lib/quire/party-groups";
import { mapGroupPins, type GroupPin } from "@/lib/quire/party-groups-map";
import { HereGroupSwitch } from "./party-groups-map";
import { useMapSketches } from "./map-sketch-tools";
import { MapWorkspaceChrome, MapEmptyWorkspace } from "./map-workspace-chrome";
import {
  captureMutationScope,
  getCloudTable,
  getServerCloudTable,
  subscribeCloudTable,
} from "@/lib/quire/cloud-client";
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
import { MapInitiativePanel } from "./map-initiative-panel";
import { MapConnectedTools, type EntranceDraft } from "./map-connected-tools";
import {
  defaultLocationMap,
  mapsForLocation,
  mapAncestry,
  mapReferenceName,
} from "@/lib/quire/connected-maps";
import type { MapRecordReference } from "@/lib/quire/connected-maps-schema";
import { afterContextChange, allowContextChange } from "@/lib/quire/use-draft-guard";
import { loadHandouts, type Handout } from "@/lib/quire/handouts";
import { subscribeWorkspaceChanges } from "@/lib/quire/workspace-events";
import { activeCampaignId } from "@/lib/quire/campaign-context";
import { GridEditor, PartyPlacement, CombatControls } from "./map-tile-controls";
import { mapType, partyEnvironment, tilePoint, routePosition } from "@/lib/quire/map-tiles";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { characterLocation, characterVisible } from "@/lib/quire/character-position";
import { SearchSelect } from "@/components/search-select";
import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useSeat } from "@/lib/quire/seat";
import { readWorld, mapTypes, type CampaignMap, type MapToken } from "@/lib/quire/world-schema";
import { anchorFor, recognizedAnchors, npcAvailableHere, shopVisible } from "@/lib/quire/world";
import { readMarketLocations, locationLabel, locationPath } from "@/lib/quire/shop-locations";
import { recognizeMap } from "@/lib/quire/map-image";
import { prepareMapMedia } from "@/lib/quire/map-media";
import { readMapInterchange, MAP_INTERCHANGE_LIMIT } from "@/lib/quire/map-import";
import { cacheMapAsset, publishMapAsset, loadMapAsset, mapAssetBlob } from "@/lib/quire/map-assets";
import { mapMediaReference, type MapAssetBundle } from "@/lib/quire/map-assets-schema";
import { combatOnMap, readMapTabletop, readTabletopSession } from "@/lib/quire/tabletop";
import { MapArtwork } from "./map-artwork";
import { MapBrowser, MapSessionBar } from "./map-session-bar";
import { useMapTabletopTools } from "./map-tabletop-tools";
import { MapTokenLayer } from "./map-token-layer";
import { MovementNotice } from "./map-tabletop-inspector";
import { GroupBar, PlacePartyPanel, PlacingHint, type PartyRow } from "./map-group-tools";
import { groupMembers } from "@/lib/quire/party-groups";
import { resizedToken } from "@/lib/quire/token-display";
import { planFormation, DEFAULT_FORMATION } from "@/lib/quire/formation";
import { addToInitiative } from "@/lib/quire/map-initiative-link";
import { MapTurnStrip, MovementChips } from "./map-player-movement";
import { useMapTurnOrder } from "@/lib/quire/use-map-turn-order";
import { playerMovement, sheetSpeedFeet } from "@/lib/quire/map-movement";
import { imageSize } from "@/lib/quire/image-size";
import { discToken } from "@/lib/quire/token-display";
import { MapPlayerPreview } from "./map-player-preview";
import {
  automaticGrid,
  sceneTokenPoint,
  SIZE_NAMES,
  snapTokenPosition,
  TOKEN_SIZE_CLASSES,
} from "@/lib/quire/tabletop-geometry";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { CommandForm, CommandButton } from "./world-tools";
import { LocationOptions, MarketLocationsPanel } from "./market-locations";
import { Button, Fold } from "./ui";
import { AppLink } from "./app-link";
import { libraryRecordHref } from "@/lib/quire/library-records";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import {
  Store,
  MapPin,
  Swords,
  Hand,
  MousePointer2,
  Ruler,
  Shapes,
  Pencil,
  Grid3X3,
  Crosshair,
  Maximize,
  House,
  Layers,
  ScrollText,
  CircleDot,
  Paintbrush,
  SquareDashed,
  Pentagon,
  BrickWall,
  Lightbulb,
  List,
  DoorOpen,
  MapPinned,
  Users,
  ChevronsDown,
  ChevronRight,
  Plus,
  Minus,
  X,
  ChevronDown,
  Menu,
  Route as RouteIcon,
  Map as MapIcon,
  MousePointerClick,
  Ellipsis,
  ChevronLeft,
} from "lucide-react";
import { MapRadial, RadialProgress, type RadialItem } from "./map-radial";
import { longPress, RADIAL_SLOP_PX, radialGeometry, radialHit } from "@/lib/quire/radial-geometry";
import { toast } from "sonner";
import { MapContextMenu } from "./map-context-menu";
import { MAP_ACTION_ICONS, menuFromActions } from "./map-action-items";
import { mapActions, radialSlices, shortMapName } from "@/lib/quire/map-actions";
import {
  partyDestinations,
  partyEntry,
  partyMoveCommands,
  partyMoveSummary,
  type PartyDestination,
  type PartyMoveOptions,
} from "@/lib/quire/party-move";
import { AddCharactersPanel, AddCreaturesPanel } from "./map-quick-flows";
import { FollowViewSettings } from "./map-follow-view";
import { useTokenFollow } from "@/lib/quire/use-token-follow";
import { MapZoneRequests } from "./map-zone-requests";
import { MoveRequestChips } from "./map-move-requests";
import { SplitRuleSetting, ZonesEditor } from "./map-zones-editor";
import { zoneName, zoneOf } from "@/lib/quire/zones";
import { mapEncounterId, removeFromInitiative } from "@/lib/quire/map-initiative-link";
import { encounterDetailPoller } from "@/lib/encounters/detail-poller";
import { requestConfirm } from "@/lib/quire/confirm-store";
import { resultToast } from "@/lib/quire/result-toast";
import { mutationNotice } from "@/lib/quire/mutation-outcome";
import { useRoutePlanner } from "./map-route-planner";
import {
  JourneyPlanActions,
  JourneyReview,
  JourneyTravelSection,
  useMapJourney,
} from "./map-journeys";
import { frameRoute, freeArea } from "@/lib/quire/journey-ui";
import { MapFrame } from "./map-frame";
import { RecordIcon } from "./map-record-icon";
import { MapPlaceCard } from "./map-place-card";
import { MapPlaceBar } from "./map-place-bar";
import { MapHereSheet } from "./map-here-sheet";
import { useQuestMapSlot } from "./quests-map";
import { questsOnMap } from "@/lib/quire/quest-view";
import { nextObjective, questsHere } from "@/lib/quire/quest-view";
import {
  groupMapRecords,
  mapRecordKinds,
  pingColors,
  type MapRecord,
  type MapPingInput,
} from "@/lib/quire/map-signals";
import { useMapPings } from "@/lib/quire/use-map-pings";
import { MapRenderBadge } from "./map-render-badge";
import { MapAnnouncer } from "./map-announcer";
import { PingGlyph } from "./ping-glyph";
import { pingShapes } from "@/lib/quire/map-announcements";
import type { CloudTable } from "@/lib/quire/cloud";
import {
  hereSheet,
  parseRecordParam,
  placementMap,
  placementPortrait,
  recordMapSpots,
  recordParam,
  sameRecord,
  PLACE_UNAVAILABLE,
} from "@/lib/quire/place-hub";
import { mapReferenceRecord } from "@/lib/quire/connected-maps";
import { accessibleParent, openingView } from "@/lib/quire/map-navigation";
import { isRailLayout, toolNamesVisible } from "@/lib/quire/map-toolbar";
import {
  MapTool,
  MapToolGroup,
  MapToolbar,
  ToolNamesHint,
  setToolNames,
  useMapLayout,
  useToolNames,
} from "./map-tools-rail";

const MapCombatWorkspace = lazy(() =>
  import("./map-combat-workspace").then((m) => ({ default: m.MapCombatWorkspace })),
);

type SetupTool = "party" | "marker" | "entrance" | "record" | "anchor" | "token" | "grid";
/** The setup rail's Place group (DM). `label` stays the accessible name audits and help use. */
const SETUP_TOOLS = [
  { tool: "party", label: "Party position", name: "Party position", shortcut: "P", Icon: Users },
  { tool: "marker", label: "Place marker", name: "Marker", shortcut: "M", Icon: MapPin },
  { tool: "entrance", label: "Entrance", name: "Entrance", shortcut: "E", Icon: DoorOpen },
  { tool: "record", label: "Place record", name: "Place record", shortcut: "R", Icon: Store },
  { tool: "anchor", label: "Location link", name: "Location link", shortcut: "L", Icon: MapPinned },
  { tool: "token", label: "Combat token", name: "Combat token", shortcut: "T", Icon: CircleDot },
  { tool: "grid", label: "Grid & scale", name: "Grid & scale", shortcut: "G", Icon: Grid3X3 },
] as const satisfies readonly {
  tool: SetupTool;
  label: string;
  name: string;
  shortcut: string;
  Icon: unknown;
}[];
const setupName = (tool: SetupTool) => SETUP_TOOLS.find((t) => t.tool === tool)!.name;
const SETUP_PLACEMENT = {
  party: "party",
  marker: "marker",
  entrance: "record",
  record: "record",
  anchor: "anchor",
  token: "token",
  grid: "",
} as const;
/** Setup tools whose panel opens when armed (no map click needed first). */
const PANEL_FIRST: readonly SetupTool[] = ["token", "grid"];
/** Reveal group: tabletop tools armed from the setup rail (their options open beside it). */
const REVEAL_TOOLS = [
  { tool: "fog-brush", label: "Fog brush", shortcut: "F", Icon: Paintbrush },
  { tool: "fog-rectangle", label: "Fog rectangle", shortcut: undefined, Icon: SquareDashed },
  { tool: "fog-polygon", label: "Fog polygon", shortcut: undefined, Icon: Pentagon },
  { tool: "wall", label: "Walls & doors", shortcut: "W", Icon: BrickWall },
  { tool: "light", label: "Lights", shortcut: "I", Icon: Lightbulb },
] as const;

/** One group of All map settings (map controls PR 5). */
function SettingsGroup({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      className="map-settings-group"
      data-settings-group={id}
      id={`map-settings-${id}`}
      aria-labelledby={`map-settings-${id}-title`}
    >
      <h2 id={`map-settings-${id}-title`}>{title}</h2>
      {children}
    </section>
  );
}
/** Settings › Shortcuts & help: [keys, action, DM only]. */
const MAP_SHORTCUTS: [string, string, boolean][] = [
  ["V / S", "Pan, Select / move", false],
  ["P", "Ping (its options hold the colour)", false],
  ["M / T", "Measure, Area template", false],
  ["D", "Draw & notes", false],
  ["J", "Plan journey", false],
  ["E", "Here", false],
  ["L", "Layers", false],
  ["I", "Initiative", true],
  ["⇧P ⇧M ⇧E ⇧R ⇧L", "Party position, Marker, Entrance, Place record, Location link", true],
  ["⇧F ⇧W ⇧I", "Fog brush, Walls & doors, Lights", true],
  ["⇧T ⇧G ⇧O", "Combat token, Grid & scale, Objects & inspector", true],
  ["Ctrl/⌘+Z, Ctrl/⌘+⇧Z", "Undo or redo fog while a fog tool is armed", true],
  ["Backspace", "Back to the parent map (Alt+↑ from the controls)", false],
  ["/", "Search maps, places and people", false],
  ["H", "Hide or show the interface", false],
  ["+ / − / Home", "Zoom in, zoom out, fit the map", false],
  ["Esc", "Close a panel, then return to Pan", false],
  ["Shift+F10 / Menu key", "Map actions here (also right-click)", false],
];

/**
 * The quest log's map stage plugs in here (map controls PR 7, docs/MAP-TILES.md "Quests slot").
 * Until a caller passes it, no Quests tool, panel, shortcut or Layers switch is rendered.
 * Everything in it must already be projected for the seat (`projectQuests`): hidden objectives,
 * their pins and areas never reach players. The panel's only route change is "Open the quest log".
 */
export type MapQuestsSlot = {
  /** Active quests with something on this map (the tool's badge); 0 shows no badge. */
  count: number;
  /** The Quests panel body: quests with places on this map, each with "Show on map". */
  panel: ReactNode;
  /** Layers › Quest markers / Quest areas switches (presentation only, per viewer). */
  layers?: {
    markers: boolean;
    areas: boolean;
    setMarkers: (on: boolean) => void;
    setAreas: (on: boolean) => void;
  };
  /** The quest stage's own layer: quest pins (accent diamonds) beside their map pins or places. */
  pins?: { key: string; questId: string; x: number; y: number; label: string; title: string; highlighted?: boolean }[];
  /** Radius markers (dashed accent circles): centre normalized, `r` a fraction of the image width. */
  areas?: {
    key: string;
    questId: string;
    x: number;
    y: number;
    r: number;
    label?: string;
    title: string;
    highlighted?: boolean;
    /** DM: drag the centre or the edge handle (shown while the quest is picked). */
    editable?: boolean;
  }[];
  /** A quest pin or area was tapped: the panel opens on that quest. */
  select?: (questId: string) => void;
  /** Frame these points once per nonce (picking a quest zooms to its pins and areas). */
  focus?: { nonce: string; points: { x: number; y: number }[] };
  /** DM: an editable area was moved or resized; called once when the drag ends. */
  moveArea?: (key: string, next: { x: number; y: number; r: number }) => void;
  /** A new value opens the Quests panel (a `/maps?quest=` link). */
  openNonce?: string;
};

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
  const [handouts, setHandouts] = useState<Handout[]>([]),
    [handoutError, setHandoutError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const campaign = activeCampaignId();
    const load = () =>
      void loadHandouts()
        .then((rows) => {
          if (!cancelled && activeCampaignId() === campaign) {
            setHandouts(rows);
            setHandoutError("");
          }
        })
        .catch(() => {
          // Handouts are read from this device; keep the last list on a transient failure.
          if (!cancelled && activeCampaignId() === campaign)
            setHandoutError("Handouts could not be refreshed. Showing the last loaded handouts.");
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
    [placement, setPlacement] = useState<
      "" | "anchor" | "marker" | "party" | "token" | "record" | "place"
    >(""),
    [location, setLocation] = useState(""),
    [point, setPoint] = useState<{ x: number; y: number }>(),
    [label, setLabel] = useState(""),
    [description, setDescription] = useState(""),
    [secret, setSecret] = useState(false),
    [typeFilter, setTypeFilter] = useState(""),
    [tileMode, setTileMode] = useState(true),
    [selectedToken, setSelectedToken] = useState("");
  // Map controls: the DM's setup rail. A tool arms placement; the first click opens its panel.
  const [setupTool, setSetupTool] = useState<SetupTool | "">(""),
    [entranceDraft, setEntranceDraft] = useState<EntranceDraft>(),
    [entryPick, setEntryPick] = useState<EntranceDraft>();
  // Re-arms a setup tool on a map we are switching to (after the map-change reset below).
  const pendingSetup = useRef<{ mapId: string; tool: SetupTool; point?: { x: number; y: number } }>(
    undefined,
  );
  const requestedMap = useRouterState({ select: (s) => s.location.search.map }),
    requestedRecord = useRouterState({ select: (s) => s.location.search.record }),
    requestedQuest = useRouterState({ select: (s) => s.location.search.quest }),
    requestedPlace = useRouterState({ select: (s) => s.location.search.place }),
    requestedPlan = useRouterState({ select: (s) => s.location.search.plan });
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
      afterContextChange(() => {
        setSelected(id);
        setTypeFilter("");
      });
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
    setPoint(undefined);
    // A DM's "Place on map" link chose this map: keep its placement mode.
    if (placeRequest?.mapId !== viewedMapId) setPlacement("");
    setSetupTool("");
    const pending = pendingSetup.current;
    if (pending?.mapId === viewedMapId) {
      pendingSetup.current = undefined;
      setSetupTool(pending.tool);
      setPlacement(SETUP_PLACEMENT[pending.tool]);
      setPoint(pending.point);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedMapId, viewScope.key, viewScope.ephemeral]);
  // Place hub deep link: /maps?map=&record=kind:id centres on the pin and opens its card. Any
  // record this viewer can't be shown gets the same neutral message (docs/MAP-TILES.md).
  const [deepLink, setDeepLink] = useState<{
      mapId: string;
      reference: MapRecordReference;
      nonce: string;
    }>(),
    [placeNotice, setPlaceNotice] = useState(""),
    handledLink = useRef("");
  useEffect(() => {
    if (requestedRecord === undefined) {
      handledLink.current = "";
      return;
    }
    const key = `${requestedMap ?? ""}|${requestedRecord}`;
    if (handledLink.current === key) return;
    handledLink.current = key;
    const reference = parseRecordParam(requestedRecord);
    const spots = reference ? recordMapSpots(t, reference, seat, allMaps) : [];
    const spot = spots.find((s) => s.map.id === requestedMap) ?? spots[0];
    if (!reference || !spot) {
      setDeepLink(undefined);
      setPlaceNotice(PLACE_UNAVAILABLE);
      return;
    }
    const nonce = crypto.randomUUID();
    setPlaceNotice("");
    setTypeFilter("");
    setSelected(spot.map.id);
    setEntryCamera({ mapId: spot.map.id, view: { ...spot.point, zoom: 1.5 }, nonce });
    setDeepLink({ mapId: spot.map.id, reference, nonce });
    // The link is handled once per URL; later room updates never move the viewer's camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedMap, requestedRecord]);
  // DM "Place on map": /maps?map=&place=kind:id opens placement mode with the record chosen.
  // Players opening such a link simply get the map.
  const [placeRequest, setPlaceRequest] = useState<{
      mapId: string;
      reference: MapRecordReference;
    }>(),
    handledPlace = useRef("");
  useEffect(() => {
    if (requestedPlace === undefined) {
      handledPlace.current = "";
      return;
    }
    const key = `${requestedMap ?? ""}|${requestedPlace}`;
    if (!dm || handledPlace.current === key) return;
    handledPlace.current = key;
    const reference = parseRecordParam(requestedPlace);
    if (!reference || !mapReferenceRecord(t, reference)) {
      setPlaceNotice(PLACE_UNAVAILABLE);
      return;
    }
    const target =
      allMaps.find((m) => m.id === requestedMap) ?? placementMap(t, reference, allMaps);
    if (!target) {
      setPlaceNotice("Import a map before placing records on it.");
      return;
    }
    setPlaceNotice("");
    setTypeFilter("");
    setPlaceRequest({ mapId: target.id, reference });
    setSelected(target.id);
    setPlacement("place");
    setPoint(undefined);
    // Handled once per URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedMap, requestedPlace, dm]);
  // Leave placement first; navigate once the bar (and its draft guard) has unmounted.
  const [afterPlacing, setAfterPlacing] = useState<{ map: string; record?: string }>();
  const endPlacing = (show?: MapRecordReference) => {
    const mapId = placeRequest?.mapId ?? map?.id;
    setPlaceRequest(undefined);
    setPlacement("");
    setPoint(undefined);
    if (mapId) setAfterPlacing(show ? { map: mapId, record: recordParam(show) } : { map: mapId });
  };
  useEffect(() => {
    if (!afterPlacing || placement === "place") return;
    setAfterPlacing(undefined);
    void navigate({ to: "/maps", search: afterPlacing });
  }, [afterPlacing, placement, navigate]);
  const party =
    map &&
    (w.partyPosition?.mapId === map.id &&
    w.partyPosition.x !== undefined &&
    w.partyPosition.y !== undefined
      ? { x: w.partyPosition.x, y: w.partyPosition.y }
      : anchorFor(map, t, market.currentLocationId));
  // Split the party: one marker per group, each with its letter and colour (map.html).
  const groupPins = map && partySplit(t) ? mapGroupPins(t, map) : undefined;
  // Quest log on the map (quests-map.tsx): pins, radius areas and the Quests panel.
  const questSlot = useQuestMapSlot(map, t as CloudTable, requestedQuest);
  // `/maps?quest=<id>` (Show on map): open the first map where that quest has a pin or area.
  const handledQuest = useRef("");
  useEffect(() => {
    if (!requestedQuest || handledQuest.current === requestedQuest) return;
    handledQuest.current = requestedQuest;
    const target = maps.find((m) => questsOnMap(t as CloudTable, m, seat).some((i) => i.quest.id === requestedQuest));
    if (target && target.id !== map?.id) setSelected(target.id);
    // Once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedQuest]);
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
        .filter((s) => dm || shopVisible(s, t, seatGroups(t, seat)))
        .map((s) => ({
          id: s.id,
          label: s.name,
          kind: s.blackMarket ? "Black market" : "Shop",
          point: anchorFor(map, t, s.locationId),
          href: libraryRecordHref("shop", s.id),
        })),
      ...w.npcs
        .filter((n) => dm || npcAvailableHere(n, t, seatGroups(t, seat)))
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
              style: p.style,
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
  // ← Back: the parent map, only when this viewer can open it (docs/MAP-TILES.md).
  const parentMap = accessibleParent(allMaps, map);
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
  // All map settings, in groups (map controls PR 5). The empty workspace shows them together.
  const partySummary = (
    <p className="text-muted">
      {partySplit(t)
        ? groupRefs(t)
            .map(
              (g) =>
                `${groupInfo(t, g).name}: ${partyEnvironment(groupPlace(t, g).position) || locationLabel(market, groupPlace(t, g).locationId)}`,
            )
            .join(" · ")
        : partyEnvironment(w.partyPosition) || locationLabel(market, market.currentLocationId)}{" "}
      ·{" "}
      {party || groupPins?.length
        ? "Party position shown"
        : "Choose a map position or link a location to show the party"}
    </p>
  );
  const library = (
    <>
      <MapBrowser maps={maps} current={map?.id} select={(id) => selectMap(id)} />
      <div className="world-toolbar">
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
    </>
  );
  const placeLinks = (
    <>
      <div className="world-toolbar">
        <AppLink className="settings-link" href="/features/npcs">
          People & NPCs →
        </AppLink>
        <AppLink className="settings-link" href="/features/trading">
          Trading & Barter →
        </AppLink>
      </div>
      {dm && (
        <Fold title="Manage campaign locations">
          <MarketLocationsPanel />
        </Fold>
      )}
    </>
  );
  const management = (
    <>
      <SyncStatus compact /> {partySummary}
      {library}
      {placeLinks}
    </>
  );
  // Location link and Marker forms: in Settings, or in their own panel from the setup rail.
  const anchorForm = (onDone: () => void) =>
    map &&
    point && (
      <CommandForm
        label="Save location anchor"
        // Only typed or chosen fields count as a draft (closing a fresh pin asks nothing).
        dirty={!!location}
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
        onDone={onDone}
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
    );
  const markerForm = (onDone: () => void) =>
    map &&
    point && (
      <CommandForm
        label="Save live marker"
        dirty={!!(label || description)}
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
          setLabel("");
          setDescription("");
          onDone();
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
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
          DM only
        </label>
      </CommandForm>
    );
  const tileToggle = map?.grid && (
    <Button
      aria-pressed={effectiveTileMode}
      disabled={!!combatPresentation}
      onClick={() => {
        setTileMode(!tileMode);
        if (setupTool === "token") setPlacement(tileMode ? "" : "token");
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
  );
  const setupPanel =
    map && dm && setupTool && (point || PANEL_FIRST.includes(setupTool)) ? (
      setupTool === "token" ? (
        map.grid && effectiveTileMode ? (
          <CombatControls
            key={`setup-combat-${map.id}`}
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
            done={() => setPoint(undefined)}
          />
        ) : (
          <>
            <p>
              {map.grid
                ? "Combat tokens are placed and moved in tile mode."
                : "This map has no combat grid yet. Add one in Grid & scale."}
            </p>
            {!map.grid && (
              // Ungridded maps get an automatic hidden grid (owner, 2026-10-29): grid mode off,
              // so tokens move freely; show it later in Inspector › Scene permissions & vision.
              <CommandForm
                label="Add tokens with an automatic grid"
                submit={async () => ({
                  kind: "map-save",
                  mapId: map.id,
                  before: map,
                  map: {
                    ...map,
                    grid: automaticGrid(await imageSize(map.image), map.scale),
                    tabletop: { ...readMapTabletop(map), snap: false, gridHidden: true },
                  },
                })}
              >
                <p>
                  Adds a hidden grid of 5 ft squares over the whole image (from the scale bar when
                  the map has one). Grid mode stays off, so tokens move freely.
                </p>
              </CommandForm>
            )}
            {tileToggle}
          </>
        )
      ) : setupTool === "grid" ? (
        <>
          <p>
            {map.grid
              ? `Combat grid: ${map.grid.columns} × ${map.grid.rows} tiles, ${map.grid.feetPerTile} ft per tile, diagonals ${map.grid.diagonal === "alternating" ? "alternate 5/10/5" : "count as one tile"}.`
              : "No combat grid on this map."}{" "}
            {map.scale
              ? `Scale bar: ${map.scale.distance} ${map.scale.unit}.`
              : "No scale bar yet: Plan journey (J) asks for one on a map without a grid."}
          </p>
          <div className="world-toolbar">
            <Button onClick={() => setEditing(map)}>Edit grid, scale and map</Button>
            {tileToggle}
          </div>
        </>
      ) : setupTool === "party" ? (
        <PartyPlacement
          bare
          key={`setup-party-${map.id}`}
          map={map}
          table={t}
          point={point}
          begin={() => {}}
          done={() => setPoint(undefined)}
        />
      ) : setupTool === "marker" ? (
        markerForm(() => setPoint(undefined))
      ) : setupTool === "anchor" ? (
        anchorForm(() => setPoint(undefined))
      ) : (
        <MapConnectedTools
          only={setupTool}
          key={`setup-${setupTool}-${map.id}-${entranceDraft?.mapId === map.id ? JSON.stringify(entranceDraft.entry) : ""}`}
          map={map}
          table={t}
          point={point}
          begin={() => {}}
          done={() => {
            setEntranceDraft(undefined);
            setPoint(undefined);
          }}
          entranceDraft={
            setupTool === "entrance" && entranceDraft?.mapId === map.id ? entranceDraft : undefined
          }
          pickEntry={
            setupTool === "entrance"
              ? (draft) => {
                  // The draft is kept here, so the form unmounts first (no discard prompt), then
                  // the destination opens for picking its entry view.
                  setEntryPick(draft);
                  setSetupTool("");
                  setPlacement("");
                  setPoint(undefined);
                  window.setTimeout(() => selectMap(draft.target), 0);
                }
              : undefined
          }
        />
      )
    ) : undefined;
  const setup = map && (
    <>
      {dm && (
        <PartyPlacement
          key={`party-placement-${map.id}`}
          map={map}
          table={t}
          point={placement === "party" && !setupTool ? point : undefined}
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
          {!setupTool &&
            point &&
            placement === "anchor" &&
            anchorForm(() => {
              setPoint(undefined);
              setPlacement("");
            })}
          {!setupTool &&
            point &&
            placement === "marker" &&
            markerForm(() => {
              setPoint(undefined);
              setPlacement("");
            })}
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
              {partySplit(t)
                ? groupRefs(t)
                    .filter((g) => groupPlace(t, g).locationId === a.locationId)
                    .map((g) => ` · ${groupInfo(t, g).name} here`)
                    .join("")
                : a.locationId === market.currentLocationId
                  ? " · Party here"
                  : ""}
            </span>
            {dm &&
              (partySplit(t) ? (
                groupRefs(t)
                  .filter((g) => groupPlace(t, g).locationId !== a.locationId)
                  .map((g) => (
                    <CommandButton
                      key={g}
                      input={{
                        kind: "party-location",
                        ...(g === MAIN_GROUP ? {} : { groupId: g }),
                        beforePosition: canonicalJson(groupPlace(t, g).position ?? null),
                        before: groupPlace(t, g).locationId,
                        locationId: a.locationId,
                      }}
                    >
                      {`Move ${groupInfo(t, g).name} here`}
                    </CommandButton>
                  ))
              ) : (
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
              ))}
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
      {handoutError && <p role="alert">{handoutError}</p>}
      {map ? (
        <>
          <MapViewport
            map={map}
            planRequest={requestedPlan}
            planMapId={requestedMap}
            navigation={navigation}
            maps={allMaps}
            indexedRecords={allMaps.flatMap((m) =>
              recordsForMap(m).map((record) => ({ mapId: m.id, context: m.name, record })),
            )}
            settings={{
              thisMap: library,
              places: (
                <>
                  {partySummary}
                  {setup}
                  {placeLinks}
                </>
              ),
              players: <SyncStatus compact />,
            }}
            viewScope={viewScope}
            toggleGrid={() => {
              if (!combatPresentation) setTileMode(!tileMode);
            }}
            gridLocked={!!combatPresentation}
            placementKind={placement}
            recordTable={t}
            entryCamera={entryCamera}
            openRecord={deepLink}
            partyMapId={w.partyPosition?.mapId ?? best?.id}
            placeBar={
              placement === "place" && placeRequest?.mapId === map.id ? (
                <MapPlaceBar
                  key={`${placeRequest.reference.kind}:${placeRequest.reference.id}`}
                  map={map}
                  table={t}
                  reference={placeRequest.reference}
                  point={point}
                  done={() => endPlacing(placeRequest.reference)}
                  cancel={() => {
                    afterContextChange(() => endPlacing());
                  }}
                />
              ) : undefined
            }
            notice={placeNotice}
            dismissNotice={() => setPlaceNotice("")}
            onRecordMissing={() => setPlaceNotice(PLACE_UNAVAILABLE)}
            selectMap={selectMap}
            parentMap={parentMap}
            goParent={
              parentMap
                ? () => selectMap(parentMap.id, undefined, history.at(-1) === parentMap.id)
                : undefined
            }
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
            groupPins={groupPins}
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
            controls={{
              session: <MapSessionBar map={map} />,
              connected: (
                <>
                  {dm && (
                    <MapConnectedTools
                      reveal={placement === "record"}
                      key={`connected-${map.id}`}
                      map={map}
                      table={t}
                      point={placement === "record" && !setupTool ? point : undefined}
                      begin={() => {
                        setSetupTool("");
                        setPlacement("record");
                        setPoint(undefined);
                      }}
                      done={() => {
                        setPlacement("");
                        setPoint(undefined);
                      }}
                    />
                  )}
                </>
              ),
              combat: (
                <>
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
                          point={placement === "token" && setupTool !== "token" ? point : undefined}
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
              ),
            }}
            placing={!!placement}
            stopPlacing={() => {
              setPlacement("");
              setPoint(undefined);
              setSetupTool("");
            }}
            setup={
              dm
                ? {
                    tool: setupTool,
                    arm: (tool, at) => {
                      setSetupTool(tool);
                      setPlacement(
                        tool === "token" && !effectiveTileMode ? "" : SETUP_PLACEMENT[tool],
                      );
                      // The map menu arms a tool with its point already chosen (its panel opens).
                      setPoint(at);
                    },
                    panel: setupPanel,
                    closePanel: () => setPoint(undefined),
                  }
                : undefined
            }
            quests={questSlot}
            entryPick={
              entryPick && entryPick.target === map.id
                ? {
                    label: entryPick.label,
                    use: (camera) => {
                      const draft = { ...entryPick, entry: camera };
                      setEntryPick(undefined);
                      setEntranceDraft(draft);
                      pendingSetup.current = {
                        mapId: draft.mapId,
                        tool: "entrance",
                        point: draft.point,
                      };
                      selectMap(draft.mapId);
                    },
                    cancel: () => {
                      const draft = entryPick;
                      setEntryPick(undefined);
                      setEntranceDraft(draft);
                      pendingSetup.current = {
                        mapId: draft.mapId,
                        tool: "entrance",
                        point: draft.point,
                      };
                      selectMap(draft.mapId);
                    },
                  }
                : undefined
            }
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
        <MapEmptyWorkspace
          dm={dm}
          settings={management}
          travel={
            !dm &&
            (t.journal.world?.journeys ?? []).some((j) =>
              ["active", "arrived", "proposed", "denied"].includes(j.status),
            ) ? (
              <JourneyTravelSection table={t} planLink={false} />
            ) : undefined
          }
        />
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
        afterContextChange(() => close());
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
  planRequest,
  planMapId,
  maps,
  indexedRecords,
  settings: setupSettings,
  viewScope,
  toggleGrid,
  gridLocked,
  placementKind,
  navigation,
  entryCamera,
  openRecord,
  partyMapId,
  placeBar,
  notice,
  dismissNotice,
  onRecordMissing,
  selectMap,
  setup,
  entryPick,
  quests,
  parentMap,
  goParent,
  locationMaps,
  openLocation,
  recordTable,
  party,
  groupPins,
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
  /** `plan=party` or `plan=ship:<propertyId>` from the URL opens the route planner. */
  planRequest?: string;
  planMapId?: string;
  maps: CampaignMap[];
  indexedRecords: { mapId: string; context: string; record: MapRecord }[];
  /** All map settings, by group (the viewport adds This map's views, Exploration, View…). */
  settings: { thisMap: ReactNode; places: ReactNode; players: ReactNode };
  viewScope: { key: string; ephemeral: boolean };
  toggleGrid: () => void;
  gridLocked: boolean;
  placementKind: string;
  navigation: ReactNode;
  recordTable: CloudTable;
  entryCamera?: { mapId: string; view: { x: number; y: number; zoom: number }; nonce: string };
  /** A deep-linked record to highlight and open (Place hub). */
  openRecord?: { mapId: string; reference: MapRecordReference; nonce: string };
  /** The map that shows the party (for the Here sheet's "Back to where the party is"). */
  partyMapId?: string;
  /** The DM's "Place on map" bar while placing a chosen record. */
  placeBar?: ReactNode;
  notice?: string;
  dismissNotice?: () => void;
  onRecordMissing?: () => void;
  selectMap: (id: string, entry?: { x: number; y: number; zoom: number }) => void;
  /** DM map setup rail (map controls): the armed tool, its panel once placed. */
  setup?: {
    tool: SetupTool | "";
    arm: (tool: SetupTool, point?: { x: number; y: number }) => void;
    panel?: ReactNode;
    closePanel: () => void;
  };
  /** Quest log map stage (reserved slot; absent until the quest stage lands). */
  quests?: MapQuestsSlot;
  /** Picking an entrance's entry camera on this (destination) map. */
  entryPick?: {
    label: string;
    use: (camera: { x: number; y: number; zoom: number }) => void;
    cancel: () => void;
  };
  /** The accessible parent map, for ← Back, Backspace and Android Back. */
  parentMap?: CampaignMap;
  goParent?: () => void;
  locationMaps: (id: string) => CampaignMap[];
  openLocation: (id: string) => boolean;
  party?: { x: number; y: number };
  /** Split the party: each group's marker on this map (when split). */
  groupPins?: GroupPin[];
  placing: boolean;
  point?: { x: number; y: number };
  onPlace: (p: { x: number; y: number }) => void;
  entities: MapRecord[];
  stopPlacing: () => void;
  tileMode: boolean;
  routes: { id: string; points: { x: number; y: number }[] }[];
  controls: { session: ReactNode; connected: ReactNode; combat: ReactNode };
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
    [settingsQuery, setSettingsQuery] = useState(""),
    [settingsMatches, setSettingsMatches] = useState(0),
    [highlight, setHighlight] = useState<MapRecordReference>(),
    [placeAnnouncement, setPlaceAnnouncement] = useState(""),
    [cardFocus, setCardFocus] = useState<string>(),
    [deepLinkedCard, setDeepLinkedCard] = useState<MapRecordReference>(),
    [hereOpen, setHereOpen] = useState(false),
    [layersOpen, setLayersOpen] = useState(false),
    [initiativeOpen, setInitiativeOpen] = useState(false),
    [questsOpen, setQuestsOpen] = useState(false),
    [railMore, setRailMore] = useState(false);
  // Desktop and landscape phones: vertical tools rail; phones keep today's bottom hotbar.
  const layout = useMapLayout(),
    rail = isRailLayout(layout),
    toolNames = useToolNames(),
    railNames = rail && layout !== "landscape" && toolNamesVisible(toolNames);
  // Panels beside the rail (Settings, inspector, tool options) clear its current width.
  useLayoutEffect(() => {
    const frame = root.current?.closest<HTMLElement>(".map-workspace");
    if (!frame) return;
    const anchor = frame.querySelector<HTMLElement>(".map-hotbar-anchor:not(.map-setup-anchor)");
    const width = rail && !interfaceHidden && anchor ? anchor.getBoundingClientRect().width : 0;
    frame.style.setProperty("--map-tools-w", `${Math.round(width)}px`);
    const setupRail = frame.querySelector<HTMLElement>(".map-setup-anchor");
    const setupWidth =
      rail && !interfaceHidden && setupRail ? setupRail.getBoundingClientRect().width : 0;
    frame.style.setProperty("--map-setup-w", `${Math.round(setupWidth)}px`);
  });
  const viewer = useSeat(),
    navigate = useNavigate();
  const serviceTable = recordTable;
  useLayoutEffect(() => {
    setDetails([]);
    setService(undefined);
    setServiceExpanded(false);
    setPinging(false);
    setDrawerOpen(false);
  }, [map.id]);
  useEffect(() => {
    // "Place on map" keeps its own bar; the settings drawer stays closed.
    if (placing && full && placementKind !== "place" && !setup?.tool) {
      setDrawerOpen(!!point);
      if (point)
        showSettingsGroup(
          placementKind === "record" ? "this-map" : placementKind === "token" ? "combat" : "places",
        );
    }
  }, [placing, point, full, placementKind, setup?.tool]);
  const signals = useMapPings(map.id),
    seatNow = useSeat(),
    useDm = seatNow.role === "dm",
    // Player movement (map tokens PR 2): free outside combat, turns while the DM shows combat.
    turnOrder = useMapTurnOrder(map, useDm),
    movement = playerMovement(map, turnOrder),
    tools = useMapTabletopTools(map, selectedToken, onTokenSelect, useDm ? undefined : movement);
  const ownToken = useDm
    ? undefined
    : map.tokens?.find(
        (t) => t.kind === "character" && !!t.entityId && seatNow.purseIds.includes(t.entityId),
      );
  const claimable =
    !useDm && !!map.grid && movement.mode === "auto" && (!movement.combat || movement.myTurn)
      ? recordTable.purses.find(
          (p) =>
            p.kind === "character" &&
            seatNow.purseIds.includes(p.id) &&
            !map.tokens?.some((t) => t.kind === "character" && t.entityId === p.id) &&
            !map.tabletop?.lockedPurseIds?.includes(p.id),
        )
      : undefined;
  const speedFeet = ownToken
    ? sheetSpeedFeet(recordTable.sheets?.find((sheet) => sheet.purseId === ownToken.entityId)?.speed)
    : undefined;
  const sketches = useMapSketches(viewScope, map.id);
  const wheelSpacing = useRef<((e: WheelEvent) => boolean) | undefined>(undefined);
  wheelSpacing.current = (e) => {
    if (!tools.group.placing || !e.altKey) return false;
    tools.group.spacing(e.deltaY > 0 ? -1 : 1);
    return true;
  };
  // Place party (map tokens PR 3): the party's characters by group, ticked for the main group.
  const [partyPanel, setPartyPanel] = useState(false),
    [partyChecks, setPartyChecks] = useState<Record<string, boolean>>({}),
    [makeDefault, setMakeDefault] = useState(true),
    newTokenIds = useRef(new Map<string, string>());
  const partyRows: PartyRow[] = useDm
    ? groupRefs(recordTable).flatMap((ref) =>
        groupMembers(recordTable, ref).map((person) => {
          const token = map.tokens?.find((t) => t.kind === "character" && t.entityId === person.id);
          const info = groupInfo(recordTable, ref);
          const place = groupPlace(recordTable, ref).locationId;
          const placeName = readMarketLocations(recordTable.journal?.market).locations.find((l) => l.id === place)?.name;
          return {
            purseId: person.id,
            name: person.name,
            status:
              ref !== MAIN_GROUP
                ? `Group ${info.letter}${placeName ? ` · ${placeName}` : ""}`
                : token
                  ? "on map · will move"
                  : "not on this map",
            checked: partyChecks[person.id] ?? ref === MAIN_GROUP,
            order: token ? token.row * 1000 + token.column : 1e9,
          };
        }),
      )
        // Characters already on the map keep their reading order, so the formation keeps it too.
        .sort((a, b) => a.order - b.order)
    : [];
  const partyMembers = (): { token: MapToken; before: MapToken | null }[] =>
    membersFor(partyRows.filter((row) => row.checked));
  /** Each character's token on this map (it moves), or a new one (it is placed). */
  const membersFor = (rows: { purseId: string; name: string }[]): { token: MapToken; before: MapToken | null }[] =>
    rows
      .flatMap((row): { token: MapToken; before: MapToken | null }[] => {
        const token = map.tokens?.find((t) => t.kind === "character" && t.entityId === row.purseId);
        if (token) return [{ token, before: token }];
        if (!newTokenIds.current.has(row.purseId)) newTokenIds.current.set(row.purseId, crypto.randomUUID());
        return [
          {
            token: {
              id: newTokenIds.current.get(row.purseId)!,
              kind: "character" as const,
              entityId: row.purseId,
              label: row.name,
              column: 0,
              row: 0,
              visibility: "party" as const,
            },
            before: null,
          },
        ];
      });
  const openPlaceParty = () => {
    if (!map.grid) return;
    setPartyPanel(true);
    tools.group.startPlacing({ members: partyMembers(), mode: "formation", label: "party", makeDefault });
  };
  const closePlaceParty = () => {
    setPartyPanel(false);
    tools.group.setPlacing(null);
  };
  useEffect(() => {
    // The panel follows the ticks; it closes once the party is placed.
    if (!partyPanel) return;
    if (!tools.group.placing) {
      setPartyPanel(false);
      return;
    }
    tools.group.setPlacing((current) => (current ? { ...current, members: partyMembers(), makeDefault } : current));
    // partyMembers reads partyChecks and the map; rerun when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyChecks, makeDefault, partyPanel, map.tokens]);
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
    ...(groupPins
      ? groupPins.map((g) => ({
          id: `group:${g.ref}`,
          label: g.name,
          kind: "Party",
          point: g.point,
          description: `Group ${g.letter} · ${g.where}`,
        }))
      : party
        ? [{ id: "party", label: "Party", kind: "Party", point: party }]
        : []),
  ];
  // Map tokens PR 1: characters, creatures and custom tokens are drawn at their footprint
  // (MapTokenLayer); ships keep their record icon.
  const discTokens =
    tileMode && map.grid && visible.includes("Combatant")
      ? (map.tokens ?? []).filter((t) => discToken(t) && (useDm || t.visibility === "party"))
      : [];
  const groups = groupMapRecords(
    records.filter((r) => !(r.kind === "Combatant" && discTokens.some((t) => t.id === r.id))),
    visible,
  );
  const currentDetails = details.flatMap((d) => {
    const match = records.filter((r) => r.id === d.id && r.kind === d.kind);
    return match.length
      ? match
      : d.detached || (d.kind === "Location" && map.anchors.some((a) => a.locationId === d.id))
        ? [d]
        : [];
  });
  // Derived from the projected table; recomputed only when it or the viewed map changes.
  // Split the party: the Here sheet shows one group's place (the DM: every group; a player: theirs).
  const hereGroups = seatGroups(recordTable, viewer);
  const [hereGroupChoice, setHereGroup] = useState<string>();
  const hereGroup =
    hereGroupChoice && hereGroups.includes(hereGroupChoice) ? hereGroupChoice : hereGroups[0];
  const here = useMemo(
    () => hereSheet(recordTable, viewer, map, hereGroup),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      recordTable.journal,
      recordTable.shops,
      recordTable.holdings,
      recordTable.listings,
      recordTable.purses,
      viewer,
      map,
      hereGroup,
    ],
  );
  const drawnRecord = (reference: MapRecordReference) =>
    records.find((r) => sameRecord(r.reference, reference) && r.point);
  // The deep-link highlight lasts while that record's card is open (the pulse itself is short).
  const highlighted =
    currentDetails.length === 1 && sameRecord(currentDetails[0].reference, highlight)
      ? highlight
      : undefined;
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
    if (!camera) {
      // First visit: fit the whole map, centred on the party (or the first group) when it is here.
      setView(openingView({ size, w, h, focus: party ?? groupPins?.[0]?.point }));
      return;
    }
    const restoredScale = Math.min(8, Math.max(0.5, (camera.zoom * (camera.basis ?? w)) / w));
    setView({
      x: size.w / 2 - camera.x * w * restoredScale,
      y: size.h / 2 - camera.y * h * restoredScale,
      scale: restoredScale,
    });
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
      // Place party: Alt+wheel changes the formation's spacing (map tokens PR 3).
      if (wheelSpacing.current?.(e)) return;
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
  // Journey planner ("Plan route"): taps add waypoints while it is open (map-route-planner.tsx).
  const [reviewJourney, setReviewJourney] = useState<string>();
  const journeyView = useMapJourney({ map, table: recordTable, openReview: setReviewJourney });
  const planner = useRoutePlanner({
    map,
    table: recordTable,
    milesPerDay: recordTable.journal?.world?.travel?.paces.normal,
    partyActions: (draft) => (
      <JourneyPlanActions
        table={recordTable}
        map={map}
        draft={draft}
        onReview={(id) => {
          planner.finish();
          setReviewJourney(id);
        }}
      />
    ),
    aspect: ratio,
    toScreen: (p) => ({ x: view.x + p.x * w * view.scale, y: view.y + p.y * h * view.scale }),
    toMap: mapPoint,
    partyStart: party,
    openShip: (propertyId) => {
      const reference = { kind: "property" as const, id: propertyId };
      const drawn = drawnRecord(reference);
      if (drawn) {
        focusRecord(drawn);
        setServiceExpanded(true);
      } else void navigate({ to: "/maps", search: { record: recordParam(reference) } });
    },
  });
  const handledPlan = useRef("");
  useEffect(() => {
    if (!planRequest) {
      handledPlan.current = "";
      return;
    }
    const key = `${planMapId ?? ""}|${planRequest}`;
    if (handledPlan.current === key || (planMapId && planMapId !== map.id)) return;
    handledPlan.current = key;
    if (planRequest === "party") planner.start("party");
    else if (planRequest.startsWith("journey:")) {
      const id = planRequest.slice("journey:".length);
      if (
        useDm &&
        recordTable.journal?.world?.journeys?.some((j) => j.id === id && j.status !== "completed")
      )
        setReviewJourney(id);
    } else if (planRequest.startsWith("ship:"))
      planner.start("ship", { shipId: planRequest.slice("ship:".length) });
    // Handled once per URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planRequest, planMapId, map.id]);
  const openPlanner = () => {
    if (planner.active) {
      planner.close();
      return;
    }
    if (!allowContextChange(() => openPlanner())) return;
    tools.cancel();
    sketches.cancel();
    stopPlacing();
    setPinging(false);
    setMoreTools(false);
    setDrawerOpen(false);
    setContextOpen(false);
    setDetails([]);
    setService(undefined);
    setHereOpen(false);
    tools.hideInspector();
    planner.start("party");
    root.current?.focus();
  };
  // Phones (mockup 4): the planner is a bottom sheet over the map, so when it opens, or switches
  // to scale calibration, the camera zooms out just enough to show the map (or a drawn route) in
  // the band above the sheet. Once per mode, never while someone is drawing. Wider screens keep
  // their camera: the panel sits beside the map there.
  const framing = planner.active ? (planner.calibrating ? "scale" : "plan") : "";
  useEffect(() => {
    if (!framing || !artworkReady || !window.matchMedia("(max-width: 650px)").matches) return;
    const frame = requestAnimationFrame(() => {
      const region = root.current;
      const sheet = region
        ?.closest(".map-workspace")
        ?.querySelector<HTMLElement>(".map-route-panel")
        ?.getBoundingClientRect();
      if (!region || !sheet) return;
      const r = region.getBoundingClientRect();
      const area = freeArea(
        { width: r.width, height: r.height },
        {
          left: sheet.left - r.left,
          top: sheet.top - r.top,
          right: sheet.right - r.left,
          bottom: sheet.bottom - r.top,
        },
        { left: 10, top: 112, right: 10, bottom: 10 },
      );
      const route = planner.focusPoints;
      const points =
        framing === "plan" && route.length > 1
          ? route
          : [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ];
      const next = frameRoute(points, viewRef.current, { w, h }, area);
      if (next) setView(next);
    });
    return () => cancelAnimationFrame(frame);
    // Framed once per opened mode; later edits leave the camera to the person drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framing, map.id, artworkReady]);
  const openSettings = () => {
    if (
      !drawerOpen &&
      (tools.inspecting || service || combatOpen) &&
      !allowContextChange(() => openSettings())
    )
      return;
    tools.hideInspector();
    setDetails([]);
    setService(undefined);
    setCombatOpen(false);
    setContextOpen(false);
    setDrawerOpen(!drawerOpen);
  };
  const openCombat = () => {
    if (!allowContextChange(() => openCombat())) return;
    setCombatOpen(true);
    setMoreTools(false);
    setDetails([]);
    setService(undefined);
    setDrawerOpen(false);
    setContextOpen(false);
    tools.hideInspector();
  };
  const combatHere =
    recordTable.journal?.world?.combat?.mapId === map.id &&
    recordTable.journal?.world?.combat?.phase === "active";
  const togglePing = () => {
    afterContextChange(() => {
      tools.cancel();
      sketches.cancel();
      stopPlacing();
      setPinging(!pinging);
      // Ping's options (its colour) open beside the rail while it is armed.
      setContextOpen(!pinging);
      setDrawerOpen(false);
      root.current?.focus();
    });
  };
  const openDraw = () => {
    afterContextChange(() => {
      chooseTool("pan");
      sketches.setActive(true);
      setContextOpen(true);
    });
  };
  // Right-side panels (Initiative, Here, Layers, Settings) replace each other.
  const toggleHere = () => {
    if (hereOpen) {
      setHereOpen(false);
      return;
    }
    afterContextChange(() => {
      setDetails([]);
      setService(undefined);
      setDrawerOpen(false);
      setCombatOpen(false);
      setLayersOpen(false);
      setInitiativeOpen(false);
      tools.hideInspector();
      setHereOpen(true);
    });
  };
  const toggleLayers = () => {
    if (layersOpen) {
      setLayersOpen(false);
      return;
    }
    afterContextChange(() => {
      setDrawerOpen(false);
      setHereOpen(false);
      setCombatOpen(false);
      setMoreTools(false);
      setInitiativeOpen(false);
      setLayersOpen(true);
    });
  };
  // Initiative (I): the turn-order panel. DMs always; players while combat is shown on this map.
  const combatShownHere = recordTable.journal?.world?.tabletop?.presentation?.mapId === map.id;
  const initiativeAvailable = useDm || combatShownHere;
  const toggleQuests = () => {
    if (!quests) return;
    if (questsOpen) {
      setQuestsOpen(false);
      return;
    }
    afterContextChange(() => {
      setDrawerOpen(false);
      setHereOpen(false);
      setLayersOpen(false);
      setInitiativeOpen(false);
      setQuestsOpen(true);
    });
  };
  // Quest stage: picking a quest frames its pins and areas (zooming in as far as 3×).
  const questFocus = quests?.focus;
  useEffect(() => {
    if (!questFocus?.points.length || !artworkReady) return;
    const frame = requestAnimationFrame(() => {
      const region = root.current?.getBoundingClientRect();
      if (!region) return;
      const panel = document.getElementById("map-quests")?.getBoundingClientRect();
      const area = freeArea(
        { width: region.width, height: region.height },
        panel
          ? { left: panel.left - region.left, top: panel.top - region.top, right: panel.right - region.left, bottom: panel.bottom - region.top }
          : undefined,
        { left: 10, top: 112, right: 10, bottom: 10 },
      );
      const sidePanel = panel && panel.right - panel.left <= region.width * 0.6;
      const box = sidePanel ? { ...area, left: 10, right: Math.min(area.right, panel.left - region.left - 8) } : area;
      const pts = questFocus.points;
      const xs = pts.map((p) => p.x),
        ys = pts.map((p) => p.y);
      const minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minY = Math.min(...ys),
        maxY = Math.max(...ys);
      const width = Math.max(40, box.right - box.left - 56),
        height = Math.max(40, box.bottom - box.top - 56);
      const fit = Math.min(
        maxX > minX ? width / ((maxX - minX) * w) : 3,
        maxY > minY ? height / ((maxY - minY) * h) : 3,
      );
      const scale = Math.min(3, Math.max(0.5, fit));
      setView({
        scale,
        x: (box.left + box.right) / 2 - ((minX + maxX) / 2) * w * scale,
        y: (box.top + box.bottom) / 2 - ((minY + maxY) / 2) * h * scale,
      });
    });
    return () => cancelAnimationFrame(frame);
    // Framed once per pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questFocus?.nonce, artworkReady]);
  const questOpenNonce = quests?.openNonce;
  useEffect(() => {
    if (questOpenNonce && !questsOpen) toggleQuests();
    // Once per request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questOpenNonce]);
  // A radius marker being dragged by the DM (shown live; saved once on release).
  const [questDrag, setQuestDrag] = useState<{ key: string; x: number; y: number; r: number }>();
  const openQuestOnMap = (questId: string) => {
    quests?.select?.(questId);
    if (!questsOpen) toggleQuests();
  };
  const toggleInitiative = () => {
    if (initiativeOpen) {
      setInitiativeOpen(false);
      return;
    }
    afterContextChange(() => {
      setDrawerOpen(false);
      setHereOpen(false);
      setLayersOpen(false);
      setCombatOpen(false);
      setInitiativeOpen(true);
    });
  };
  const setupPanelRef = useRef<HTMLElement>(null);
  const armSetup = (tool: SetupTool, at?: { x: number; y: number }) => {
    if (!setup) return;
    afterContextChange(() => {
      tools.cancel();
      sketches.cancel();
      setPinging(false);
      setContextOpen(false);
      setMoreTools(false);
      if (planner.active) planner.close();
      setup.arm(tool, at);
      root.current?.focus();
    });
  };
  const closeSetupPanel = () => {
    if (!setup?.panel) return false;
    afterContextChange(() => {
      setup.closePanel();
      root.current?.focus();
    });
    return true;
  };
  // A placed pin opens its panel with focus on the first field; on phones (a bottom sheet) the
  // camera moves the pin into the free band above the sheet.
  const setupOpen = !!(setup?.tool && setup.panel);
  useEffect(() => {
    if (!setupOpen) return;
    const panel = setupPanelRef.current;
    panel
      ?.querySelector<HTMLElement>("input:not([type=hidden]),select,textarea,button[role=combobox]")
      ?.focus({ preventScroll: true });
    if (!point || !panel || !window.matchMedia("(max-width: 650px)").matches) return;
    const frame = requestAnimationFrame(() => {
      const region = root.current?.getBoundingClientRect(),
        sheet = panel.getBoundingClientRect();
      if (!region) return;
      const area = freeArea(
        { width: region.width, height: region.height },
        {
          left: sheet.left - region.left,
          top: sheet.top - region.top,
          right: sheet.right - region.left,
          bottom: sheet.bottom - region.top,
        },
        { left: 10, top: 112, right: 10, bottom: 10 },
      );
      const next = frameRoute([point], viewRef.current, { w, h }, area);
      if (next) setView(next);
    });
    return () => cancelAnimationFrame(frame);
    // Once per opened panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupOpen]);
  const settingsGroupsRef = useRef<HTMLDivElement>(null);
  const settingsGroups: [string, string][] = [
    ["this-map", "This map"],
    ["places", "Places & party"],
    ["players", "Players & display"],
    ...(useDm ? ([["exploration", "Exploration"]] as [string, string][]) : []),
    ["combat", "Combat"],
    ["view", "View"],
    ["shortcuts", "Shortcuts & help"],
  ];
  /** Opens All map settings at one group (also used by tools' "In Settings" links). */
  function showSettingsGroup(id: string) {
    setDrawerOpen(true);
    requestAnimationFrame(() =>
      document.getElementById(`map-settings-${id}`)?.scrollIntoView({ block: "start" }),
    );
  }
  // Search: groups whose text does not match are hidden (DOM text, so every row counts).
  useEffect(() => {
    const root = settingsGroupsRef.current;
    if (!root) return;
    const query = settingsQuery.trim().toLocaleLowerCase();
    let matches = 0;
    for (const section of root.querySelectorAll<HTMLElement>("[data-settings-group]")) {
      const hit = !query || (section.textContent ?? "").toLocaleLowerCase().includes(query);
      section.hidden = !hit;
      if (hit) matches++;
    }
    setSettingsMatches(matches);
  }, [settingsQuery, drawerOpen]);
  // Reveal tools (DM) open their options beside the setup rail, with fog actions or their lists.
  const revealTool =
    useDm && REVEAL_TOOLS.some((t) => t.tool === tools.tool) && !sketches.active && !pinging
      ? tools.tool
      : undefined;
  /** Ctrl/⌘+Z and Ctrl/⌘+Shift+Z undo and redo fog while a fog tool is armed (DM). */
  const fogHistoryKey = (e: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    preventDefault: () => void;
  }) => {
    if (!useDm || !tools.tool.startsWith("fog-") || !(e.ctrlKey || e.metaKey)) return false;
    if (e.key.toLowerCase() !== "z") return false;
    e.preventDefault();
    if (e.shiftKey) {
      if (tools.canRedoFog) void tools.redoFog();
    } else if (tools.canUndoFog) void tools.undoFog();
    return true;
  };
  const openObjects = () => {
    afterContextChange(() => {
      setDrawerOpen(false);
      setHereOpen(false);
      setLayersOpen(false);
      tools.openInspector();
    });
  };
  const setupButton = ({ tool, label, name, shortcut, Icon }: (typeof SETUP_TOOLS)[number]) => (
    <MapTool
      key={tool}
      icon={<Icon size={19} />}
      label={label}
      name={name}
      shortcut={`⇧${shortcut}`}
      keys={`Shift+${shortcut}`}
      pressed={setup?.tool === tool}
      expanded={PANEL_FIRST.includes(tool) ? setup?.tool === tool : undefined}
      onClick={() => armSetup(tool)}
    />
  );
  /** Shift shortcuts for the setup rail (DM): Place ⇧P ⇧M ⇧E ⇧R ⇧L, Reveal ⇧F ⇧W ⇧I,
   * Combat ⇧T ⇧G, Objects ⇧O. */
  const setupShortcut = (key: string) => {
    if (!setup) return false;
    const upper = key.toUpperCase();
    const tool = SETUP_TOOLS.find((t) => t.shortcut === upper);
    if (tool) armSetup(tool.tool);
    else if (upper === "A" && map.grid) openPlaceParty();
    else {
      const reveal = REVEAL_TOOLS.find((t) => t.shortcut === upper);
      if (reveal) chooseTool(reveal.tool);
      else if (upper === "O") openObjects();
      else return false;
    }
    return true;
  };
  /** Panel and tool shortcuts shared by the map canvas and the rest of the workspace. */
  const panelShortcut = (key: string) => {
    const k = key.toLowerCase();
    if (k === "d") openDraw();
    else if (k === "j") openPlanner();
    else if (k === "e" && !placeBar) toggleHere();
    else if (k === "l") toggleLayers();
    else if (k === "i" && initiativeAvailable) toggleInitiative();
    else if (k === "q" && quests) toggleQuests();
    else return false;
    return true;
  };
  const chooseTool = (tool: Parameters<typeof tools.activateTool>[0]) => {
    if (!allowContextChange(() => chooseTool(tool))) return;
    if (planner.active && !["pan", "select"].includes(tool)) planner.close();
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
    if (!allowContextChange(() => focusRecord(record))) return;
    if (record.point)
      setView((v) => ({
        ...v,
        x: size.w / 2 - record.point!.x * w * v.scale,
        y: size.h / 2 - record.point!.y * h * v.scale,
      }));
    setDetails([record]);
    setService(record.reference);
    setServiceExpanded(false);
    setDrawerOpen(false);
    setContextOpen(false);
    tools.hideInspector();
    if (record.reference) setCardFocus(crypto.randomUUID());
  };
  const handledOpen = useRef("");
  useEffect(() => {
    if (!openRecord || openRecord.mapId !== map.id || handledOpen.current === openRecord.nonce)
      return;
    handledOpen.current = openRecord.nonce;
    const record = records.find((r) => sameRecord(r.reference, openRecord.reference));
    if (!record) {
      onRecordMissing?.();
      return;
    }
    setDetails([record]);
    setService(record.reference);
    setServiceExpanded(false);
    setDrawerOpen(false);
    setContextOpen(false);
    tools.hideInspector();
    setHighlight(record.reference);
    setDeepLinkedCard(record.reference);
    setCardFocus(openRecord.nonce);
    setPlaceAnnouncement(`Showing ${record.label} on ${map.name}`);
    // Runs once per deep link; `records` is read at that moment only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRecord?.nonce, map.id]);

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
        else if (setupOpen) closeSetupPanel();
        else if (layersOpen) setLayersOpen(false);
        else if (initiativeOpen) setInitiativeOpen(false);
        else if (questsOpen) setQuestsOpen(false);
        else if (moreTools) setMoreTools(false);
        else if (service || details.length || combatOpen || tools.inspecting || hereOpen) {
          const closeAll = () => {
            setHereOpen(false);
            setService(undefined);
            setDetails([]);
            setCombatOpen(false);
            tools.hideInspector();
          };
          if (!allowContextChange(() => (closeAll(), root.current?.focus()))) return;
          closeAll();
        } else if (planner.active) {
          planner.close();
        } else if (
          contextOpen ||
          placing ||
          pinging ||
          sketches.active ||
          !["pan", "select"].includes(tools.tool)
        ) {
          const cancelTools = () => {
            tools.cancel();
            sketches.cancel();
            stopPlacing();
            setPinging(false);
            setContextOpen(false);
          };
          if (!allowContextChange(() => (cancelTools(), root.current?.focus()))) return;
          cancelTools();
        } else return;
        e.preventDefault();
        root.current?.focus();
      }
      if (
        !(e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"],.map-viewport',
        ) &&
        fogHistoryKey(e)
      )
        return;
      if (
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"],.map-viewport',
        ) ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      const tool = e.shiftKey
        ? undefined
        : ({ v: "pan", s: "select", m: "measure", t: "template" } as const)[
            e.key.toLowerCase() as "v"
          ];
      if (
        e.key.toLowerCase() === "p" &&
        !e.shiftKey &&
        !signals.viewOnly &&
        !drawerOpen &&
        !service &&
        !combatOpen
      ) {
        const ping = () => {
          tools.cancel();
          sketches.cancel();
          stopPlacing();
          setPinging(!pinging);
          root.current?.focus();
        };
        if (allowContextChange(ping)) {
          e.preventDefault();
          ping();
        }
      }
      if (tool && !drawerOpen && !service && !combatOpen) {
        e.preventDefault();
        chooseTool(tool);
      } else if (!drawerOpen && !service && !combatOpen && !e.shiftKey && panelShortcut(e.key))
        e.preventDefault();
      else if (!drawerOpen && !service && !combatOpen && e.shiftKey && setupShortcut(e.key))
        e.preventDefault();
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
  // Table and View groups: in the rail, or folded into More on short desktops.
  const lowerGroups = (
    <>
      <MapToolGroup caption="Table">
        {initiativeAvailable && (
          <MapTool
            icon={<Swords size={19} />}
            label="Initiative"
            shortcut="I"
            keys="I"
            badge={combatHere || (!useDm && combatShownHere) ? "●" : undefined}
            badgeLabel="Encounter on this map"
            expanded={initiativeOpen}
            controls="map-initiative"
            onClick={toggleInitiative}
          />
        )}
        {quests && (
          <MapTool
            icon={<ScrollText size={19} />}
            label="Quests"
            shortcut="Q"
            keys="Q"
            badge={quests.count || undefined}
            badgeLabel="active quests on this map"
            expanded={questsOpen}
            controls="map-quests"
            onClick={toggleQuests}
          />
        )}
        {!placeBar && (
          <MapTool
            icon={<House size={19} />}
            label={here.mode === "road" ? "Here: on the road" : "Here"}
            shortcut="E"
            keys="E"
            badge={here.mode === "here" ? here.rows.length : undefined}
            badgeLabel="places to use here"
            expanded={hereOpen}
            onClick={toggleHere}
          />
        )}
      </MapToolGroup>
      <MapToolGroup caption="View">
        <MapTool
          // The map menu at the centre crosshair (map tokens PR 5): screen readers and anyone
          // without right-click or a long press; phones get the bottom sheet.
          icon={<MousePointerClick size={19} />}
          label="Map actions"
          keys="Shift+F10"
          onClick={() => {
            const box = root.current?.getBoundingClientRect();
            if (box) openMapMenu(box.left + box.width / 2, box.top + box.height / 2, undefined, root.current, layout === "phone");
          }}
        />
        <MapTool
          icon={<Layers size={19} />}
          label="Layers"
          shortcut="L"
          keys="L"
          expanded={layersOpen}
          controls="map-layers"
          onClick={toggleLayers}
        />
        {!useDm && (
          // Players: the inspector (DMs: Objects & inspector in the setup rail).
          <MapTool
            icon={<Menu size={19} />}
            label="Inspector"
            expanded={tools.inspecting}
            onClick={() => {
              setDrawerOpen(false);
              tools.openInspector();
            }}
          />
        )}
      </MapToolGroup>
    </>
  );
  // Group commands (map tokens PR 3), shared by the group bar and the map menu (PR 4): each is
  // one authoritative command for the given tokens.
  const groupActions = {
    hide: (tokens: MapToken[], hide: boolean) =>
      void tools.group.act({
        kind: "map-tokens-edit",
        mapId: map.id,
        edits: tokens.map((t) => ({ tokenId: t.id, before: t, token: { ...t, visibility: hide ? "dm" : "party" } })),
      }),
    lock: (tokens: MapToken[], lock: boolean) =>
      void tools.group.act({
        kind: "map-tokens-edit",
        mapId: map.id,
        edits: tokens.map((t) => {
          const token: MapToken = { ...t, locked: lock };
          if (!lock) delete token.locked;
          return { tokenId: t.id, before: t, token };
        }),
      }),
    size: (tokens: MapToken[], size: MapToken["sizeClass"]) =>
      void tools.group.act({
        kind: "map-tokens-edit",
        mapId: map.id,
        edits: tokens.map((t) => ({ tokenId: t.id, before: t, token: resizedToken(t, { sizeClass: size }, map.grid!) })),
      }),
    send: (tokens: MapToken[], targetId: string) => {
      const target = maps.find((m) => m.id === targetId);
      if (!target?.grid) return;
      const plan = planFormation(
        target.grid,
        target.tokens ?? [],
        tokens,
        { column: Math.floor(target.grid.columns / 2), row: Math.floor(target.grid.rows / 2) },
        readTabletopSession(recordTable).partyFormation ?? DEFAULT_FORMATION,
        readMapTabletop(target).walls,
      );
      void tools.group.act(
        {
          kind: "map-tokens-place",
          mapId: target.id,
          grid: target.grid,
          place: plan.places.map((p) => {
            const token = { ...tokens.find((t) => t.id === p.id)!, column: p.column, row: p.row };
            delete token.offsetX;
            delete token.offsetY;
            return { tokenId: p.id, before: target.tokens?.find((t) => t.id === p.id) ?? null, token };
          }),
          remove: tokens.map((t) => ({ mapId: map.id, grid: map.grid!, tokenId: t.id, before: t })),
        },
        () => tools.group.clear(),
      );
    },
    remove: async (tokens: MapToken[]) => {
      const ok = await requestConfirm({
        title: tokens.length === 1 ? `Remove ${tokens[0].label}?` : `Remove ${tokens.length} tokens?`,
        body:
          tokens.length === 1
            ? "The token leaves this map. The character, creature or record it shows is kept."
            : "The tokens leave this map. The characters, creatures and records they show are kept.",
        tone: "danger",
        confirmLabel: tokens.length === 1 ? "Remove token" : "Remove tokens",
      });
      if (!ok || !map.grid) return;
      void tools.group.act(
        { kind: "map-tokens-place", mapId: map.id, grid: map.grid, place: [], remove: tokens.map((t) => ({ mapId: map.id, grid: map.grid!, tokenId: t.id, before: t })) },
        () => tools.group.clear(),
      );
    },
  };
  const sendTargets = maps.filter((m) => m.id !== map.id && m.grid).map((m) => ({ id: m.id, label: m.name }));
  // The map menu (map tokens PR 4; mockup context-menu-desktop): right-click, Shift+F10 or the
  // Menu key. It shows only what this seat can do; every item opens an existing flow or sends one
  // authoritative command (the server checks each one again).
  const { commandBatch } = useEconomy();
  const [mapMenu, setMapMenu] = useState<{
      x: number;
      y: number;
      point: { x: number; y: number };
      tokenIds: string[];
      returnTo?: HTMLElement | null;
      /** Phones' More: the same menu as a bottom sheet, maybe opened at a submenu. */
      sheet?: boolean;
      submenu?: string;
    }>(),
    // The phone's press-and-hold radial (map tokens PR 5): where, on what, and which ring.
    [radial, setRadial] = useState<{
      /** The press point (client pixels); the wheel is centred there, kept inside the map. */
      press: { x: number; y: number };
      point: { x: number; y: number };
      tokenIds: string[];
      /** The finger that opened it is still down (slide-to-select). */
      pointerId?: number;
      hot?: number;
      /** A submenu ring (Move party to, Size, Send to) replaces the main one. */
      ring?: string;
      /** The finger has slid since the wheel opened (a release then picks or closes). */
      slid?: boolean;
      /** Taps count only after this time: the lift that left it open must not tap a slice. */
      tapsFrom?: number;
    }>(),
    [holding, setHolding] = useState<{ x: number; y: number }>(),
    // Map menu quick flows (map tokens PR 6): Add creatures / Add characters at a point, and
    // Start encounter here (this map as the encounter map, the point as the return camera).
    [quickPanel, setQuickPanel] = useState<{ kind: "creatures" | "characters"; point: { x: number; y: number } }>(),
    [encounterHere, setEncounterHere] = useState<{ nonce: string; camera: { x: number; y: number; zoom: number } }>(),
    cloudNow = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable),
    cloudCode = cloudNow.joined ? cloudNow.code : "device",
    [partyMoveOptions, setPartyMoveOptions] = useState<PartyMoveOptions>({ follow: true, placeTokens: true }),
    encounterId = useDm ? mapEncounterId(recordTable, map) : undefined,
    [combatantIds, setCombatantIds] = useState<{ id: string; ids: Set<string> }>();
  // Token follows the player's map view (map tokens PR 7): the DM's setting and the player's own switch.
  const followScope = `${cloudCode}:${seatNow.purseIds.join(",")}`;
  useTokenFollow({ map, maps, table: recordTable, seat: seatNow, scope: followScope, viewOnly: !!cloudNow.viewOnly, proposeJourney: () => openPlanner() });
  const [zonesOpen, setZonesOpen] = useState(false);
  // "Ask the DM" moves waiting on this map (PR 8): dashed ghosts at their destinations.
  const pendingMoveGhosts = (recordTable.journal?.world?.moveRequests ?? []).flatMap((r) => {
    if (r.status !== "pending" || r.mapId !== map.id) return [];
    const token = map.tokens?.find((t) => t.id === r.tokenId);
    if (!token) return [];
    const at: MapToken = { ...token, column: r.after.column, row: r.after.row };
    delete at.offsetX;
    delete at.offsetY;
    if (r.after.offsetX !== undefined) at.offsetX = r.after.offsetX;
    if (r.after.offsetY !== undefined) at.offsetY = r.after.offsetY;
    return [{ token: at, fogged: false, pending: true }];
  });
  const menuTokenCount = (mapMenu ?? radial)?.tokenIds.length ?? 0;
  // "Start encounter here" applies to the panel it opened; the next opening starts plain.
  useEffect(() => {
    if (!combatOpen) setEncounterHere(undefined);
  }, [combatOpen]);
  const closeSidePanels = () => {
    setPartyPanel(false);
    if (tools.group.placing) tools.group.setPlacing(null);
    setCombatOpen(false);
    setDrawerOpen(false);
    setLayersOpen(false);
    setHereOpen(false);
    tools.hideInspector();
  };
  useEffect(() => {
    // While a token menu is open, the tracker says who is already in combat.
    if (!menuTokenCount || !encounterId) return;
    return encounterDetailPoller.subscribe(encounterId, {
      intervalMs: 3000,
      onResult: (row) =>
        setCombatantIds({
          id: encounterId,
          ids: new Set(((row as { body?: { combatants?: { id: string }[] } }).body?.combatants ?? []).map((c) => c.id)),
        }),
      onError: () => undefined,
    });
  }, [menuTokenCount, encounterId]);
  const menuSquare = (point: { x: number; y: number }) => {
    if (!map.grid) return undefined;
    const at = snapTokenPosition(map.grid, {}, point);
    return at ? { column: at.column, row: at.row } : undefined;
  };
  /** The menu's target: the DM's token (or the selection it belongs to), a player's own token, else the point. */
  const menuTargetAt = (clientX: number, clientY: number, tokenId?: string) => {
    let tokenIds: string[] = [];
    const token = tokenId ? map.tokens?.find((t) => t.id === tokenId) : undefined;
    if (token && useDm) {
      tokenIds = tools.selected.includes(token.id) && tools.selected.length > 1 ? tools.selected : [token.id];
      if (!tools.selected.includes(token.id)) tools.menu.selectOnly([token.id]);
    } else if (token?.kind === "character" && token.entityId && seatNow.purseIds.includes(token.entityId))
      tokenIds = [token.id];
    const point = tokenIds.length && token && map.grid ? sceneTokenPoint(map.grid, token) : mapPoint(clientX, clientY);
    return { point, tokenIds };
  };
  const openMapMenu = (
    clientX: number,
    clientY: number,
    tokenId?: string,
    returnTo?: HTMLElement | null,
    sheet = false,
  ) => {
    if (sketches.active || tools.group.placing || planner.active) return;
    setRadial(undefined);
    setMapMenu({ x: clientX, y: clientY, ...menuTargetAt(clientX, clientY, tokenId), returnTo: returnTo ?? root.current, sheet });
  };
  const closeMapMenu = (activated: boolean) => {
    const back = mapMenu?.returnTo;
    setMapMenu(undefined);
    // Focus returns to the map (or the token) unless the action opened something else.
    if (!activated || document.activeElement === document.body) (back?.isConnected ? back : root.current)?.focus({ preventScroll: true });
  };
  const centreOn = (point: { x: number; y: number }) =>
    setView((v) => ({ ...v, x: size.w / 2 - point.x * w * v.scale, y: size.h / 2 - point.y * h * v.scale }));
  const menuTarget = mapMenu ?? radial;
  const menuTokens = (menuTarget?.tokenIds ?? []).flatMap((id) => map.tokens?.find((t) => t.id === id) ?? []);
  const destinations = useDm ? partyDestinations(maps, map) : { submaps: [], connected: [] };
  const moveParty = async (destinationId: string) => {
    const to = maps.find((m) => m.id === destinationId);
    if (!to) return;
    const steps = partyMoveCommands(recordTable, map, to, partyMoveOptions);
    if (!steps.length) {
      selectMap(to.id, partyEntry(map, to));
      return;
    }
    // What will happen, before anything is sent (plan section 3.1).
    const ok = await requestConfirm({
      title: `Move ${groupInfo(recordTable, partyMoveOptions.groupId ?? MAIN_GROUP).name.replace(/^The /, "the ")} to ${to.name}?`,
      body: partyMoveSummary(recordTable, map, to, steps, partyMoveOptions.groupId),
      confirmLabel: "Move party",
    });
    if (!ok) return;
    try {
      const outcome = await commandBatch(crypto.randomUUID(), steps);
      resultToast(mutationNotice(outcome, `The party moved to ${to.name}`));
      selectMap(to.id, partyEntry(map, to));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The party could not be moved. Nothing changed.");
    }
  };
  const actionList = menuTarget
    ? mapActions(
        menuTokens.length ? { kind: "tokens", tokens: menuTokens } : { kind: "map", square: menuSquare(menuTarget.point) },
        {
          dm: useDm,
          grid: !!map.grid,
          selected: tools.selected.length,
          purseIds: seatNow.purseIds,
          canPlaceOwn: !!claimable,
          canPing: !signals.viewOnly,
          encounterId,
          combatants: combatantIds?.id === encounterId ? combatantIds?.ids : undefined,
          mapVisible: map.visible,
          destinations: destinations.submaps.length + destinations.connected.length + sendTargets.length > 0,
        },
      )
    : undefined;
  useEffect(() => {
    if (actionList) setPlaceAnnouncement(actionList.announce);
    // Announced once per opened menu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapMenu, !!radial]);
  const builtMenu = (() => {
    if (!menuTarget || !actionList) return undefined;
    const at = menuTarget.point,
      tokens = menuTokens,
      one = tokens[0];
    const destinationItems = (list: PartyDestination[], submap: boolean) =>
      list.map((d) => ({
        id: `move-party:${d.mapId}`,
        label: d.name,
        icon: submap ? <DoorOpen size={16} /> : <MapIcon size={16} />,
        hint: d.hint,
        run: () => void moveParty(d.mapId),
      }));
    const menu = menuFromActions(
      actionList,
      {
        "start-encounter": () => {
          setEncounterHere({ nonce: crypto.randomUUID(), camera: { x: at.x, y: at.y, zoom: view.scale } });
          centreOn(at);
          openCombat();
        },
        "add-creatures": map.grid ? () => (closeSidePanels(), setQuickPanel({ kind: "creatures", point: at })) : undefined,
        "add-characters": map.grid ? () => (closeSidePanels(), setQuickPanel({ kind: "characters", point: at })) : undefined,
        "place-party": map.grid
          ? () => tools.menu.placeAt({ members: partyMembers(), mode: "formation", label: "party" }, at)
          : undefined,
        "place-selected": () =>
          tools.menu.placeAt(
            { members: tools.group.selectedTokens.map((token) => ({ token, before: token })), mode: "formation", label: "selection" },
            at,
          ),
        "party-position": setup ? () => armSetup("party", at) : undefined,
        "place-record": setup ? () => armSetup("record", at) : undefined,
        marker: setup ? () => armSetup("marker", at) : undefined,
        entrance: setup ? () => armSetup("entrance", at) : undefined,
        ping: () => void signals.send(at, color),
        measure: () => {
          chooseTool("measure");
          tools.menu.measureFrom(at);
        },
        "share-view": () => void tools.shareCamera({ x: at.x, y: at.y, zoom: view.scale }),
        reveal: () => tools.menu.revealAround(at),
        light: () => tools.menu.addLightAt(at),
        "place-mine": claimable ? () => tools.menu.claimAt(claimable.id, at) : undefined,
        "open-tracker": encounterId || one?.encounterId
          ? () => void navigate({ href: `/encounters?encounter=${encodeURIComponent(one?.encounterId ?? encounterId!)}` })
          : undefined,
        "open-sheet": one?.entityId ? () => void navigate({ to: "/characters", search: { id: one.entityId } }) : undefined,
        "my-sheet": one?.entityId ? () => void navigate({ to: "/characters", search: { id: one.entityId } }) : undefined,
        centre: () => centreOn(at),
        "move-to": () =>
          tools.group.startPlacing({ members: tokens.map((token) => ({ token, before: token })), mode: "keep", label: tokens.length === 1 ? one.label : "selection" }),
        hide: () => groupActions.hide(tokens, true),
        show: () => groupActions.hide(tokens, false),
        lock: () => groupActions.lock(tokens, true),
        unlock: () => groupActions.lock(tokens, false),
        "add-initiative": () => void addToInitiative(recordTable, map, tokens, tools.group.act),
        "remove-combat": () => void removeFromInitiative(recordTable, map, tokens),
        controllers: () => (tools.menu.selectOnly([one.id]), tools.openInspector()),
        remove: () => void groupActions.remove(tokens),
      },
      {
        "move-party": {
          groups: [
            ...(destinations.submaps.length ? [{ label: `Submaps of ${map.name}`, items: destinationItems(destinations.submaps, true) }] : []),
            ...(destinations.connected.length ? [{ label: "Connected", items: destinationItems(destinations.connected, false) }] : []),
            // A split party: choose which group moves (plan: "Move Group B to…").
            ...(partySplit(recordTable)
              ? [
                  {
                    label: "Who moves",
                    items: groupRefs(recordTable).map((ref) => ({
                      id: `group:${ref}`,
                      label: groupInfo(recordTable, ref).name,
                      checked: (partyMoveOptions.groupId ?? MAIN_GROUP) === ref,
                      run: () => setPartyMoveOptions((o) => ({ ...o, groupId: ref === MAIN_GROUP ? undefined : ref })),
                      keepOpen: true,
                    })),
                  },
                ]
              : []),
            {
              items: [
                {
                  id: "follow",
                  label: "Players' scene follows",
                  checked: partyMoveOptions.follow,
                  run: () => setPartyMoveOptions((o) => ({ ...o, follow: !o.follow })),
                  keepOpen: true,
                },
                {
                  id: "place-tokens",
                  label: "Place party tokens at the entry",
                  checked: partyMoveOptions.placeTokens,
                  run: () => setPartyMoveOptions((o) => ({ ...o, placeTokens: !o.placeTokens })),
                  keepOpen: true,
                },
              ],
            },
          ],
        },
        size: {
          groups: [
            {
              items: TOKEN_SIZE_CLASSES.map((size) => ({
                id: `size:${size}`,
                label: SIZE_NAMES[size],
                checked: tokens.length > 0 && tokens.every((t) => t.sizeClass === size || (!t.sizeClass && size === "medium" && !t.footprint)),
                run: () => groupActions.size(tokens, size),
              })),
            },
          ],
        },
        "send-to": { groups: [{ items: sendTargets.map((m) => ({ id: `send:${m.id}`, label: m.label, icon: <MapIcon size={16} />, run: () => groupActions.send(tokens, m.id) })) }] },
      },
    );
    return menu;
  })();
  const viewportBox = () => {
    const box = root.current?.getBoundingClientRect();
    return box ? { left: box.left, top: box.top, width: box.width, height: box.height } : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  };
  const menuElement =
    mapMenu && builtMenu ? (
      <MapContextMenu
        key={mapMenu.sheet ? "sheet" : "menu"}
        menu={
          mapMenu.sheet
            ? {
                // The sheet keeps the desktop groups; Table and Reveal share one heading (mockup).
                ...builtMenu,
                groups: builtMenu.groups.flatMap((g, i, all) =>
                  g.label === "Reveal" && all[i - 1]?.label === "Table"
                    ? []
                    : g.label === "Table" && all[i + 1]?.label === "Reveal"
                      ? [{ label: "Table · Reveal", items: [...g.items, ...all[i + 1].items] }]
                      : [g],
                ),
              }
            : builtMenu
        }
        x={mapMenu.x}
        y={mapMenu.y}
        bounds={viewportBox()}
        close={closeMapMenu}
        sheet={mapMenu.sheet}
        initialSubmenu={mapMenu.submenu}
      />
    ) : null;
  // The phone's press-and-hold radial (map tokens PR 5; mockups radial-mobile, radial-mobile-320).
  const tick = () => {
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) navigator.vibrate?.(10);
  };
  const lastTouch = useRef(0),
    pressAt = useRef<{ x: number; y: number; tokenId?: string }>(undefined),
    fireRadial = useRef<(pointerId: number) => void>(() => undefined);
  fireRadial.current = (pointerId) => {
    const at = pressAt.current;
    setHolding(undefined);
    if (!at) return;
    // The hold wins over a drag that never started and over the pan.
    tools.cancel();
    toolPointer.current = undefined;
    pointers.current.clear();
    moved.current = true;
    tick();
    setMapMenu(undefined);
    setRadial({ press: { x: at.x, y: at.y }, ...menuTargetAt(at.x, at.y, at.tokenId), pointerId });
  };
  const press = useRef<ReturnType<typeof longPress>>(undefined);
  press.current ??= longPress((id) => fireRadial.current(id));
  const radialEligible = () =>
    ["pan", "select"].includes(tools.tool) &&
    !placing &&
    !pinging &&
    !sketches.active &&
    !planner.active &&
    !tools.group.placing &&
    !tools.claim.purseId &&
    !radial &&
    !mapMenu;
  const radialView = (() => {
    if (!radial || !builtMenu || !actionList) return undefined;
    const all = builtMenu.groups.flatMap((g) => g.items);
    type Item = RadialItem & { run?: () => void; submenu?: boolean };
    let items: Item[],
      hub: ReactNode,
      hubLabel = "Close map actions",
      ringLabel = "Map actions";
    const parent = radial.ring ? all.find((i) => i.id === radial.ring) : undefined;
    if (parent?.submenu) {
      // A submenu replaces the ring (the desktop submenu's items, without its options), then Back.
      const options = parent.submenu.groups.flatMap((g) => g.items).filter((i) => radial.ring === "size" || i.checked === undefined);
      items = [
        ...options.map((i) => ({
          id: i.id,
          label: radial.ring === "size" ? i.label : shortMapName(i.label),
          pill: [i.label, i.hint, radial.ring === "move-party" && partyMoveOptions.follow ? "players follow" : undefined].filter(Boolean).join(" · "),
          icon: i.icon,
          disabled: i.disabled,
          run: i.run,
        })),
        { id: "back", label: "Back", pill: "Back", icon: <ChevronLeft size={20} /> },
      ];
      hub = (
        <>
          {parent.icon}
          <small>{parent.label}</small>
        </>
      );
      ringLabel = parent.label;
      hubLabel = `Close ${parent.label}`;
    } else {
      const slices = radialSlices(actionList, {
        dm: useDm,
        tokens: menuTokens.length > 0,
        purseIds: seatNow.purseIds,
        pills: {
          "place-party": `${(readTabletopSession(recordTable).partyFormation ?? DEFAULT_FORMATION).shape}, ${partyRows.filter((r) => r.checked).length} tokens`,
          ...(claimable ? { "place-mine": claimable.name } : {}),
        },
      });
      items = slices.map((slice) => {
        const item = all.find((i) => i.id === slice.id);
        const run =
          slice.id === "my-sheet" && !item
            ? () => void navigate({ to: "/characters", search: { id: seatNow.purseIds[0] } })
            : item?.run;
        return {
          ...slice,
          icon: slice.id === "more" ? <Ellipsis size={20} /> : MAP_ACTION_ICONS[slice.id],
          disabled: slice.id === "more" ? false : slice.disabled || (!slice.submenu && !run) || (slice.submenu && item?.disabled),
          run,
        };
      });
      hub = menuTokens.length ? (
        <>
          <b>{actionList.title}</b>
          <small>{actionList.subtitle.split(" · ")[0]}</small>
        </>
      ) : (
        <>
          <X size={20} />
          <small>{actionList.subtitle}</small>
        </>
      );
    }
    const geometry = radialGeometry(radial.press, items.length, viewportBox(), {
      player: !useDm,
      moreLast: !radial.ring && items.at(-1)?.id === "more",
    });
    return { items, hub, hubLabel, ringLabel, geometry };
  })();
  const closeRadial = () => {
    setRadial(undefined);
    root.current?.focus({ preventScroll: true });
  };
  const pickRadial = (index: number) => {
    const view = radialView,
      item = view?.items[index];
    if (!radial || !view || !item || item.disabled) return;
    if (item.id === "more") {
      setRadial(undefined);
      setMapMenu({ x: radial.press.x, y: radial.press.y, point: radial.point, tokenIds: radial.tokenIds, returnTo: root.current, sheet: true });
      return;
    }
    if (item.id === "back") {
      setRadial({ ...radial, ring: undefined, hot: undefined, pointerId: undefined });
      return;
    }
    if (item.submenu) {
      const count = builtMenu?.groups.flatMap((g) => g.items).find((i) => i.id === item.id)?.submenu?.groups.flatMap((g) => g.items).length ?? 0;
      // Up to seven choices fit a ring (with Back); more open in the sheet.
      if (count > 7) {
        setRadial(undefined);
        setMapMenu({ x: radial.press.x, y: radial.press.y, point: radial.point, tokenIds: radial.tokenIds, returnTo: root.current, sheet: true, submenu: item.id });
      } else setRadial({ ...radial, ring: item.id, hot: 0, pointerId: undefined });
      return;
    }
    setRadial(undefined);
    item.run?.();
  };
  /** Pointer handling for the radial: true when the event belonged to it. */
  const radialPointer = {
    down(e: React.PointerEvent) {
      if (e.pointerType === "mouse") return;
      lastTouch.current = Date.now();
      const eligible = radialEligible() && (e.pointerType === "touch" || e.pointerType === "pen");
      if (eligible && !press.current!.pending)
        pressAt.current = {
          x: e.clientX,
          y: e.clientY,
          tokenId: (e.target as Element).closest<HTMLElement>("[data-map-token]")?.dataset.mapToken,
        };
      press.current!.down(e.pointerId, e.clientX, e.clientY, eligible);
      setHolding(press.current!.pending ? { x: e.clientX, y: e.clientY } : undefined);
    },
    move(e: React.PointerEvent) {
      if (radial && radialView && radial.pointerId === e.pointerId) {
        const hit = radialHit(radialView.geometry, e.clientX, e.clientY);
        const hot = typeof hit === "number" && !radialView.items[hit]?.disabled ? hit : undefined;
        const slid = radial.slid || Math.hypot(e.clientX - radial.press.x, e.clientY - radial.press.y) > RADIAL_SLOP_PX;
        if (hot !== radial.hot || slid !== radial.slid) {
          // Until the finger slides, the wheel (moved inward near an edge) highlights nothing.
          setRadial({ ...radial, hot: slid ? hot : undefined, slid });
          if (slid && hot !== undefined && hot !== radial.hot) tick();
        }
        return true;
      }
      press.current!.move(e.pointerId, e.clientX, e.clientY);
      if (holding && !press.current!.pending) setHolding(undefined);
      return false;
    },
    up(e: React.PointerEvent) {
      press.current!.up(e.pointerId);
      if (holding) setHolding(undefined);
      if (radial && radialView && radial.pointerId === e.pointerId) {
        pointers.current.delete(e.pointerId);
        const hit = radialHit(radialView.geometry, e.clientX, e.clientY);
        // Slide-to-select releases on a slice; lifting without sliding or in the centre keeps it
        // open for a tap; sliding off the wheel and releasing closes it.
        if (radial.slid && typeof hit === "number") pickRadial(hit);
        else if (radial.slid && hit === "outside") closeRadial();
        else setRadial({ ...radial, pointerId: undefined, hot: undefined, slid: false, tapsFrom: Date.now() + 300 });
        return true;
      }
      return false;
    },
    cancel(e: React.PointerEvent) {
      press.current!.cancel();
      setHolding(undefined);
      if (radial?.pointerId === e.pointerId) setRadial({ ...radial, pointerId: undefined, hot: undefined });
    },
  };
  const radialElement =
    radial && radialView ? (
      <MapRadial
        geometry={radialView.geometry}
        items={radialView.items}
        hub={radialView.hub}
        hubLabel={radialView.hubLabel}
        label={radialView.ringLabel}
        hot={radial.hot}
        pill={radial.hot !== undefined ? radialView.items[radial.hot]?.pill : undefined}
        pick={pickRadial}
        close={closeRadial}
        tapsFrom={radial.tapsFrom}
      />
    ) : holding ? (
      <RadialProgress x={holding.x} y={holding.y} />
    ) : null;
  return (
    <MapFrame title={map.name} interfaceHidden={interfaceHidden}>
      <MapWorkspaceChrome
        map={map}
        maps={maps}
        navigation={navigation}
        results={searchResults}
        selectResult={(result) => {
          afterContextChange(() => {
            if (result.mapId === map.id) {
              if (result.record) focusRecord(result.record);
            } else
              selectMap(
                result.mapId,
                result.record?.point ? { ...result.record.point, zoom: 1.5 } : undefined,
              );
          });
        }}
        compactSearch={!!setup}
        subtitle={
          (useDm ? combatOnMap(recordTable, map.id) : movement.combat)
            ? "Combat"
            : readMarketLocations(recordTable.journal?.market).locations.find((l) => l.id === map?.locationId)?.name
        }
        settingsOpen={drawerOpen}
        toggleSettings={openSettings}
        parent={parentMap}
        onBack={goParent && (() => afterContextChange(goParent))}
        closePanel={() => {
          if (drawerOpen) setDrawerOpen(false);
          else if (setupOpen) closeSetupPanel();
          else if (layersOpen) setLayersOpen(false);
          else if (initiativeOpen) setInitiativeOpen(false);
          else if (questsOpen) setQuestsOpen(false);
          else if (moreTools) setMoreTools(false);
          else if (service || details.length || combatOpen || tools.inspecting || hereOpen) {
            const closeAll = () => {
              setHereOpen(false);
              setService(undefined);
              setDetails([]);
              setCombatOpen(false);
              tools.hideInspector();
            };
            if (allowContextChange(closeAll)) closeAll();
          } else if (planner.active) planner.close();
          else return false;
          return true;
        }}
        hidden={interfaceHidden}
        setHidden={(hidden) => {
          afterContextChange(() => setInterfaceHidden(hidden));
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
          <strong className="map-settings-title">All map settings</strong>
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
        <input
          type="search"
          className="map-settings-search"
          aria-label="Search settings"
          placeholder="Search settings"
          value={settingsQuery}
          onChange={(e) => setSettingsQuery(e.target.value)}
        />
        <nav className="map-settings-index" aria-label="Settings groups">
          {settingsGroups.map(([id, title]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setSettingsQuery("");
                showSettingsGroup(id);
              }}
            >
              {title}
            </button>
          ))}
        </nav>
        <div ref={settingsGroupsRef} className="map-settings-groups">
          <SettingsGroup id="this-map" title="This map">
            {setupSettings.thisMap}
            {useDm && (
              <div className="world-toolbar map-controls">
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
              </div>
            )}
            {controls.connected}
          </SettingsGroup>
          <SettingsGroup id="places" title="Places & party">
            {setupSettings.places}
            {useDm && (
              <button type="button" className="settings-link" onClick={() => setZonesOpen(true)}>
                Zones… (maps that count as one place)
              </button>
            )}
            {records.length > 0 && (
              <section className="map-places-list" aria-label="Places on this map">
                <h3>Places on this map</h3>
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
              </section>
            )}
          </SettingsGroup>
          <SettingsGroup id="players" title="Players & display">
            {useDm && <MovementNotice map={map} />}
            {useDm && <SplitRuleSetting table={recordTable} />}
            <FollowViewSettings
              table={recordTable}
              dm={useDm}
              scope={followScope}
              character={recordTable.purses.find((p) => p.kind === "character" && seatNow.purseIds.includes(p.id))?.name}
            />
            {setupSettings.players}
            <div className="map-tile-control-area">{controls.session}</div>
            {tools.sceneControls}
            {useDm && tools.showPreview && <MapPlayerPreview map={map} />}
          </SettingsGroup>
          {useDm && (
            <SettingsGroup id="exploration" title="Exploration">
              {tools.explorationControls}
              <button className="settings-link" onClick={() => tools.openInspector()}>
                Open inspector and object controls
              </button>
            </SettingsGroup>
          )}
          <SettingsGroup id="combat" title="Combat">
            <div className="map-tile-control-area">{controls.combat}</div>
            {!map.grid && <p className="text-sm text-muted">This map has no combat grid.</p>}
          </SettingsGroup>
          <SettingsGroup id="view" title="View">
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
                      {c[0].toUpperCase() + c.slice(1)} ({pingShapes[c]})
                    </option>
                  ))}
                </select>
              </label>
              <label className="map-check-row">
                <input
                  type="checkbox"
                  checked={toolNames !== "hidden"}
                  onChange={(e) => setToolNames(e.target.checked ? "shown" : "hidden")}
                />
                Show tool names (desktop)
              </label>
              {quests?.layers && (
                <>
                  <label className="map-check-row">
                    <input
                      type="checkbox"
                      checked={quests.layers.markers}
                      onChange={(e) => quests.layers!.setMarkers(e.target.checked)}
                    />
                    Quest markers
                  </label>
                  <label className="map-check-row">
                    <input
                      type="checkbox"
                      checked={quests.layers.areas}
                      onChange={(e) => quests.layers!.setAreas(e.target.checked)}
                    />
                    Quest areas (circles)
                  </label>
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
            {pinging && (
              <p className="text-sm text-muted">
                Keyboard: pan to a point, then press Enter to ping the center crosshair. Escape
                turns ping mode off.
              </p>
            )}
          </SettingsGroup>
          <SettingsGroup id="shortcuts" title="Shortcuts & help">
            <p className="text-sm text-muted">
              Drag to pan. Pinch or use the scroll wheel to zoom. Keyboard: arrows, +, − and Home.
              Markers update through the shared campaign.
            </p>
            <dl className="map-shortcut-list">
              {[
                ...MAP_SHORTCUTS,
                ...(quests ? ([["Q", "Quests", false]] as [string, string, boolean][]) : []),
              ]
                .filter(([, , dmOnly]) => useDm || !dmOnly)
                .map(([keys, action]) => (
                  <div key={keys}>
                    <dt>
                      <kbd>{keys}</kbd>
                    </dt>
                    <dd>{action}</dd>
                  </div>
                ))}
            </dl>
          </SettingsGroup>
          {settingsQuery && (
            <p className="map-settings-empty text-sm text-muted" role="status">
              {settingsMatches === 0
                ? "No settings match. Try another word."
                : `${settingsMatches} ${settingsMatches === 1 ? "group matches" : "groups match"}.`}
            </p>
          )}
        </div>
      </div>
      {!interfaceHidden && (
        <>
          <div
            className="map-hotbar-anchor"
            data-layout={layout}
            data-tool-names={railNames ? "" : undefined}
          >
            {hotbarOpen && (
              <MapToolbar
                className="map-hotbar map-glass"
                label="Map tools"
                orientation={rail ? "vertical" : "horizontal"}
              >
                <div className="map-hotbar-tools">
                  <MapToolGroup caption="Move">
                    <MapTool
                      icon={<Hand size={19} />}
                      label="Pan"
                      shortcut="V"
                      keys="V"
                      pressed={tools.tool === "pan" && !pinging && !placing && !sketches.active}
                      onClick={() => chooseTool("pan")}
                    />
                    <MapTool
                      icon={<MousePointer2 size={19} />}
                      label="Select / move"
                      shortcut="S"
                      keys="S"
                      pressed={tools.tool === "select" && !pinging && !placing && !sketches.active}
                      onClick={() => chooseTool("select")}
                    />
                  </MapToolGroup>
                  <MapToolGroup caption="Play">
                    <MapTool
                      icon={<Crosshair size={19} />}
                      label="Ping"
                      shortcut="P"
                      keys="P"
                      disabled={signals.viewOnly}
                      pressed={pinging}
                      onClick={togglePing}
                    />
                    <MapTool
                      icon={<Ruler size={19} />}
                      label="Measure"
                      shortcut="M"
                      keys="M"
                      pressed={tools.tool === "measure"}
                      onClick={() => chooseTool("measure")}
                    />
                    {tools.playerTemplates && (
                      <MapTool
                        icon={<Shapes size={19} />}
                        label="Area template"
                        shortcut="T"
                        keys="T"
                        pressed={tools.tool === "template"}
                        onClick={() => chooseTool("template")}
                      />
                    )}
                    <MapTool
                      icon={<Pencil size={19} />}
                      label="Draw & notes"
                      shortcut="D"
                      keys="D"
                      pressed={sketches.active}
                      onClick={openDraw}
                    />
                    {/* One entry for the journey planner (the floating pill is gone, D6). */}
                    <MapTool
                      icon={<RouteIcon size={19} />}
                      label="Plan journey"
                      shortcut="J"
                      keys="J"
                      pressed={planner.active}
                      onClick={openPlanner}
                    />
                  </MapToolGroup>
                  {layout === "short" ? (
                    // Below 720 px tall the lower groups fold into More at the rail foot (D14).
                    <MapTool
                      icon={<ChevronsDown size={19} />}
                      label="More tools"
                      expanded={railMore}
                      controls="map-rail-overflow"
                      onClick={() => setRailMore(!railMore)}
                    />
                  ) : (
                    lowerGroups
                  )}
                </div>
              </MapToolbar>
            )}
            {hotbarOpen && layout === "short" && railMore && (
              <div id="map-rail-overflow" className="map-rail-overflow">
                <MapToolbar
                  className="map-hotbar map-glass"
                  label="More tools"
                  orientation="vertical"
                >
                  <div className="map-hotbar-tools">{lowerGroups}</div>
                </MapToolbar>
              </div>
            )}
            <button
              className="map-hotbar-toggle map-glass map-icon-button"
              aria-label="Map tools hotbar"
              aria-expanded={hotbarOpen}
              title={hotbarOpen ? "Collapse map tools" : "Show map tools"}
              onClick={() => setHotbarOpen(!hotbarOpen)}
            >
              {hotbarOpen ? (
                rail ? (
                  <ChevronRight size={20} />
                ) : (
                  <ChevronDown size={20} />
                )
              ) : (
                <Pencil size={20} />
              )}
            </button>
          </div>
          {railNames && <ToolNamesHint />}
          {setup && (
            <div
              className="map-hotbar-anchor map-setup-anchor"
              data-layout={layout}
              data-tool-names={railNames ? "" : undefined}
            >
              <MapToolbar
                className="map-hotbar map-setup-bar map-glass"
                label="Map setup"
                orientation={rail ? "vertical" : "horizontal"}
              >
                <div className="map-hotbar-tools">
                  <MapToolGroup caption="Place">
                    {SETUP_TOOLS.slice(0, 5).map(setupButton)}
                  </MapToolGroup>
                  <MapToolGroup caption="Reveal">
                    {REVEAL_TOOLS.map(({ tool, label, shortcut, Icon }) => (
                      <MapTool
                        key={tool}
                        icon={<Icon size={19} />}
                        label={label}
                        shortcut={shortcut && `⇧${shortcut}`}
                        keys={shortcut && `Shift+${shortcut}`}
                        pressed={tools.tool === tool}
                        onClick={() => chooseTool(tool)}
                      />
                    ))}
                  </MapToolGroup>
                  <MapToolGroup caption="Combat">
                    {SETUP_TOOLS.slice(5).map(setupButton)}
                    {map.grid && (
                      <MapTool
                        icon={<Users size={19} />}
                        label="Place party"
                        shortcut="⇧A"
                        keys="Shift+A"
                        expanded={partyPanel}
                        onClick={() => (partyPanel ? closePlaceParty() : openPlaceParty())}
                      />
                    )}
                  </MapToolGroup>
                  <MapToolGroup caption="Objects">
                    <MapTool
                      icon={<List size={19} />}
                      label="Objects & inspector"
                      shortcut="⇧O"
                      keys="Shift+O"
                      expanded={tools.inspecting}
                      onClick={openObjects}
                    />
                  </MapToolGroup>
                </div>
              </MapToolbar>
            </div>
          )}
          {setup?.tool && setup.panel && (
            <aside
              ref={setupPanelRef}
              className="map-side-panel map-setup-panel map-glass"
              role="dialog"
              aria-modal="false"
              aria-labelledby="map-setup-heading"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  closeSetupPanel();
                }
              }}
            >
              <div className="map-panel-heading">
                <strong id="map-setup-heading">{setupName(setup.tool)}</strong>
                <button
                  className="map-icon-button"
                  aria-label={`Close ${setupName(setup.tool)} panel`}
                  onClick={closeSetupPanel}
                >
                  <X size={16} />
                </button>
              </div>
              <button
                type="button"
                className="settings-link map-settings-jump"
                onClick={() =>
                  showSettingsGroup(
                    setup.tool === "record" || setup.tool === "entrance" || setup.tool === "grid"
                      ? "this-map"
                      : setup.tool === "token"
                        ? "combat"
                        : "places",
                  )
                }
              >
                Related settings →
              </button>
              <p className="map-setup-note">
                Click the map again to move the pin. Saving keeps the tool ready for the next one;
                Esc twice returns to Pan.
              </p>
              {setup.panel}
            </aside>
          )}
          {entryPick && (
            <section className="map-entry-pick map-glass" aria-label="Pick the entry view">
              <p>
                <strong>Entry view for {entryPick.label || "the entrance"}</strong>
                Pan and zoom to what arriving players should see, then use this view.
              </p>
              <div>
                <Button onClick={() => entryPick.use(currentCamera())}>Use this view</Button>
                <Button onClick={entryPick.cancel}>Cancel</Button>
              </div>
            </section>
          )}
          {quests && questsOpen && !drawerOpen && (
            <aside
              id="map-quests"
              className="map-side-panel map-quests-panel map-glass"
              role="dialog"
              aria-modal="false"
              aria-labelledby="map-quests-heading"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setQuestsOpen(false);
                  root.current?.focus();
                }
              }}
            >
              <div className="map-panel-heading">
                <strong id="map-quests-heading">Quests</strong>
                <button
                  className="map-icon-button"
                  aria-label="Close quests"
                  onClick={() => {
                    setQuestsOpen(false);
                    root.current?.focus();
                  }}
                >
                  <X size={16} />
                </button>
              </div>
              {quests.panel}
            </aside>
          )}
          {initiativeOpen && !drawerOpen && !combatOpen && (
            <MapInitiativePanel
              map={map}
              dm={useDm}
              binding={useDm ? (recordTable.journal?.world?.combat ?? undefined) : undefined}
              openControls={() => {
                setInitiativeOpen(false);
                openCombat();
              }}
              close={() => {
                setInitiativeOpen(false);
                root.current?.focus();
              }}
            />
          )}
          {layersOpen && !drawerOpen && (
            <aside
              id="map-layers"
              className="map-side-panel map-layers-panel map-glass"
              role="dialog"
              aria-modal="false"
              aria-labelledby="map-layers-heading"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setLayersOpen(false);
                  root.current?.focus();
                }
              }}
            >
              <div className="map-panel-heading">
                <strong id="map-layers-heading">Layers</strong>
                <button
                  className="map-icon-button"
                  aria-label="Close layers"
                  onClick={() => {
                    setLayersOpen(false);
                    root.current?.focus();
                  }}
                >
                  <X size={16} />
                </button>
              </div>
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
              {quests?.layers && (
                <fieldset className="map-filters">
                  <legend>Quests</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={quests.layers.markers}
                      onChange={(e) => quests.layers!.setMarkers(e.target.checked)}
                    />
                    Quest markers
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={quests.layers.areas}
                      onChange={(e) => quests.layers!.setAreas(e.target.checked)}
                    />
                    Quest areas (circles)
                  </label>
                </fieldset>
              )}
              <button
                type="button"
                className="settings-link map-settings-jump"
                onClick={() => {
                  setLayersOpen(false);
                  showSettingsGroup("view");
                }}
              >
                More in Settings › View →
              </button>
              {map.grid && (
                <button
                  className="map-layer-toggle"
                  title={gridLocked ? "Encounter controls the grid" : "Grid display"}
                  aria-label="Grid display"
                  aria-pressed={tileMode && (gridLocked || gridVisible)}
                  disabled={gridLocked}
                  onClick={() => {
                    if (!tileMode) toggleGrid();
                    setGridVisible(tileMode ? !gridVisible : true);
                  }}
                >
                  <Grid3X3 size={18} aria-hidden="true" />
                  Grid display
                  <span>{tileMode && (gridLocked || gridVisible) ? "On" : "Off"}</span>
                </button>
              )}
              {map.grid && useDm && (
                // Grid mode (map tokens 1b): the shared snap setting, for everyone at the table.
                <button
                  className="map-layer-toggle"
                  aria-label="Grid mode"
                  aria-pressed={tools.gridMode.on}
                  disabled={tools.busy}
                  onClick={() => tools.gridMode.set(!tools.gridMode.on)}
                >
                  <Grid3X3 size={18} aria-hidden="true" />
                  Grid mode
                  <span>{tools.gridMode.on ? "On" : "Off"}</span>
                </button>
              )}
            </aside>
          )}
          {tools.gridMode.dialog}
          {quickPanel?.kind === "creatures" && useDm && (
            <AddCreaturesPanel
              map={map}
              table={recordTable}
              code={cloudCode}
              point={quickPanel.point}
              act={tools.group.act}
              close={() => (setQuickPanel(undefined), root.current?.focus({ preventScroll: true }))}
            />
          )}
          {quickPanel?.kind === "characters" && useDm && (
            <AddCharactersPanel
              rows={recordTable.purses
                .filter((p) => p.kind === "character")
                .map((p) => {
                  const ref = groupRefs(recordTable).find((g) => groupMembers(recordTable, g).some((m) => m.id === p.id));
                  return {
                    purseId: p.id,
                    name: p.name,
                    status: map.tokens?.some((t) => t.kind === "character" && t.entityId === p.id)
                      ? "on map · will move"
                      : ref
                        ? groupInfo(recordTable, ref).name
                        : "not in the party",
                  };
                })}
              place={(ids) => {
                const point = quickPanel.point;
                setQuickPanel(undefined);
                tools.menu.placeAt(
                  {
                    members: membersFor(ids.map((id) => ({ purseId: id, name: recordTable.purses.find((p) => p.id === id)?.name ?? id }))),
                    mode: "formation",
                    label: "characters",
                  },
                  point,
                );
              }}
              close={() => (setQuickPanel(undefined), root.current?.focus({ preventScroll: true }))}
            />
          )}
          {partyPanel && tools.group.placing && (
            <PlacePartyPanel
              rows={partyRows}
              toggle={(purseId) =>
                setPartyChecks((checks) => ({
                  ...checks,
                  [purseId]: !(partyRows.find((r) => r.purseId === purseId)?.checked ?? false),
                }))
              }
              formation={tools.group.placing.formation}
              setFormation={(formation) =>
                tools.group.setPlacing((current) => (current ? { ...current, formation } : current))
              }
              makeDefault={makeDefault}
              setMakeDefault={setMakeDefault}
              close={closePlaceParty}
            />
          )}
          {tools.group.placing && (
            <PlacingHint
              count={tools.group.placing.members.length}
              at={tools.group.plan?.places[0] && tools.group.anchor ? {
                column: Math.min(...tools.group.plan.places.map((p) => p.column)),
                row: Math.min(...tools.group.plan.places.map((p) => p.row)),
              } : undefined}
              shape={tools.group.placing.mode === "keep" ? "same shape" : tools.group.placing.formation.shape}
              displaced={tools.group.plan?.displaced ?? 0}
              unplaced={tools.group.plan?.unplaced ?? 0}
            />
          )}
          {useDm &&
            map.grid &&
            !partyPanel &&
            (tools.group.selectedTokens.length >= 2 ||
              (layout === "phone" && tools.group.selectedTokens.length >= 1) ||
              tools.group.selectMode) && (
              <GroupBar
                tokens={tools.group.selectedTokens}
                placing={!!tools.group.placing}
                busy={tools.busy}
                phone={layout === "phone"}
                raised={layout === "phone" && tools.inspecting}
                selectMode={tools.group.selectMode}
                setSelectMode={tools.group.setSelectMode}
                movement={movement.mode}
                maps={sendTargets}
                onPlace={() =>
                  tools.group.startPlacing({
                    members: tools.group.selectedTokens.map((token) => ({ token, before: token })),
                    mode: "formation",
                    label: "selection",
                  })
                }
                onMove={() =>
                  tools.group.startPlacing({
                    members: tools.group.selectedTokens.map((token) => ({ token, before: token })),
                    mode: "keep",
                    label: "selection",
                  })
                }
                onHide={(hide) => groupActions.hide(tools.group.selectedTokens, hide)}
                onLock={(lock) => groupActions.lock(tools.group.selectedTokens, lock)}
                onSize={(size) => groupActions.size(tools.group.selectedTokens, size)}
                onSend={(targetId) => groupActions.send(tools.group.selectedTokens, targetId)}
                onMovement={(mode) =>
                  void tools.group.act({
                    kind: "map-tabletop",
                    mapId: map.id,
                    before: map.tabletop ?? null,
                    settings: { ...readMapTabletop(map), movement: mode, playerMovement: mode !== "off" },
                  })
                }
                onInitiative={() => void addToInitiative(recordTable, map, tools.group.selectedTokens, tools.group.act)}
                onClear={tools.group.clear}
              />
            )}
          {contextOpen && !drawerOpen && (
            <aside
              className={`map-tool-context map-glass${revealTool ? " map-tool-context-setup" : ""}`}
              aria-label="Tool options"
            >
              <div className="map-panel-heading">
                <strong>
                  {sketches.active ? "Draw & notes" : pinging ? "Ping" : tools.toolLabel}
                </strong>
                <button
                  className="map-icon-button"
                  aria-label="Close tool options"
                  onClick={() => setContextOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
              {sketches.active ? (
                sketches.controls
              ) : pinging ? (
                <label className="map-ping-options">
                  Ping colour
                  <select
                    aria-label="Ping color for this tool"
                    value={color}
                    onChange={(e) => setColor(e.target.value as MapPingInput["color"])}
                  >
                    {pingColors.map((c) => (
                      <option key={c} value={c}>
                        {c[0].toUpperCase() + c.slice(1)} ({pingShapes[c]})
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  {tools.contextControls}
                  {revealTool?.startsWith("fog-") && tools.fogActions}
                  {revealTool === "wall" && (
                    <section aria-label="Walls and doors on this map">
                      <h3>Walls & doors on this map</h3>
                      {tools.wallsList}
                    </section>
                  )}
                  {revealTool === "light" && (
                    <section aria-label="Lights on this map">
                      <h3>Lights on this map</h3>
                      {tools.lightsList}
                    </section>
                  )}
                </>
              )}
              <button
                onClick={() => {
                  afterContextChange(() => {
                    tools.cancel();
                    sketches.cancel();
                    setPinging(false);
                    setContextOpen(false);
                  });
                }}
              >
                Cancel tool
              </button>
            </aside>
          )}
          <div className="world-toolbar map-navigation map-glass" aria-label="Map navigation">
            {/* Plain icon buttons on map tokens in every look (not filled primary buttons). */}
            <button
              className="map-icon-button"
              onClick={() => zoom(1.4, size.w / 2, size.h / 2)}
              aria-label="Zoom in"
              title="Zoom in (+)"
            >
              <Plus size={18} aria-hidden="true" />
            </button>
            <button
              className="map-icon-button"
              onClick={() => zoom(1 / 1.4, size.w / 2, size.h / 2)}
              aria-label="Zoom out"
              title="Zoom out (−)"
            >
              <Minus size={18} aria-hidden="true" />
            </button>
            <button
              className="map-icon-button"
              onClick={fit}
              aria-label="Fit map"
              title="Fit map (Home)"
            >
              <Maximize size={18} aria-hidden="true" />
            </button>
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
      {!interfaceHidden &&
        (!useDm && movement.combat && turnOrder ? (
          <MapTurnStrip map={map} movement={movement} order={turnOrder} />
        ) : (
          <MapCombatHud map={map} />
        ))}
      <MapAnnouncer map={map} pings={signals.pings} />
      {menuElement}
      {!useDm && <MapZoneRequests table={recordTable} seat={seatNow} />}
      {zonesOpen && useDm && <ZonesEditor table={recordTable} open={zonesOpen} onOpenChange={setZonesOpen} initialZone={zoneOf(recordTable, map.id)} />}
      {radialElement}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {placeAnnouncement}
      </p>
      {!interfaceHidden && placeBar}
      {!interfaceHidden && !reviewJourney && planner.panel}
      {!interfaceHidden && reviewJourney && (
        <JourneyReview
          table={recordTable}
          journeyId={reviewJourney}
          close={() => setReviewJourney(undefined)}
        />
      )}
      {!interfaceHidden && !reviewJourney && !planner.active && journeyView.panel}
      {!interfaceHidden && !placeBar && !reviewJourney && journeyView.chip}
      {journeyView.arrival}
      <div className="map-feedback" hidden={interfaceHidden}>
        <MapRenderBadge />
        {full && (
          <p className="map-active-tool" role="status">
            {setup?.tool
              ? PANEL_FIRST.includes(setup.tool)
                ? setupName(setup.tool)
                : `${setupName(setup.tool)}: ${point ? "fill in its panel, or click the map to move the pin" : "click the map to place it"}`
              : pinging
                ? `Ping · ${color} ${pingShapes[color]}`
                : sketches.active
                  ? "Personal annotations"
                  : tools.toolLabel}
            {tools.measurement && ` · ${tools.measurement}`}
          </p>
        )}
        {!useDm && tileMode && map.grid && (
          <>
            {movement.mode === "approval" && (
              <MoveRequestChips map={map} requests={recordTable.journal?.world?.moveRequests ?? []} />
            )}
            <MovementChips
              movement={movement}
              speed={speedFeet}
              hasToken={!!ownToken}
              fog={readMapTabletop(map).fog.enabled || readMapTabletop(map).vision !== "off"}
            />
            {claimable &&
              (tools.claim.purseId ? (
                <p role="status" className="map-claim-bar">
                  Tap a square to place {claimable.name}.{" "}
                  <button type="button" onClick={tools.claim.cancel}>
                    Cancel
                  </button>
                </p>
              ) : (
                <button
                  type="button"
                  className="map-move-chip lead map-claim-chip"
                  onClick={() => tools.claim.start(claimable.id)}
                >
                  Place my token
                </button>
              ))}
          </>
        )}
        {tools.feedback}
        {pinging && (
          <p role="status">
            Tap the map to ping in {color} ({pingShapes[color]}).{" "}
            {signals.joined
              ? "Everyone viewing this map in the room will see it for five seconds."
              : "Offline preview; join a room to share pings."}
          </p>
        )}
        {signals.viewOnly && <p className="text-sm text-muted">Resume play to share map pings.</p>}
        {notice && (
          <p role="status" className="map-place-notice">
            {notice}{" "}
            {dismissNotice && (
              <button type="button" onClick={dismissNotice}>
                Dismiss
              </button>
            )}
          </p>
        )}
        {signals.error && <p role="alert">{signals.error}</p>}
      </div>
      <div className={`tabletop-workspace ${tools.panel ? "has-inspector" : ""}`}>
        <div className="tabletop-surface">
          <div
            ref={root}
            className={`map-viewport ${placing || pinging ? "placing" : ""}${radial ? " radial-open" : ""}`}
            role="region"
            aria-label="Interactive campaign map"
            aria-keyshortcuts="Shift+F10 ContextMenu"
            tabIndex={0}
            onContextMenu={(e) => {
              // The map's own menu replaces the browser's inside the map (map tokens PR 4).
              e.preventDefault();
              // A long press on a phone fires contextmenu too: the radial handles touch.
              if (Date.now() - lastTouch.current < 1500 || radial) return;
              const token = (e.target as Element).closest<HTMLElement>("[data-map-token]");
              openMapMenu(e.clientX, e.clientY, token?.dataset.mapToken, token);
            }}
            onKeyDown={(e) => {
              if (fogHistoryKey(e)) return;
              if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
                // At the focused token, else the keyboard crosshair (the view centre).
                e.preventDefault();
                const token = (e.target as Element).closest<HTMLElement>("[data-map-token]");
                const box = (token ?? root.current!).getBoundingClientRect();
                openMapMenu(box.left + box.width / 2, box.top + box.height / 2, token?.dataset.mapToken, token ?? root.current);
                return;
              }
              if (!e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && setupShortcut(e.key)) {
                e.preventDefault();
                return;
              }
              if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
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
                  togglePing();
                  return;
                }
                if (!e.shiftKey && panelShortcut(e.key)) {
                  e.preventDefault();
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
              if (planner.active && !planner.calibrating && !pinging && !placing) {
                if (e.key === "Enter") {
                  e.preventDefault();
                  planner.addAt({
                    x: Math.max(0, Math.min(1, (size.w / 2 - view.x) / (w * view.scale))),
                    y: Math.max(0, Math.min(1, (size.h / 2 - view.y) / (h * view.scale))),
                  });
                  return;
                }
                if (e.key === "Backspace") {
                  e.preventDefault();
                  planner.removeLast();
                  return;
                }
              }
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
              radialPointer.down(e);
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
              if (radialPointer.move(e)) return;
              if (tools.group.placing && toolPointer.current !== e.pointerId)
                tools.group.hover(mapPoint(e.clientX, e.clientY));
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
              if (radialPointer.up(e)) return;
              if (toolPointer.current === e.pointerId) {
                if (sketches.active) sketches.up(mapPoint(e.clientX, e.clientY));
                else tools.pointerUp(mapPoint(e.clientX, e.clientY));
                toolPointer.current = undefined;
                return;
              }
              if (
                planner.active &&
                !placing &&
                !pinging &&
                !(e.target as Element).closest("button") &&
                !moved.current &&
                pointers.current.has(e.pointerId) &&
                pointers.current.size === 1
              ) {
                const r = e.currentTarget.getBoundingClientRect();
                planner.tap(e.clientX, e.clientY, { x: e.clientX - r.left, y: e.clientY - r.top });
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
              radialPointer.cancel(e);
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
              {journeyView.overlay}
              {planner.overlay}
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
              {quests?.areas && quests.areas.length > 0 && (quests.layers?.areas ?? true) && (
                <svg
                  className="map-quest-areas"
                  width={w}
                  height={h}
                  viewBox={`0 0 ${w} ${h}`}
                  aria-hidden="true"
                >
                  {quests.areas.map((a) => {
                    const live = questDrag?.key === a.key ? questDrag : a;
                    return (
                      <circle
                        key={a.key}
                        className={a.highlighted ? "highlighted" : undefined}
                        cx={live.x * w}
                        cy={live.y * h}
                        r={Math.max(2, live.r * w)}
                      />
                    );
                  })}
                </svg>
              )}
              {/* Grid mode (map tokens 1b): lines are drawn while grid mode is on, unless the
                  map's automatic grid is hidden; an encounter's grid presentation always shows them. */}
              {tileMode &&
                (gridLocked ||
                  (gridVisible && !map.tabletop?.gridHidden && readMapTabletop(map).snap)) &&
                map.grid && (
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
            {planner.handles}
            <MapTokenLayer
              map={map}
              tokens={discTokens}
              view={view}
              width={w}
              height={h}
              selected={tools.selected}
              moves={tools.moves}
              movement={useDm ? undefined : movement}
              ghosts={[...tools.group.ghosts, ...pendingMoveGhosts]}
              box={tools.group.box}
              notTurn={tools.notTurn}
              speedFeet={speedFeet}
              onActivate={(token, event) => {
                if (planner.active && !moved.current && !placing && !pinging) {
                  if (!planner.calibrating) planner.addAt(sceneTokenPoint(map.grid!, token));
                  return;
                }
                // A keyboard press (detail 0) is never the end of a drag.
                if (
                  (moved.current && event.detail !== 0) ||
                  pinging ||
                  sketches.active ||
                  !["pan", "select"].includes(tools.tool)
                )
                  return;
                const openToken = () => {
                  setService(undefined);
                  setCombatOpen(false);
                  setHereOpen(false);
                  setDetails([]);
                  // Pointer presses select through the tools; keyboard activation selects here.
                  if (event.detail === 0) tools.choose(token.id, event.shiftKey);
                };
                if (!(service || combatOpen) || allowContextChange(openToken)) openToken();
              }}
            />
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
                    className={`map-record-icon map-kind-${type.kind.toLowerCase().replaceAll(" ", "-")}${highlighted && type.records.some((r) => sameRecord(r.reference, highlighted)) ? " map-record-highlight" : ""}`}
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
                      // While planning a route, a pin adds a waypoint at its place.
                      if (planner.active && !moved.current && !placing && !pinging) {
                        if (!planner.calibrating) planner.addAt(group.point);
                        return;
                      }
                      if (
                        !moved.current &&
                        !pinging &&
                        !sketches.active &&
                        ["pan", "select"].includes(tools.tool)
                      ) {
                        const openPin = () => {
                          setService(undefined);
                          setCombatOpen(false);
                          setHereOpen(false);
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
                            else if (type.records.length === 1 && type.records[0].reference) {
                              // One record with a service opens straight into its place card.
                              setDetails(type.records);
                              setService(type.records[0].reference);
                              setServiceExpanded(false);
                              setDrawerOpen(false);
                              tools.hideInspector();
                            } else setDetails(type.records);
                          }
                        };
                        if (!(service || combatOpen) || allowContextChange(openPin)) openPin();
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
            {quests?.pins &&
              (quests.layers?.markers ?? true) &&
              quests.pins.map((p) => (
                <button
                  type="button"
                  key={p.key}
                  className={`map-quest-pin${p.highlighted ? " highlighted" : ""}`}
                  style={{ left: view.x + p.x * w * view.scale, top: view.y + p.y * h * view.scale }}
                  aria-label={`Quest: ${p.title}${p.label && p.label !== p.title ? ` · ${p.label}` : ""}`}
                  title={p.label || p.title}
                  onClick={() => {
                    if (!moved.current) openQuestOnMap(p.questId);
                  }}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            {quests?.areas &&
              (quests.layers?.areas ?? true) &&
              quests.areas.map((a) => {
                const live = questDrag?.key === a.key ? questDrag : a;
                const cx = view.x + live.x * w * view.scale,
                  cy = view.y + live.y * h * view.scale,
                  rr = live.r * w * view.scale;
                const drag = (mode: "centre" | "edge") => ({
                  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setQuestDrag({ key: a.key, x: live.x, y: live.y, r: live.r });
                  },
                  onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
                    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                    e.stopPropagation();
                    const p = mapPoint(e.clientX, e.clientY);
                    setQuestDrag((d) =>
                      !d || d.key !== a.key
                        ? d
                        : mode === "centre"
                          ? { ...d, x: p.x, y: p.y }
                          : { ...d, r: Math.min(2, Math.max(0.005, Math.hypot((p.x - d.x) * w, (p.y - d.y) * h) / w)) },
                    );
                  },
                  onPointerUp: (e: ReactPointerEvent<HTMLButtonElement>) => {
                    e.stopPropagation();
                    const d = questDrag;
                    setQuestDrag(undefined);
                    if (d && d.key === a.key && (d.x !== a.x || d.y !== a.y || d.r !== a.r))
                      quests.moveArea?.(a.key, { x: d.x, y: d.y, r: d.r });
                  },
                  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => {
                    const step = e.shiftKey ? 0.05 : 0.01;
                    const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0,
                      dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
                    if (!dx && !dy) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const next =
                      mode === "centre"
                        ? { x: Math.min(1, Math.max(0, a.x + dx)), y: Math.min(1, Math.max(0, a.y + dy)), r: a.r }
                        : { x: a.x, y: a.y, r: Math.min(2, Math.max(0.005, a.r + (dx || -dy) / 2)) };
                    quests.moveArea?.(a.key, next);
                  },
                });
                return (
                  <Fragment key={a.key}>
                    <button
                      type="button"
                      className={`map-quest-area-label${a.highlighted ? " highlighted" : ""}`}
                      style={{ left: cx, top: cy - rr }}
                      aria-label={`Quest area: ${a.title}${a.label ? ` · ${a.label}` : ""}`}
                      onClick={() => {
                        if (!moved.current) openQuestOnMap(a.questId);
                      }}
                    >
                      <span aria-hidden="true" className="map-quest-diamond" />
                      {a.label || a.title}
                    </button>
                    {a.editable && a.highlighted && (
                      <>
                        <button
                          type="button"
                          className="map-quest-handle centre"
                          style={{ left: cx, top: cy }}
                          aria-label={`Move area: ${a.label || a.title} (arrow keys)`}
                          {...drag("centre")}
                        />
                        <button
                          type="button"
                          className="map-quest-handle edge"
                          style={{ left: cx + rr, top: cy }}
                          aria-label={`Resize area: ${a.label || a.title} (arrow keys)`}
                          {...drag("edge")}
                        />
                      </>
                    )}
                  </Fragment>
                );
              })}
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
                data-shape={pingShapes[p.color]}
                style={{ left: view.x + p.x * w * view.scale, top: view.y + p.y * h * view.scale }}
                role="img"
                aria-label={`${p.color} ${pingShapes[p.color]} map ping`}
              >
                <PingGlyph color={p.color} />
              </span>
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
                    afterContextChange(() => {
                      setCombatOpen(false);
                      root.current?.focus();
                    });
                  }}
                >
                  Close encounter panel
                </Button>
              </div>
              <Suspense fallback={<p>Opening encounter controls…</p>}>
                <MapCombatWorkspace
                  key={encounterHere?.nonce ?? "map"}
                  map={map}
                  camera={currentCamera}
                  openMap={selectMap}
                  here={encounterHere}
                />
              </Suspense>
            </section>
          )}
          {hereOpen && !combatOpen && (
            <MapHereSheet
              sheet={here}
              dm={useDm}
              partyName={partySplit(recordTable) && hereGroup ? groupInfo(recordTable, hereGroup).name : undefined}
              tokenLine={(() => {
                if (useDm) return undefined;
                const on = maps.find((m) => (m.tokens ?? []).some((t) => t.kind === "character" && !!t.entityId && seatNow.purseIds.includes(t.entityId)));
                return on ? `Your token is on ${on.name} (${zoneName(recordTable, zoneOf(recordTable, on.id))})` : undefined;
              })()}
              quests={questsHere(recordTable, viewer, hereGroup).map((q) => ({
                id: q.id,
                title: q.title,
                detail: nextObjective(q)?.text ?? (q.main ? "Main quest" : "Quest"),
              }))}
              openQuest={(id) => {
                if (!allowContextChange()) return;
                void navigate({ to: "/features/$feature", params: { feature: "quests" }, search: { from: "/maps", code: undefined, quest: id } });
              }}
              groupSwitch={
                partySplit(recordTable) ? (
                  <HereGroupSwitch
                    table={recordTable}
                    groups={hereGroups}
                    value={hereGroup}
                    onChange={setHereGroup}
                  />
                ) : undefined
              }
              close={() => {
                setHereOpen(false);
                root.current?.focus();
              }}
              open={(row) => {
                afterContextChange(() => {
                  const drawn = drawnRecord(row.reference);
                  setHereOpen(false);
                  if (drawn) {
                    focusRecord(drawn);
                    return;
                  }
                  const kind = (
                    {
                      shop: "Shop",
                      npc: "NPC",
                      character: "Character",
                      property: "Property",
                      listing: "Listing",
                      exchange: "Exchange",
                      facility: "Dock",
                      location: "Location",
                      entry: "Journal",
                      handout: "Handout",
                    } as const
                  )[row.reference.kind];
                  setDetails([
                    {
                      id: row.reference.id,
                      label: row.label,
                      kind,
                      reference: row.reference,
                      href: libraryRecordHref(row.reference.kind, row.reference.id),
                      detached: true,
                    },
                  ]);
                  setService(row.reference);
                  setServiceExpanded(false);
                  setDrawerOpen(false);
                  tools.hideInspector();
                  setCardFocus(crypto.randomUUID());
                });
              }}
              canLocate={(reference) =>
                !!drawnRecord(reference) ||
                recordMapSpots(recordTable, reference, viewer, maps).length > 0
              }
              locate={(reference) => {
                const drawn = drawnRecord(reference);
                setHereOpen(false);
                if (drawn) {
                  focusRecord(drawn);
                  setHighlight(reference);
                } else void navigate({ to: "/maps", search: { record: recordParam(reference) } });
              }}
              backToParty={
                partyMapId && partyMapId !== map.id ? () => selectMap(partyMapId) : undefined
              }
              showParty={
                party
                  ? () =>
                      setView((v) => ({
                        ...v,
                        x: size.w / 2 - party.x * w * v.scale,
                        y: size.h / 2 - party.y * h * v.scale,
                      }))
                  : undefined
              }
              planJourney={here.mode === "here" ? openPlanner : undefined}
              showJourney={
                journeyView.journey && journeyView.journey.status !== "planned"
                  ? () => {
                      setHereOpen(false);
                      journeyView.openPanel();
                    }
                  : undefined
              }
            />
          )}
          {currentDetails.length > 0 && !hereOpen && (
            <MapPlaceCard
              records={currentDetails}
              map={map}
              table={serviceTable}
              service={service}
              openService={(r) => {
                afterContextChange(() => {
                  setDetails([r]);
                  setService(r.reference);
                  setServiceExpanded(false);
                  setDrawerOpen(false);
                  tools.hideInspector();
                });
              }}
              expanded={serviceExpanded}
              setExpanded={setServiceExpanded}
              close={() => {
                afterContextChange(() => {
                  setDetails([]);
                  setService(undefined);
                  setServiceExpanded(false);
                  setHighlight(undefined);
                  root.current?.focus();
                });
              }}
              selectMap={selectMap}
              locationMaps={locationMaps}
              focusKey={cardFocus}
              deepLinked={
                currentDetails.length === 1 &&
                sameRecord(currentDetails[0].reference, deepLinkedCard)
              }
            />
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
    // Opt-in portrait pin (Place hub): one NPC or character placed with style "portrait".
    pinned =
      !token && records.length === 1 && records[0].style === "portrait" ? records[0] : undefined,
    pinnedPortrait = pinned?.reference && placementPortrait(table, pinned.reference),
    portrait =
      token?.kind === "character"
        ? table.purses.find((person) => person.id === token.entityId)?.portrait
        : pinnedPortrait || undefined;
  // Split the party: a group's marker carries its letter in its colour.
  const group =
    kind === "Party" && records[0]?.id.startsWith("group:")
      ? groupInfo(table, records[0].id.slice(6))
      : undefined;
  if (group)
    return (
      <span className={`gbadge map-group-badge g-${group.colour}`} aria-hidden="true">
        {group.letter}
      </span>
    );
  return (
    <>
      {portrait ? (
        <img className="tabletop-token-portrait" src={portrait} alt="" draggable={false} />
      ) : pinned ? (
        <span className="map-portrait-initial" aria-hidden="true">
          {pinned.label.slice(0, 1)}
        </span>
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
