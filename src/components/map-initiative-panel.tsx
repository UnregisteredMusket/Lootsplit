import { useEffect, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { AppLink } from "./app-link";
import { Button } from "./ui";
import {
  assertMutationScope,
  captureMutationScope,
  getCloudTable,
  getServerCloudTable,
  readSharedMapCombatOrder,
  subscribeCloudTable,
} from "@/lib/quire/cloud-client";
import { encounterRequest } from "@/lib/encounters/client";
import { nextTurn, previousTurn } from "@/lib/encounters/model.mjs";
import type { MapCombatBinding, MapCombatOrder } from "@/lib/quire/map-combat-schema";
import type { CampaignMap } from "@/lib/quire/world-schema";

type Combatant = {
  id: string;
  name: string;
  side?: string;
  initiative?: number | null;
  hp?: number;
  maxHp?: number;
};
type Detail = {
  id: string;
  revision: number;
  status: string;
  body: { name: string; round: number; activeId: string; combatants: Combatant[] } & Record<
    string,
    unknown
  >;
};

/**
 * Initiative (I) on the map (map controls PR 6). The DM reads and steps the bound encounter's
 * turn order through the tracker's own `encounters/detail` and `encounters/save` (Previous turn,
 * Next turn); awards stay in the full tracker. Players read the server projection
 * (`readSharedMapCombatOrder`): revealed order, round, turn and their own HP only.
 */
export function MapInitiativePanel({
  map,
  dm,
  binding,
  openControls,
  close,
}: {
  map: CampaignMap;
  dm: boolean;
  /** The DM's encounter binding (DM seats only). */
  binding?: MapCombatBinding;
  /** The existing encounter map controls (start here, presentation, return to exploration). */
  openControls: () => void;
  close: () => void;
}) {
  return (
    <aside
      id="map-initiative"
      className="map-side-panel map-initiative-panel map-glass"
      role="dialog"
      aria-modal="false"
      aria-labelledby="map-initiative-heading"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="map-panel-heading">
        <strong id="map-initiative-heading">Initiative</strong>
        <button className="map-icon-button" aria-label="Close initiative" onClick={close}>
          <X size={16} />
        </button>
      </div>
      {dm ? (
        <DmInitiative map={map} binding={binding} openControls={openControls} />
      ) : (
        <PlayerInitiative map={map} />
      )}
    </aside>
  );
}

function DmInitiative({
  map,
  binding,
  openControls,
}: {
  map: CampaignMap;
  binding?: MapCombatBinding;
  openControls: () => void;
}) {
  const encounterId = binding?.mapId === map.id ? binding.encounterId : undefined;
  const [detail, setDetail] = useState<Detail>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    if (!encounterId) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const expected = captureMutationScope();
    const load = async () => {
      try {
        const row = await encounterRequest<Detail>("encounters/detail", { id: encounterId });
        assertMutationScope(expected);
        if (!cancelled) {
          setDetail(row);
          setError("");
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "The encounter could not be read.");
      }
      if (!cancelled) timer = setTimeout(() => void load(), 3000);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [encounterId, reload]);
  if (!encounterId)
    return (
      <>
        <p>No encounter is running on this map.</p>
        <Button onClick={openControls}>Start encounter here</Button>
      </>
    );
  const step = async (direction: "previous" | "next") => {
    if (!detail || busy) return;
    setBusy(true);
    setError("");
    try {
      const encounter = (direction === "next" ? nextTurn : previousTurn)(detail.body as never);
      await encounterRequest("encounters/save", {
        id: detail.id,
        revision: detail.revision,
        encounter,
      });
      setReload((n) => n + 1);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} Refresh the tracker and try again.`
          : "The turn was not saved. Refresh and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const body = detail?.body;
  return (
    <>
      {body ? (
        <>
          <p className="map-initiative-round">
            <strong>Round {body.round}</strong> · {body.name}
          </p>
          <ol className="map-initiative-list" aria-label="Turn order">
            {body.combatants.map((c) => (
              <li key={c.id} aria-current={c.id === body.activeId ? "true" : undefined}>
                <span className="map-initiative-score">{c.initiative ?? "–"}</span>
                <span className="map-initiative-name">{c.name}</span>
                {typeof c.hp === "number" && (
                  <span className="map-initiative-hp">
                    {c.hp}
                    {typeof c.maxHp === "number" ? ` / ${c.maxHp}` : ""} HP
                  </span>
                )}
              </li>
            ))}
          </ol>
          <div className="world-toolbar">
            <Button
              variant="secondary"
              disabled={busy || !body.combatants.length || detail?.status !== "active"}
              onClick={() => void step("previous")}
            >
              Previous turn
            </Button>
            <Button
              disabled={busy || !body.combatants.length || detail?.status !== "active"}
              onClick={() => void step("next")}
            >
              Next turn
            </Button>
          </div>
        </>
      ) : (
        !error && <p>Reading the encounter…</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="world-toolbar">
        <AppLink
          className="settings-link"
          href={`/encounters?encounter=${encodeURIComponent(encounterId)}`}
        >
          Full tracker →
        </AppLink>
        <Button variant="secondary" onClick={openControls}>
          Encounter map controls
        </Button>
      </div>
    </>
  );
}

function PlayerInitiative({ map }: { map: CampaignMap }) {
  const cloud = useSyncExternalStore(subscribeCloudTable, getCloudTable, getServerCloudTable);
  const [state, setState] = useState<{ order: MapCombatOrder | null; error?: string }>();
  useEffect(() => {
    // A different map: never show the previous map's order while the next one loads.
    setState(undefined);
    if (!cloud.joined) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const order = await readSharedMapCombatOrder(map.id);
        if (!cancelled) setState({ order });
      } catch {
        if (!cancelled)
          setState({ order: null, error: "Initiative unavailable. Check the connection status." });
      }
      if (!cancelled) timer = setTimeout(() => void load(), 3000);
    };
    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cloud.joined, map.id]);
  const order = state?.order;
  if (!cloud.joined) return <p>Initiative is shown in a shared campaign while the DM runs combat.</p>;
  if (state?.error) return <p role="alert">{state.error}</p>;
  if (!state) return <p>Reading the turn order…</p>;
  if (!order) return <p>The DM is not showing combat on this map.</p>;
  return (
    <>
      <p className="map-initiative-round">
        <strong>Round {order.round}</strong>
        {order.status !== "active" ? ` · ${order.status}` : ""}
      </p>
      {order.entries.length ? (
        <ol className="map-initiative-list" aria-label="Turn order">
          {order.entries.map((entry) => (
            <li key={entry.tokenId} aria-current={entry.active ? "true" : undefined}>
              <span className="map-initiative-score">{entry.initiative ?? ""}</span>
              <span className="map-initiative-name">
                {entry.label}
                {entry.own ? " (you)" : ""}
              </span>
              {entry.hp !== undefined && (
                <span className="map-initiative-hp">
                  {entry.hp}
                  {entry.maxHp !== undefined ? ` / ${entry.maxHp}` : ""} HP
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p>No combatants are revealed on this map yet.</p>
      )}
      <p className="text-sm text-muted">
        Only combatants revealed on the map are listed; their order follows the DM&apos;s tracker.
      </p>
    </>
  );
}
