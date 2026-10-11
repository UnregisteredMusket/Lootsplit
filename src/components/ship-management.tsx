import { useState } from "react";
import { useSeat } from "@/lib/quire/seat";
import {
  readFleet,
  defaultShip,
  vesselSchema,
  facilitySchema,
  type Vessel,
  type ShipFacility,
  type ShipVoyage,
} from "@/lib/quire/ships-schema";
import { facilityAccess, shipFingerprint } from "@/lib/quire/ships";
import { readMarketLocations, locationLabel } from "@/lib/quire/shop-locations";
import { storageWeight } from "@/lib/quire/estate";
import { characterPosition } from "@/lib/quire/character-position";
import { formatCopper } from "@/lib/quire/money";
import type { Holding } from "@/lib/quire/types";
import { ActionForm, NumberField, useEstateTable } from "./property-operations";
import { Button, Field, Fold, Select, TextArea, TextInput } from "./ui";
import { SearchSelect } from "./search-select";
import { LocationOptions } from "./market-locations";

const uid = () => crypto.randomUUID();
const mod = (score: number) => {
  const n = Math.floor((score - 10) / 2);
  return n >= 0 ? `+${n}` : String(n);
};
function Check({
  label,
  checked,
  set,
}: {
  label: string;
  checked: boolean;
  set: (v: boolean) => void;
}) {
  return (
    <label className="estate-tick">
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
}
export function ShipManagement({ holding: h }: { holding: Holding }) {
  const t = useEstateTable(),
    seat = useSeat(),
    fleet = readFleet(t.journal?.fleet),
    s = fleet.vessels.find((s) => s.propertyId === h.id),
    dm = seat.role === "dm";
  const yards = fleet.facilities.filter((y) => y.propertyId === h.id);
  if (!s && !yards.length && !dm) return null;
  return (
    <section className="estate-operations" aria-label={`${h.name} ship management`}>
      {s && (
        <>
          <h3>Ship · {h.name}</h3>
          <p>
            {s.mode} ·{" "}
            {h.locationId
              ? locationLabel(readMarketLocations(t.journal?.market), h.locationId)
              : "Underway"}{" "}
            · {storageWeight(t, h.id).weight}/{s.stats.cargoWeight} lb cargo
          </p>
          <p>
            Use property Storage to load trade goods, Staff & managers to hire sailors or an
            authorized captain, and property details to rename the ship. Cargo retains its owner.
          </p>
          <ShipName key={h.name} holding={h} />
          <Fold title="Ship stat block" hint={`${s.stats.vesselType} · ${s.stats.size}`}>
            <p>
              {s.stats.dimensions} · STR {s.stats.str} ({mod(s.stats.str)}) · DEX {s.stats.dex} (
              {mod(s.stats.dex)}) · CON {s.stats.con} ({mod(s.stats.con)})
            </p>
            <p>
              Speed {s.stats.speedFeet} ft · travel {s.stats.milesPerDay} miles/day · minimum crew{" "}
              {s.stats.minimumCrew} · characters aboard{" "}
              {t.journal?.fleet?.aboard.filter((p) => p.propertyId === h.id).length ?? 0}/
              {s.stats.passengers}
            </p>
            <div className="ship-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>AC</th>
                    <th>HP</th>
                    <th>Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {s.stats.components.map((c) => (
                    <tr key={c.id}>
                      <th>{c.name}</th>
                      <td>{c.ac}</td>
                      <td>
                        {c.hp}/{c.maxHp}
                      </td>
                      <td>{c.threshold}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>{s.stats.defenses}</p>
            <p>{s.stats.actions}</p>
            <p>
              Damage below a component’s threshold causes no HP loss. Damage meeting the threshold
              applies in full.
            </p>
          </Fold>
          <Fold title="Crew & passengers">
            <Boarding key={shipFingerprint(t, h.id)} holding={h} vessel={s} />
          </Fold>
          <Fold title="Docks, dry storage & shipyards">
            <Berthing key={shipFingerprint(t, h.id)} holding={h} vessel={s} />
          </Fold>
          <Fold title="Repairs & ship upgrades">
            <ShipWork key={shipFingerprint(t, h.id)} holding={h} vessel={s} />
          </Fold>
          <Fold title="Downtime voyages">
            <Voyages holding={h} vessel={s} />
          </Fold>
          <Fold title="Ship expenses">
            <p>
              Sailing: {formatCopper(s.sailingCopper)}/day · docked: {formatCopper(s.dockedCopper)}
              /day · dry/yard storage: {formatCopper(s.storedCopper)}/day. Facility fees and staff
              wages are separate.
            </p>
            <p>
              Unpaid ship expenses: {formatCopper(s.arrearsCopper)}. Rates settle only through
              approved campaign time.
            </p>
            {s.arrearsCopper > 0 && <Arrears holding={h} vessel={s} />}
          </Fold>
          {dm && (
            <Fold title="DM damage & teleport overrides">
              <Overrides key={shipFingerprint(t, h.id)} holding={h} vessel={s} />
            </Fold>
          )}
        </>
      )}
      {dm && (
        <Fold title={s ? "DM ship settings" : "Configure this property as a ship"}>
          <ShipSettings key={JSON.stringify(s)} holding={h} before={s ?? null} />
        </Fold>
      )}
      {yards.map((y) => (
        <Fold title={`Shipyard · ${y.name}`} key={y.id}>
          <p>
            {fleet.vessels.filter((s) => s.facilityId === y.id).length}/{y.slots} berths ·{" "}
            {y.maxDimensions}
          </p>
          <p>
            Dock {formatCopper(y.dockCopper)}, dry storage {formatCopper(y.dryCopper)}, yard{" "}
            {formatCopper(y.yardCopper)} per day. Own ships avoid rental fees; maintenance, wages,
            materials and labor still apply.
          </p>
          {dm && <FacilityEditor key={JSON.stringify(y)} before={y} />}
        </Fold>
      ))}
    </section>
  );
}
function ShipName({ holding: h }: { holding: Holding }) {
  const [name, setName] = useState(h.name);
  return (
    <ActionForm
      title="Name your ship"
      command={() => ({ kind: "ship-name", propertyId: h.id, before: h.name, name })}
    >
      <Field label="Ship name">
        <TextInput
          required
          maxLength={160}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
    </ActionForm>
  );
}
function ShipSettings({ holding: h, before }: { holding: Holding; before: Vessel | null }) {
  const [draft, set] = useState<Vessel>(
    before ?? {
      ...defaultShip(),
      propertyId: h.id,
      mode: "docked",
      facilityId: null,
      installed: [],
      arrearsCopper: 0,
      expenseRemainder: 0,
      dmNotes: "",
    },
  );
  const [components, setComponents] = useState(JSON.stringify(draft.stats.components, null, 2)),
    [upgrades, setUpgrades] = useState(JSON.stringify(draft.upgrades, null, 2)),
    [materials, setMaterials] = useState(JSON.stringify(draft.repairMaterials, null, 2));
  const stats = (key: keyof Vessel["stats"], value: string | number) =>
    set((d) => ({ ...d, stats: { ...d.stats, [key]: value } }));
  return (
    <ActionForm
      title="Review ship settings"
      command={() => ({
        kind: "ship-configure",
        before,
        vessel: vesselSchema.parse({
          ...draft,
          stats: { ...draft.stats, components: JSON.parse(components) },
          upgrades: JSON.parse(upgrades),
          repairMaterials: JSON.parse(materials),
        }),
      })}
    >
      <p>
        These editable starting values are examples. Review your campaign’s vehicle rules and prices
        before use. Set the property’s location first.
      </p>
      {(
        [
          ["vesselType", "Vessel type"],
          ["size", "Size"],
          ["dimensions", "Dimensions"],
        ] as const
      ).map(([key, label]) => (
        <Field key={key} label={label}>
          <TextInput
            required
            value={draft.stats[key]}
            onChange={(e) => stats(key, e.target.value)}
          />
        </Field>
      ))}
      {(
        [
          ["lengthFeet", "Length (ft)"],
          ["str", "STR"],
          ["dex", "DEX"],
          ["con", "CON"],
          ["speedFeet", "Speed (ft)"],
          ["milesPerDay", "Travel pace (miles/day)"],
          ["minimumCrew", "Minimum crew"],
          ["passengers", "Character capacity"],
          ["cargoWeight", "Cargo capacity (lb)"],
        ] as const
      ).map(([key, label]) => (
        <NumberField
          key={key}
          label={label}
          value={draft.stats[key]}
          max={["str", "dex", "con"].includes(key) ? 30 : 1e12}
          step={key === "milesPerDay" ? 0.01 : 1}
          set={(n) => stats(key, n)}
        />
      ))}
      {(
        [
          ["sailingCopper", "Daily sailing maintenance/provisions (cp)"],
          ["dockedCopper", "Daily docked maintenance (cp)"],
          ["storedCopper", "Daily stored maintenance (cp)"],
          ["repairCopperPerHp", "Full contractor repair cost per HP (cp)"],
          ["repairHpPerDay", "HP repaired per full worker day"],
        ] as const
      ).map(([key, label]) => (
        <NumberField
          key={key}
          label={label}
          value={draft[key]}
          min={key === "repairHpPerDay" ? 1 : 0}
          set={(n) => set((d) => ({ ...d, [key]: n }))}
        />
      ))}
      <Field label="Defenses">
        <TextArea
          value={draft.stats.defenses}
          onChange={(e) => stats("defenses", e.target.value)}
        />
      </Field>
      <Field label="Ship actions">
        <TextArea value={draft.stats.actions} onChange={(e) => stats("actions", e.target.value)} />
      </Field>
      <Field label="Private DM ship notes">
        <TextArea
          value={draft.dmNotes}
          onChange={(e) => set((d) => ({ ...d, dmNotes: e.target.value }))}
        />
      </Field>
      <Field label="Components (JSON)">
        <TextArea rows={9} value={components} onChange={(e) => setComponents(e.target.value)} />
      </Field>
      <Field label="Upgrade definitions (JSON)">
        <TextArea rows={9} value={upgrades} onChange={(e) => setUpgrades(e.target.value)} />
      </Field>
      <Field label="Repair materials per HP (JSON)">
        <TextArea rows={4} value={materials} onChange={(e) => setMaterials(e.target.value)} />
      </Field>
    </ActionForm>
  );
}
function Boarding({ holding: h, vessel: s }: { holding: Holding; vessel: Vessel }) {
  const t = useEstateTable(),
    seat = useSeat(),
    dm = seat.role === "dm",
    chars = t.purses.filter(
      (p) =>
        p.kind === "character" &&
        (dm || seat.purseIds.includes(p.id)) &&
        !t.journal?.tradeEconomy?.exchanges.some((e) => e.purseId === p.id),
    );
  const [purseId, setPurse] = useState(chars[0]?.id ?? "");
  const aboard = t.journal?.fleet?.aboard.filter((p) => p.propertyId === h.id) ?? [],
    position = t.purses.find((p) => p.id === purseId);
  const action = position && characterPosition(t, position).shipId === h.id ? "disembark" : "board";
  return (
    <>
      <p>
        Aboard:{" "}
        {aboard
          .map((p) => t.purses.find((c) => c.id === p.purseId)?.name ?? "Shared character")
          .join(", ") || "None"}
        . Characters left aboard travel with the ship; characters ashore remain in place.
      </p>
      <ActionForm
        title={dm ? "Move character aboard / ashore" : "Request boarding / disembarking"}
        disabled={s.mode === "sailing" || !purseId}
        label={
          dm ? (action === "board" ? "Board character" : "Disembark character") : "Submit request"
        }
        command={() => ({
          kind: "ship-board",
          propertyId: h.id,
          purseId,
          action,
          before: shipFingerprint(t, h.id),
        })}
      >
        <Field label="Boarding character">
          <SearchSelect aria-label="Boarding character" value={purseId} onValueChange={setPurse}>
            {chars.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SearchSelect>
        </Field>
        <p>Only the DM approves placement. Boarding gives no control over another character.</p>
      </ActionForm>
      <ShipBoardingReviews propertyId={h.id} />
    </>
  );
}
export function ShipBoardingReviews({ propertyId }: { propertyId?: string }) {
  const t = useEstateTable(),
    dm = useSeat().role === "dm",
    rows =
      t.journal?.fleet?.boarding.filter(
        (r) => r.status === "pending" && (!propertyId || r.propertyId === propertyId),
      ) ?? [];
  return (
    <>
      {rows.map((r) => (
        <article className="estate-record" key={r.id}>
          <p>
            {t.purses.find((p) => p.id === r.purseId)?.name}: {r.action}{" "}
            {t.holdings.find((h) => h.id === r.propertyId)?.name} · awaiting review
          </p>
          {dm &&
            [true, false].map((approve) => (
              <ActionForm
                key={String(approve)}
                title={`${approve ? "Approve" : "Deny"} ${r.action}`}
                command={() => ({ kind: "ship-board-review", requestId: r.id, before: r, approve })}
              >
                <span />
              </ActionForm>
            ))}
        </article>
      ))}
    </>
  );
}

export function ShipVoyageReviews() {
  const t = useEstateTable();
  if (useSeat().role !== "dm") return null;
  return (
    <>
      {t.journal?.fleet?.voyages
        .filter((v) => v.status === "proposed")
        .map((v) => (
          <article className="estate-record" key={v.id}>
            <h3>Proposed voyage · {t.holdings.find((h) => h.id === v.propertyId)?.name}</h3>
            <p>
              {locationLabel(readMarketLocations(t.journal?.market), v.originId)} →{" "}
              {locationLabel(readMarketLocations(t.journal?.market), v.destinationId)} ·{" "}
              {v.durationMinutes / 1440} days · {formatCopper(v.budgetCopper)} budget.
            </p>
            <p>{v.routeNotes}</p>
            <ActionForm
              title="Approve voyage"
              command={() => ({
                kind: "ship-voyage",
                before: v,
                voyage: { ...v, status: "active" },
              })}
            >
              <span />
            </ActionForm>
            <ActionForm
              title="Deny voyage"
              command={() => ({
                kind: "ship-voyage",
                before: v,
                voyage: { ...v, status: "denied" },
              })}
            >
              <span />
            </ActionForm>
          </article>
        ))}
    </>
  );
}
function Berthing({ holding: h, vessel: s }: { holding: Holding; vessel: Vessel }) {
  const t = useEstateTable(),
    seat = useSeat(),
    yards = readFleet(t.journal?.fleet).facilities.filter(
      (y) => y.locationId === h.locationId && facilityAccess(t, y, seat),
    );
  const [facilityId, setFacility] = useState(s.facilityId ?? ""),
    [mode, setMode] = useState<"docked" | "dry-storage" | "shipyard">(
      s.mode === "sailing" ? "docked" : s.mode,
    );
  return (
    <ActionForm
      title="Change ship storage / launch"
      disabled={s.mode === "sailing"}
      command={() => ({
        kind: "ship-berth",
        propertyId: h.id,
        before: shipFingerprint(t, h.id),
        facilityId: facilityId || null,
        mode,
      })}
    >
      <Field label="Ship facility">
        <SearchSelect aria-label="Ship facility" value={facilityId} onValueChange={setFacility}>
          <option value="">Moored without rented facility</option>
          {yards.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name} · {y.slots} slots · {y.maxDimensions}
            </option>
          ))}
        </SearchSelect>
      </Field>
      <Field label="Ship storage mode">
        <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="docked">Docked / launched afloat</option>
          <option value="dry-storage">Dry storage</option>
          <option value="shipyard">Shipyard work/storage</option>
        </Select>
      </Field>
      <p>
        Dry/yard storage requires a facility. Launch afloat before proposing travel. Leaving pauses
        linked yard work.
      </p>
    </ActionForm>
  );
}
function ShipWork({ holding: h, vessel: s }: { holding: Holding; vessel: Vessel }) {
  const t = useEstateTable(),
    seat = useSeat(),
    mine = t.purses.filter((p) => seat.role === "dm" || seat.purseIds.includes(p.id));
  const [kind, setKind] = useState("repair"),
    [componentId, setComponent] = useState(s.stats.components[0].id),
    [hp, setHp] = useState(1),
    [upgradeKey, setUpgrade] = useState(
      s.upgrades.find((u) => !s.installed.includes(u.key))?.key ?? "",
    ),
    [payerId, setPayer] = useState(mine[0]?.id ?? ""),
    [workers, setWorkers] = useState(1),
    [worker, setWorker] = useState(""),
    [share, setShare] = useState(100);
  const c = s.stats.components.find((c) => c.id === componentId)!,
    u = s.upgrades.find((u) => u.key === upgradeKey);
  return (
    <>
      <p>
        Installed upgrades:{" "}
        {s.installed.map((key) => s.upgrades.find((u) => u.key === key)?.name ?? key).join(", ") ||
          "None"}
        .
      </p>
      <ActionForm
        title="Propose ship work"
        disabled={!payerId || !s.facilityId || !["dry-storage", "shipyard"].includes(s.mode)}
        command={() => ({
          kind: "ship-work",
          propertyId: h.id,
          before: shipFingerprint(t, h.id),
          payerId,
          paidWorkers: workers,
          assignments: worker ? [{ purseId: worker, share }] : [],
          ...(kind === "repair" ? { componentId, hp } : { upgradeKey }),
        })}
      >
        <Field label="Ship work type">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="repair">Repair damaged component</option>
            <option value="upgrade">Install upgrade</option>
          </Select>
        </Field>
        {kind === "repair" ? (
          <>
            <Field label="Repair component">
              <SearchSelect
                aria-label="Repair component"
                value={componentId}
                onValueChange={setComponent}
              >
                {s.stats.components.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.maxHp - c.hp} HP missing
                  </option>
                ))}
              </SearchSelect>
            </Field>
            <NumberField
              label="HP to repair"
              value={hp}
              min={1}
              max={Math.max(1, c.maxHp - c.hp)}
              set={setHp}
            />
            <p>
              Quote: {formatCopper(hp * s.repairCopperPerHp)} full contractor cost ·{" "}
              {Math.ceil(hp / s.repairHpPerDay)} worker days · configured materials per HP.
            </p>
          </>
        ) : (
          <>
            <Field label="Ship upgrade">
              <SearchSelect aria-label="Ship upgrade" value={upgradeKey} onValueChange={setUpgrade}>
                <option value="">Choose upgrade</option>
                {s.upgrades
                  .filter((u) => !s.installed.includes(u.key))
                  .map((u) => (
                    <option key={u.key} value={u.key}>
                      {u.name}
                    </option>
                  ))}
              </SearchSelect>
            </Field>
            {u && (
              <p>
                Quote: {formatCopper(u.laborCopper)} full contractor cost · {u.laborDays} worker
                days · +{u.cargoWeight} lb cargo / +{u.hullHp} hull HP.
              </p>
            )}
          </>
        )}
        <Field label="Ship work payer">
          <SearchSelect aria-label="Ship work payer" value={payerId} onValueChange={setPayer}>
            {mine.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SearchSelect>
        </Field>
        <NumberField label="Paid shipwright workers" value={workers} max={100} set={setWorkers} />
        <Field label="Character repair worker">
          <SearchSelect
            aria-label="Character repair worker"
            value={worker}
            onValueChange={setWorker}
          >
            <option value="">No character labor</option>
            {mine
              .filter((p) => p.kind === "character")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </SearchSelect>
        </Field>
        {worker && (
          <NumberField
            label="Worker downtime share (%)"
            value={share}
            min={1}
            max={100}
            set={setShare}
          />
        )}
        <p>
          The DM approves the draft in existing Construction, upgrades & downtime work or Review
          Inbox. Reserved materials and labor share the existing project limits. Remote contractors
          require an authorized property manager.
        </p>
      </ActionForm>
    </>
  );
}
function Voyages({ holding: h, vessel: s }: { holding: Holding; vessel: Vessel }) {
  const t = useEstateTable(),
    seat = useSeat(),
    fleet = readFleet(t.journal?.fleet),
    rows = fleet.voyages.filter((v) => v.propertyId === h.id),
    ongoing = rows.some(
      (v) => !["arrived", "cancelled", "denied", "dm-overridden"].includes(v.status),
    );
  return (
    <>
      <p>
        Voyages progress only when the DM approves between-session downtime. Session hours do not
        advance a voyage. Cargo, minimum crew, damage, money and destination berths are rechecked.
      </p>
      {!ongoing && s.mode === "docked" && <VoyageForm key={h.locationId} holding={h} vessel={s} />}
      {rows.map((v) => (
        <article key={v.id} className="estate-record">
          <h4>
            {locationLabel(readMarketLocations(t.journal?.market), v.originId)} →{" "}
            {locationLabel(readMarketLocations(t.journal?.market), v.destinationId)}
          </h4>
          <p>
            {v.status} · {v.elapsedMinutes / 1440}/{v.durationMinutes / 1440} days ·{" "}
            {formatCopper(v.spentCopper)}/{formatCopper(v.budgetCopper)} travel budget · {v.message}
          </p>
          <p>{v.routeNotes}</p>
          {seat.role === "dm" && ["proposed", "blocked"].includes(v.status) && (
            <ActionForm
              title="Approve / resume voyage"
              command={() => ({
                kind: "ship-voyage",
                before: v,
                voyage: { ...v, status: "active" },
              })}
            >
              <span />
            </ActionForm>
          )}
          {seat.role === "dm" && v.status === "proposed" && (
            <ActionForm
              title="Deny voyage"
              command={() => ({
                kind: "ship-voyage",
                before: v,
                voyage: { ...v, status: "denied" },
              })}
            >
              <span />
            </ActionForm>
          )}
        </article>
      ))}
    </>
  );
}
function VoyageForm({ holding: h }: { holding: Holding; vessel: Vessel }) {
  const t = useEstateTable(),
    seat = useSeat(),
    dm = seat.role === "dm",
    fleet = readFleet(t.journal?.fleet),
    mine = t.purses.filter((p) => dm || seat.purseIds.includes(p.id)),
    market = readMarketLocations(t.journal?.market);
  const [destinationId, setDest] = useState(""),
    [facilityId, setFacility] = useState(""),
    [days, setDays] = useState(1),
    [budget, setBudget] = useState(0),
    [payerId, setPayer] = useState(mine.find((p) => p.id === h.purseId)?.id ?? mine[0]?.id ?? ""),
    [captainId, setCaptain] = useState(""),
    [crew, setCrew] = useState<string[]>([]),
    [notes, setNotes] = useState("");
  const chars = mine.filter(
    (p) => p.kind === "character" && characterPosition(t, p).shipId === h.id,
  );
  return (
    <ActionForm
      title="Propose downtime voyage"
      disabled={!h.locationId || !payerId}
      command={() => ({
        kind: "ship-voyage",
        before: null,
        voyage: {
          id: uid(),
          propertyId: h.id,
          originId: h.locationId!,
          destinationId,
          destinationFacilityId: facilityId || null,
          durationMinutes: Math.round(days * 1440),
          elapsedMinutes: 0,
          budgetCopper: budget,
          spentCopper: 0,
          travelExpenseRemainder: 0,
          payerId,
          captainId: captainId || null,
          crewPurseIds: crew,
          status: "proposed",
          message: "Awaiting DM review.",
          requestedBy: "local",
          routeVersion: 1,
          routeNotes: notes,
        } satisfies ShipVoyage,
      })}
    >
      <Field label="Voyage destination">
        <SearchSelect
          aria-label="Voyage destination"
          value={destinationId}
          onValueChange={(v) => {
            setDest(v);
            setFacility("");
          }}
          required
        >
          <option value="">Choose destination</option>
          {LocationOptions({ market })}
        </SearchSelect>
      </Field>
      <Field label="Arrival berth">
        <SearchSelect aria-label="Arrival berth" value={facilityId} onValueChange={setFacility}>
          <option value="">Moored without rented facility</option>
          {fleet.facilities
            .filter((y) => y.locationId === destinationId && facilityAccess(t, y, seat))
            .map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
        </SearchSelect>
      </Field>
      <NumberField
        label="Voyage downtime days"
        value={days}
        min={1 / 24}
        max={3650}
        step={1 / 24}
        set={setDays}
      />
      <NumberField label="Maximum travel budget (cp)" value={budget} set={setBudget} />
      <Field label="Voyage payer">
        <SearchSelect aria-label="Voyage payer" value={payerId} onValueChange={setPayer}>
          {mine.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SearchSelect>
      </Field>
      <Field label="Authorized hired captain">
        <SearchSelect
          aria-label="Authorized hired captain"
          value={captainId}
          onValueChange={setCaptain}
        >
          <option value="">Character crew will sail</option>
          {t.journal?.propertyOperations?.staff
            .filter((c) => c.propertyId === h.id && c.manager && c.status === "active")
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.role}
              </option>
            ))}
        </SearchSelect>
      </Field>
      {chars.map((p) => (
        <Check
          key={p.id}
          label={`${p.name} works as sailing crew`}
          checked={crew.includes(p.id)}
          set={(on) => setCrew((ids) => (on ? [...ids, p.id] : ids.filter((id) => id !== p.id)))}
        />
      ))}
      <Field label="Route / travel notes">
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <p>
        The DM reviews duration and outcomes. Use existing port exchanges or reviewed captain
        manager orders for actual trading; arrival does not create profit. Tile movement will be
        added later.
      </p>
    </ActionForm>
  );
}
function Overrides({ holding: h, vessel: s }: { holding: Holding; vessel: Vessel }) {
  const t = useEstateTable(),
    market = readMarketLocations(t.journal?.market),
    fleet = readFleet(t.journal?.fleet);
  const [componentId, setComponent] = useState(s.stats.components[0].id),
    [damage, setDamage] = useState(1),
    [reason, setReason] = useState(""),
    [destinationId, setDest] = useState(""),
    [facilityId, setFacility] = useState("");
  return (
    <>
      <ActionForm
        title="Record ship damage"
        command={() => ({
          kind: "ship-damage",
          propertyId: h.id,
          componentId,
          damage,
          reason,
          before: shipFingerprint(t, h.id),
        })}
      >
        <Field label="Damaged component">
          <SearchSelect
            aria-label="Damaged component"
            value={componentId}
            onValueChange={setComponent}
          >
            {s.stats.components.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SearchSelect>
        </Field>
        <NumberField label="Incoming damage" value={damage} min={1} set={setDamage} />
        <Field label="Damage reason">
          <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ActionForm>
      <ActionForm
        title="DM Override · Teleport Ship"
        label="Teleport ship, cargo and occupants"
        command={() => ({
          kind: "ship-teleport",
          propertyId: h.id,
          destinationId,
          facilityId: facilityId || null,
          before: shipFingerprint(t, h.id),
          reason,
        })}
      >
        <Field label="Teleport destination">
          <SearchSelect
            aria-label="Teleport destination"
            required
            value={destinationId}
            onValueChange={(v) => {
              setDest(v);
              setFacility("");
            }}
          >
            <option value="">Choose destination</option>
            {LocationOptions({ market })}
          </SearchSelect>
        </Field>
        <Field label="Teleport arrival berth">
          <SearchSelect
            aria-label="Teleport arrival berth"
            value={facilityId}
            onValueChange={setFacility}
          >
            <option value="">Moored without facility</option>
            {fleet.facilities
              .filter((y) => y.locationId === destinationId)
              .map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
          </SearchSelect>
        </Field>
        <Field label="Teleport reason (optional)">
          <TextArea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <p>
          Instantly moves all cargo and aboard characters. No downtime or travel expense. Bypasses
          crew and damage restrictions, closes the active voyage as DM overridden, and pauses former
          yard work. Destination berth capacity still applies.
        </p>
      </ActionForm>
    </>
  );
}
function Arrears({ holding: h, vessel: s }: { holding: Holding; vessel: Vessel }) {
  const t = useEstateTable(),
    seat = useSeat(),
    mine = t.purses.filter((p) => seat.role === "dm" || seat.purseIds.includes(p.id)),
    [payerId, setPayer] = useState(mine[0]?.id ?? "");
  return (
    <ActionForm
      title="Pay ship arrears"
      command={() => ({ kind: "ship-arrears", propertyId: h.id, payerId, copper: s.arrearsCopper })}
    >
      <Field label="Ship arrears payer">
        <SearchSelect value={payerId} onValueChange={setPayer}>
          {mine.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SearchSelect>
      </Field>
    </ActionForm>
  );
}
export function ShipyardWorkshop() {
  const t = useEstateTable(),
    seat = useSeat(),
    fleet = readFleet(t.journal?.fleet),
    [create, setCreate] = useState(false);
  if (seat.role !== "dm") return null;
  return (
    <Fold title="Docks & shipyards">
      <p>
        Add reviewed commercial docks, dry storage or shipyards at existing locations. Purchase
        private shipyards through estate listings using the Private shipyard template.
      </p>
      <Button onClick={() => setCreate((v) => !v)}>
        {create ? "Close new facility" : "Add dock / shipyard"}
      </Button>
      {create && <FacilityEditor before={null} />}
      {fleet.facilities
        .filter((y) => !y.propertyId)
        .map((y) => (
          <Fold title={y.name} key={y.id}>
            <FacilityEditor key={JSON.stringify(y)} before={y} />
          </Fold>
        ))}
    </Fold>
  );
}
function FacilityEditor({ before }: { before: ShipFacility | null }) {
  const t = useEstateTable(),
    market = readMarketLocations(t.journal?.market),
    [draft, set] = useState<ShipFacility>(
      before ?? {
        id: uid(),
        propertyId: null,
        name: "Commercial shipyard",
        locationId: market.currentLocationId ?? "",
        public: true,
        accessPurseIds: [],
        slots: 4,
        maxLengthFeet: 200,
        maxDimensions: "DM-reviewed ship sizes",
        dockCopper: 0,
        dryCopper: 0,
        yardCopper: 0,
        repair: true,
        upgrades: true,
      },
    );
  return (
    <ActionForm
      title="Review dock / shipyard"
      command={() => ({ kind: "ship-facility", before, facility: facilitySchema.parse(draft) })}
    >
      <Field label="Facility name">
        <TextInput
          required
          value={draft.name}
          onChange={(e) => set((d) => ({ ...d, name: e.target.value }))}
        />
      </Field>
      <Field label="Facility location">
        <SearchSelect
          required
          aria-label="Facility location"
          value={draft.locationId}
          onValueChange={(v) => set((d) => ({ ...d, locationId: v }))}
        >
          {LocationOptions({ market })}
        </SearchSelect>
      </Field>
      <Field label="Shipyard property">
        <SearchSelect
          aria-label="Shipyard property"
          value={draft.propertyId ?? ""}
          onValueChange={(v) =>
            set((d) => ({
              ...d,
              propertyId: v || null,
              public: v ? false : d.public,
              locationId: t.holdings.find((h) => h.id === v)?.locationId ?? d.locationId,
            }))
          }
        >
          <option value="">Commercial service · no owned parcel</option>
          {t.holdings
            .filter(
              (h) =>
                h.kind === "property" &&
                !t.journal?.fleet?.vessels.some((v) => v.propertyId === h.id),
            )
            .map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
        </SearchSelect>
      </Field>
      <NumberField
        label="Berth/storage slots"
        value={draft.slots}
        min={1}
        max={1000}
        set={(n) => set((d) => ({ ...d, slots: n }))}
      />
      <NumberField
        label="Maximum ship length (ft)"
        value={draft.maxLengthFeet}
        min={1}
        set={(n) => set((d) => ({ ...d, maxLengthFeet: n }))}
      />
      <Field label="Accepted ship dimensions / sizes">
        <TextInput
          value={draft.maxDimensions}
          onChange={(e) => set((d) => ({ ...d, maxDimensions: e.target.value }))}
        />
      </Field>
      {(
        [
          ["dockCopper", "Dock rental per day (cp)"],
          ["dryCopper", "Dry storage per day (cp)"],
          ["yardCopper", "Shipyard storage per day (cp)"],
        ] as const
      ).map(([key, label]) => (
        <NumberField
          key={key}
          label={label}
          value={draft[key]}
          set={(n) => set((d) => ({ ...d, [key]: n }))}
        />
      ))}
      <Check
        label="Public facility access"
        checked={draft.public}
        set={(v) => set((d) => ({ ...d, public: v }))}
      />
      <Check
        label="Repairs available"
        checked={draft.repair}
        set={(v) => set((d) => ({ ...d, repair: v }))}
      />
      <Check
        label="Upgrades available"
        checked={draft.upgrades}
        set={(v) => set((d) => ({ ...d, upgrades: v }))}
      />
    </ActionForm>
  );
}
