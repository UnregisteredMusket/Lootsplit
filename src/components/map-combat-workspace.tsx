import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useEconomy } from "@/lib/quire/economy-context";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { useSeat } from "@/lib/quire/seat";
import {
  captureMutationScope,
  assertMutationScope,
  getCloudTable,
  getServerCloudTable,
  subscribeCloudTable,
} from "@/lib/quire/cloud-client";
import { economyView } from "@/lib/quire/economy";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { defaultLocationMap } from "@/lib/quire/connected-maps";
import { readWorld, type CampaignMap } from "@/lib/quire/world-schema";
import type { MapCombatBinding } from "@/lib/quire/map-combat-schema";
import { encounterRequest } from "@/lib/encounters/client";
import { finishMapEncounter, type MapEncounterDetail } from "@/lib/encounters/map-transition";
import { useDraftGuard, allowContextChange } from "@/lib/quire/use-draft-guard";
import { Button } from "./ui";
import { SearchSelect } from "./search-select";
import { AppLink } from "./app-link";
const Tracker = lazy(() =>
  import("./encounters/workspace").then((m) => ({ default: m.EncounterMapEditor })),
);
type Camera = { x: number; y: number; zoom: number };
export function MapCombatWorkspace({
  map,
  camera,
  openMap,
}: {
  map: CampaignMap;
  camera: () => Camera;
  openMap: (id: string, entry?: Camera) => void;
}) {
  const t = useWorldTable(),
    seat = useSeat(),
    { commandOutcome } = useEconomy(),
    cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable),
    world = readWorld(t.journal.world),
    binding = world.combat;
  const [rows, setRows] = useState<{ id: string; name: string; status: string; code: string }[]>(
      [],
    ),
    [encounterId, setEncounterId] = useState(binding?.encounterId ?? map.encounterId ?? ""),
    [target, setTarget] = useState(
      binding?.mapId ??
        (map.locationId
          ? defaultLocationMap(world.maps, map.locationId, "battle")?.id
          : undefined) ??
        map.id,
    ),
    [mode, setMode] = useState<"grid" | "theatre">(map.grid ? "grid" : "theatre"),
    [scale, setScale] = useState(false),
    [showPlayers, setShowPlayers] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [tracker, setTracker] = useState(false),
    [pendingNavigation, setPendingNavigation] = useState<{ id: string; camera?: Camera }>();
  useDraftGuard(busy, "encounter map transition");
  useEffect(() => {
    if (busy || !pendingNavigation) return;
    const next = pendingNavigation;
    const frame = requestAnimationFrame(() => {
      setPendingNavigation(undefined);
      openMap(next.id, next.camera);
    });
    return () => cancelAnimationFrame(frame);
  }, [busy, pendingNavigation, openMap]);
  const code = cloud.joined ? cloud.code : "device",
    selected = world.maps.find((m) => m.id === target),
    locked = busy || cloud.viewOnly || (cloud.joined && (!cloud.mine || cloud.pending > 0));
  useEffect(() => {
    let cancelled = false;
    const scope = captureMutationScope();
    void encounterRequest<{ encounters: typeof rows }>("encounters", { code })
      .then((result) => {
        assertMutationScope(scope);
        if (!cancelled) setRows(result.encounters.filter((e) => e.code === code));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load encounters.");
      });
    return () => {
      cancelled = true;
    };
  }, [code]);
  async function execute(operation: () => Promise<void>) {
    if (locked) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The transition could not finish. Its saved preparation is retained.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function finish(prepared: MapCombatBinding) {
    const scope = captureMutationScope();
    await finishMapEncounter(prepared, code, {
      guard: () => assertMutationScope(scope),
      read: () =>
        encounterRequest<MapEncounterDetail>("encounters/detail", { id: prepared.encounterId }),
      start: (revision) =>
        encounterRequest("encounters/start", { id: prepared.encounterId, revision }),
      activate: async () => {
        const latest = await economyView();
        assertMutationScope(scope);
        const w = readWorld(latest.journal.world);
        if (w.combat?.id !== prepared.id)
          throw Error("The prepared encounter map changed. Reopen its current preparation.");
        if (w.combat.phase !== "active") {
          const result = await commandOutcome(
            {
              kind: "map-combat-transition",
              before: w.combat,
              binding: { ...w.combat, phase: "active" },
              beforeSession: w.tabletop ?? null,
            },
            scope,
          );
          if (result.status !== "committed")
            throw Error(
              "The encounter has started. Scene activation is pending: submit your turn or resolve sync, then finish opening the battle map.",
            );
        }
      },
    });
    setNotice(
      "Encounter started. The map is ready; physical location and campaign time are unchanged.",
    );
    setPendingNavigation({ id: prepared.mapId });
    setTracker(true);
  }
  async function start() {
    await execute(async () => {
      if (!encounterId || !selected) throw Error("Choose a saved encounter and map.");
      if (mode === "grid" && (!selected.grid || !scale))
        throw Error("Review and confirm this map’s calibrated grid scale.");
      if (showPlayers && !selected.visible)
        throw Error("Share the destination map before showing it to players.");
      const scope = captureMutationScope(),
        detail = await encounterRequest<MapEncounterDetail>("encounters/detail", {
          id: encounterId,
        });
      assertMutationScope(scope);
      if (detail.code !== code || detail.readOnly || !["draft", "active"].includes(detail.status))
        throw Error("Choose a saved draft or active encounter in this campaign.");
      const prepared: MapCombatBinding = {
        id: crypto.randomUUID(),
        encounterId,
        encounterRevision: detail.revision,
        mapId: selected.id,
        mode,
        phase: "prepared",
        showPlayers,
        scaleConfirmed: mode === "grid" && scale,
        gridFingerprint: mode === "grid" ? canonicalJson(selected.grid) : undefined,
        returnMapId: map.id,
        returnCamera: camera(),
      };
      const result = await commandOutcome(
        {
          kind: "map-combat-transition",
          before: null,
          binding: prepared,
          beforeSession: world.tabletop ?? null,
        },
        scope,
      );
      if (result.status !== "committed") {
        setNotice(
          "Preparation is pending. Submit your turn or resolve sync, then finish opening the battle map.",
        );
        return;
      }
      await finish(prepared);
    });
  }
  async function returnToMap() {
    await execute(async () => {
      if (!binding) return;
      const scope = captureMutationScope();
      const result = await commandOutcome(
        {
          kind: "map-combat-transition",
          before: binding,
          binding: null,
          beforeSession: world.tabletop ?? null,
        },
        scope,
      );
      if (result.status !== "committed") {
        setNotice("Return is pending. Submit your turn or resolve sync.");
        return;
      }
      setPendingNavigation({ id: binding.returnMapId, camera: binding.returnCamera });
      setTracker(false);
      setNotice("Returned to exploration. Encounter history, tokens and fog are retained.");
    });
  }
  if (seat.role !== "dm") return null;
  return (
    <section aria-label="Encounter map workspace" className="map-encounter-workspace">
      <h3>{binding ? "Encounter map" : "Start encounter here"}</h3>
      {binding ? (
        <>
          <p>
            {binding.phase === "prepared"
              ? "Preparation saved. Finish opening the battle map after sync; an already started encounter will not start again."
              : "The encounter map is open. Use the existing tracker for initiative, HP, conditions and loot review."}
          </p>
          <div className="world-toolbar">
            <Button disabled={locked} onClick={() => void execute(() => finish(binding))}>
              {binding.phase === "prepared" ? "Finish opening battle map" : "Open battle map"}
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (allowContextChange()) setTracker((v) => !v);
              }}
            >
              {tracker ? "Close tracker" : "Open encounter tracker"}
            </Button>
            <Button
              disabled={locked}
              onClick={() => {
                if (allowContextChange()) void returnToMap();
              }}
            >
              {binding.phase === "prepared"
                ? "Cancel prepared map transition"
                : "Return to exploration"}
            </Button>
          </div>
          <p>
            Returning does not conclude combat, award loot or advance time. Conclude and review loot
            in the tracker when ready.
          </p>
        </>
      ) : (
        <>
          <label>
            Saved encounter
            <SearchSelect
              aria-label="Saved encounter to start"
              value={encounterId}
              onValueChange={setEncounterId}
            >
              <option value="">Choose an encounter</option>
              {rows
                .filter((e) => ["draft", "active"].includes(e.status))
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {e.status}
                  </option>
                ))}
            </SearchSelect>
          </label>
          <label>
            Encounter map
            <SearchSelect
              aria-label="Encounter map"
              value={target}
              onValueChange={(id) => {
                setTarget(id);
                setScale(false);
                setMode(world.maps.find((m) => m.id === id)?.grid ? "grid" : "theatre");
              }}
            >
              {world.maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.visible ? "" : " · DM only"}
                </option>
              ))}
            </SearchSelect>
          </label>
          <label>
            Combat presentation
            <select
              aria-label="Combat presentation"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as typeof mode);
                setScale(false);
              }}
            >
              <option value="theatre">Keep map view · theatre of the mind</option>
              <option value="grid" disabled={!selected?.grid}>
                Use this map’s calibrated grid
              </option>
            </select>
          </label>
          {mode === "grid" && selected?.grid && (
            <label>
              <input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} />{" "}
              I reviewed {selected.grid.feetPerTile} ft per tile on {selected.name}
            </label>
          )}
          <label>
            <input
              type="checkbox"
              checked={showPlayers}
              onChange={(e) => setShowPlayers(e.target.checked)}
            />{" "}
            Show this scene to players after the encounter starts
          </label>
          <p>
            Existing token positions and fog remain. Import the saved roster through Combat tiles;
            enemies remain private until you reveal them.
          </p>
          <Button disabled={locked} onClick={() => void start()}>
            Start saved encounter here
          </Button>
          <AppLink href="/encounters">Prepare or create an encounter →</AppLink>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {cloud.pending > 0 && (
        <p>Resolve or submit pending campaign actions before continuing the transition.</p>
      )}
      {tracker && binding && (
        <Suspense fallback={<p>Opening tracker…</p>}>
          <Tracker key={binding.encounterId} id={binding.encounterId} />
        </Suspense>
      )}
    </section>
  );
}
