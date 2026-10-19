import { useEffect, useRef, useState, type ReactNode } from "react";
import { MonitorPlay } from "lucide-react";
import { MapVisibilityPublisher } from "./map-visibility-publisher";
import { Button, Field, Modal, Select } from "./ui";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { readWorld } from "@/lib/quire/world-schema";
import { activeCampaignId } from "@/lib/quire/campaign-context";
import { getCloudTable } from "@/lib/quire/cloud-client";
import { encounterRequest } from "@/lib/encounters/client";
import { localEncounterRequest } from "@/lib/encounters/local";
import { accountRequest } from "@/lib/account/client";
import { subscribeWorkspaceChanges } from "@/lib/quire/workspace-events";
import {
  defaultDisplaySettings,
  displayChannelName,
  openPlayerDisplay,
  projectPlayerDisplay,
  type DisplayEncounter,
  type DisplaySettings,
} from "@/lib/quire/player-display";

type Request = { mapId?: string; encounterId?: string };
const DISPLAY_REQUEST = "lootsplit:player-display";
export function PlayerDisplayButton({
  mapId,
  encounterId,
  icon = false,
}: Request & { icon?: boolean }) {
  const dm = useSeat().role === "dm";
  if (!dm || import.meta.env.VITE_MOBILE === "true") return null;
  const launch = () =>
    window.dispatchEvent(
      new CustomEvent<Request>(DISPLAY_REQUEST, { detail: { mapId, encounterId } }),
    );
  return icon ? (
    <button
      type="button"
      className="header-icon"
      aria-label="Player display"
      title="Player display"
      onClick={launch}
    >
      <MonitorPlay size={23} aria-hidden="true" />
    </button>
  ) : (
    <Button aria-label="Player display" onClick={launch}>
      <MonitorPlay size={18} aria-hidden="true" />
      Player display
    </Button>
  );
}
export function PlayerDisplayProvider({ children }: { children: ReactNode }) {
  const seat = useSeat(),
    campaignId = activeCampaignId();
  return (
    <>
      {children}
      <MapVisibilityPublisher />
      <DisplaySession
        key={`${campaignId}:${seat.openedAt}:${seat.role}:${getCloudTable().code}`}
        dm={seat.role === "dm"}
      />
    </>
  );
}
function DisplaySession({ dm }: { dm: boolean }) {
  const table = useWorldTable(),
    campaignId = activeCampaignId(),
    code = getCloudTable().joined ? getCloudTable().code : "device";
  const [open, setOpen] = useState(false),
    [settings, setSettings] = useState<DisplaySettings>(defaultDisplaySettings),
    [detail, setDetail] = useState<DisplayEncounter | null>(null),
    [encounters, setEncounters] = useState<Array<{ id: string; code: string; name: string }>>([]),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [detailError, setDetailError] = useState("");
  const channel = useRef<BroadcastChannel | null>(null),
    channelId = useRef(""),
    lastSeen = useRef(0);
  const frame = useRef<ReturnType<typeof projectPlayerDisplay> | null>(null);
  frame.current = dm ? projectPlayerDisplay(table, detail, settings, code) : null;
  const maps = readWorld(table.journal.world).maps.filter((m) => m.visible);
  function update(patch: Partial<DisplaySettings>) {
    setSettings((s) => ({ ...s, ...patch }));
  }
  useEffect(() => {
    if (!dm || !open) return;
    let cancelled = false;
    type Library = { encounters: Array<{ id: string; code: string; name: string }> };
    Promise.all([
      localEncounterRequest<Library>("encounters"),
      accountRequest<Library>("encounters").catch(() => ({ encounters: [] })),
    ])
      .then((rows) => {
        if (!cancelled)
          setEncounters(rows.flatMap((r) => r.encounters).filter((e) => e.code === code));
      })
      .catch((e) => {
        if (!cancelled) setError(String(e.message));
      });
    return () => {
      cancelled = true;
    };
  }, [dm, open, code]);
  useEffect(() => {
    setDetail(null);
    setDetailError("");
    if (!dm || !settings.encounterId) return;
    let cancelled = false,
      loading = false;
    const id = settings.encounterId;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const next = await encounterRequest<DisplayEncounter>("encounters/detail", { id });
        if (!cancelled && activeCampaignId() === campaignId) {
          setDetail((previous) =>
            next.code !== code
              ? null
              : previous?.id === next.id &&
                  previous.revision === next.revision &&
                  previous.status === next.status
                ? previous
                : next,
          );
          setDetailError(next.code === code ? "" : "Choose an encounter from this campaign.");
        }
      } catch (e) {
        if (!cancelled) {
          setDetail(null);
          setDetailError(e instanceof Error ? e.message : "Encounter unavailable.");
        }
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (channel.current || open) void load();
    }, 2000);
    const unsubscribe = subscribeWorkspaceChanges(() => {
      void load();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      unsubscribe();
    };
  }, [settings.encounterId, campaignId, code, dm, open]);
  useEffect(() => {
    if (!dm) return;
    const timer = window.setInterval(() => {
      if (channel.current && frame.current && activeCampaignId() === campaignId)
        channel.current.postMessage("alive");
      setConnected(lastSeen.current > Date.now() - 6000);
    }, 1000);
    return () => {
      clearInterval(timer);
      channel.current?.postMessage({
        ...frame.current,
        paused: true,
        map: null,
        encounter: null,
        loot: null,
      });
      channel.current?.close();
      channel.current = null;
    };
  }, [dm, campaignId]);
  useEffect(() => {
    if (channel.current && frame.current) channel.current.postMessage(frame.current);
  }, [table.journal, table.purses, detail, settings]);
  function launch(tab: boolean) {
    setError("");
    try {
      if (!channel.current) {
        channelId.current = crypto.randomUUID();
        channel.current = new BroadcastChannel(displayChannelName(channelId.current));
        channel.current.onmessage = (e) => {
          if (e.data === "ready" || e.data === "ping") {
            lastSeen.current = Date.now();
            setConnected(true);
            if (e.data === "ready" && frame.current) channel.current?.postMessage(frame.current);
          }
        };
      }
      openPlayerDisplay(channelId.current, tab);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Display unavailable in this browser.");
    }
  }
  useEffect(() => {
    if (!dm) return;
    const show = (event: Event) => {
      const request = (event as CustomEvent<Request>).detail;
      if (!request) return;
      setError("");
      setSettings((s) => ({
        ...s,
        ...(request.mapId ? { mapId: request.mapId } : {}),
        ...(request.encounterId && request.encounterId !== s.encounterId
          ? {
              encounterId: request.encounterId,
              combatantIds: [],
              showLoot: false,
              showHp: false,
              showConditions: false,
            }
          : {}),
      }));
      setOpen(true);
    };
    window.addEventListener(DISPLAY_REQUEST, show);
    return () => window.removeEventListener(DISPLAY_REQUEST, show);
  }, [dm]);
  return (
    <>
      {dm && (
        <Modal open={open} onOpenChange={setOpen} title="Player display">
          <div className="space-y-4">
            <p>
              Send a player-safe map and tracker to a TV or second screen. Keep this DM window open
              to control it.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => launch(false)}>Open player window</Button>
              <Button onClick={() => launch(true)}>Open player tab</Button>
              <Button onClick={() => update({ paused: !settings.paused })}>
                {settings.paused ? "Show display" : "Blank display"}
              </Button>
            </div>
            <p role="status">
              {settings.paused
                ? "Display blanked"
                : connected
                  ? "Player display connected"
                  : "Waiting for player display"}
            </p>
            <Field label="Shared map">
              <Select
                aria-label="Display map"
                value={settings.mapId}
                onChange={(e) => {
                  const map = maps.find((m) => m.id === e.target.value);
                  update({
                    mapId: e.target.value,
                    ...(map?.encounterId && map.encounterId !== settings.encounterId
                      ? {
                          encounterId: map.encounterId,
                          combatantIds: [],
                          showLoot: false,
                          showHp: false,
                          showConditions: false,
                        }
                      : {}),
                  });
                }}
              >
                <option value="">No map</option>
                {maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-sm text-muted">
              Only maps marked visible to players can be selected. The entire image is shown; use a
              player-ready image. DM-only markers and tokens are excluded.
            </p>
            <Field label="Campaign encounter">
              <Select
                aria-label="Display encounter"
                value={settings.encounterId}
                onChange={(e) =>
                  update({
                    encounterId: e.target.value,
                    combatantIds: [],
                    showLoot: false,
                    showHp: false,
                    showConditions: false,
                  })
                }
              >
                <option value="">No encounter</option>
                {encounters.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </Field>
            {detailError && <p role="alert">{detailError}</p>}
            {detail && detail.code === code && (
              <fieldset className="space-y-2">
                <legend>Combatants to reveal</legend>
                <p className="text-sm text-muted">
                  New combatants stay hidden until selected. Only saved encounter changes appear.
                </p>
                {detail.body.combatants.map((c) => (
                  <label key={c.id} className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={settings.combatantIds.includes(c.id)}
                      onChange={(e) =>
                        update({
                          combatantIds: e.target.checked
                            ? [...settings.combatantIds, c.id]
                            : settings.combatantIds.filter((id) => id !== c.id),
                        })
                      }
                    />
                    {c.name}
                  </label>
                ))}
                <Check
                  label="Show exact HP"
                  value={settings.showHp}
                  set={(v) => update({ showHp: v })}
                />
                <Check
                  label="Show conditions"
                  value={settings.showConditions}
                  set={(v) => update({ showConditions: v })}
                />
                <Check
                  label="Show confirmed awarded loot"
                  value={settings.showLoot}
                  set={(v) => update({ showLoot: v })}
                />
                <p className="text-sm text-muted">
                  Loot appears only after Transfer loot once succeeds. Displaying it never awards or
                  moves items or coins. Private notes, stat blocks, prices and recipient finances
                  are excluded.
                </p>
              </fieldset>
            )}
            <div className="flex flex-wrap gap-4">
              <Check label="Show grid" value={settings.grid} set={(v) => update({ grid: v })} />
              <Check
                label="Show shared tokens"
                value={settings.tokens}
                set={(v) => update({ tokens: v })}
              />
            </div>
            <Field label="Rotation">
              <Select
                aria-label="Display rotation"
                value={settings.rotation}
                onChange={(e) => update({ rotation: Number(e.target.value) })}
              >
                {[0, 90, 180, 270].map((n) => (
                  <option key={n} value={n}>
                    {n}°
                  </option>
                ))}
              </Select>
            </Field>
            <Range
              label="Map zoom"
              min={25}
              max={400}
              value={settings.zoom}
              set={(v) => update({ zoom: v })}
            />
            <Range
              label="Horizontal position"
              min={-100}
              max={100}
              value={settings.panX}
              set={(v) => update({ panX: v })}
            />
            <Range
              label="Vertical position"
              min={-100}
              max={100}
              value={settings.panY}
              set={(v) => update({ panY: v })}
            />
            <Field label="Tile size in screen pixels (0 = fit)">
              <input
                aria-label="Tile size in screen pixels"
                className="input"
                type="number"
                min={0}
                max={250}
                value={settings.tilePixels}
                onChange={(e) =>
                  update({ tilePixels: Math.max(0, Math.min(250, Number(e.target.value) || 0)) })
                }
              />
            </Field>
            <p className="text-sm text-muted">
              For physical miniatures, measure a tile on the TV with a ruler and adjust pixel size.
              Keep browser zoom at 100%. Grid calibration uses the map’s saved grid and makes tiles
              square on both axes.
            </p>
            <Button
              onClick={() => update({ zoom: 100, panX: 0, panY: 0, rotation: 0, tilePixels: 0 })}
            >
              Fit map
            </Button>
            <p>
              For HDMI or an extended desktop, move the player window onto the TV and use its
              Fullscreen button. For wireless casting, open the player tab and choose Cast tab in
              your browser’s casting menu. Cast that tab only. Browser and TV support varies.
            </p>
            <p className="text-sm text-muted">
              This is a presentation window on your device, not a player sign-in or remote
              invitation. It stays blank without its controller. Controls and display content are
              kept in memory and reset when this DM window closes or changes campaign.
            </p>
            {error && (
              <p role="alert" className="text-negative">
                {error}
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
function Check({
  label,
  value,
  set,
}: {
  label: string;
  value: boolean;
  set: (value: boolean) => void;
}) {
  return (
    <label className="flex gap-2">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
}
function Range({
  label,
  min,
  max,
  value,
  set,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  set: (value: number) => void;
}) {
  return (
    <Field label={`${label}: ${value}`}>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="w-full"
      />
    </Field>
  );
}
