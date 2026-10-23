import { useEffect, useState } from "react";
import { useSeat } from "@/lib/quire/seat";
import { useEconomy } from "@/lib/quire/economy-context";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { formatCopper } from "@/lib/quire/money";
import type { CloudTable } from "@/lib/quire/cloud";
import type { Npc } from "@/lib/quire/world-schema";
import type { Shop } from "@/lib/quire/types";
import {
  readServices,
  serviceKinds,
  serviceProviderSchema,
  type ServiceComponent,
  type ServiceKind,
  type ServiceOffer,
  type ServiceOrder,
  type ServiceProvider,
} from "@/lib/quire/services-schema";
import {
  approvedOffers,
  offerSettlementLock,
  providerLock,
  providerSettlement,
  reviewChecks,
  serviceLabel,
  settlementNeeded,
} from "@/lib/quire/services";
import { applyPreset, newProvider, type ServicePreset } from "@/lib/quire/services-presets";
import { CommandForm, CommandButton } from "./world-tools";
import { Button, Fold } from "./ui";
import { AppLink } from "./app-link";
import { offerFlags, serviceWhen } from "./service-talk";

// DM setup and player views of temple, workshop and inn providers (docs/SERVICES.md).

const kindName: Record<ServiceKind, string> = { temple: "Temple", workshop: "Workshop", inn: "Inn" };
/** Kinds the DM can add in this release; later kinds arrive with their own presets. */
const addableKinds: ServiceKind[] = ["temple"];
const presetName: Record<ServicePreset, string> = { "srd-5.2.1": "SRD 5.2.1", "srd-5.1": "SRD 5.1", blank: "Blank" };

function npcName(t: CloudTable, id: string) {
  return t.journal?.world?.npcs.find((n) => n.id === id)?.name ?? "Unknown NPC";
}

/** The Services section of a shop page: offers, the viewer's orders, and the DM's setup. */
export function ShopServices({ shop, purseId }: { shop: Shop; purseId: string }) {
  const t = useWorldTable() as unknown as CloudTable,
    seat = useSeat(),
    dm = seat.role === "dm";
  const services = readServices(t.journal?.services);
  const providers = services.providers.filter((p) => p.shopId === shop.id);
  if (!providers.length && !dm) return null;
  return (
    <section className="world-card" aria-label="Services at this shop" id="services">
      <h2>Services</h2>
      <p>
        Spellcasting, commissions and rooms are ordered in conversation with the NPC who provides them, so they must be
        here. Effects are recorded only: the DM updates character sheets.
      </p>
      {providers.map((p) => (
        <ProviderCard key={p.id} provider={p} table={t} purseId={purseId} dm={dm} orders={services.orders} />
      ))}
      {dm && (
        <Fold title="Add a service provider">
          <AddProvider shop={shop} table={t} />
        </Fold>
      )}
    </section>
  );
}

function ProviderCard({
  provider: p,
  table: t,
  purseId,
  dm,
  orders,
}: {
  provider: ServiceProvider;
  table: CloudTable;
  purseId: string;
  dm: boolean;
  orders: ServiceOrder[];
}) {
  const lock = providerLock(t, p, purseId),
    mine = orders.filter((o) => o.providerId === p.id && (dm || o.purseId === purseId)),
    settlement = providerSettlement(t, p);
  return (
    <article className="svc-order" aria-label={`${serviceLabel(p)} · ${npcName(t, p.npcId)}`}>
      <h3>
        {serviceLabel(p)} · {npcName(t, p.npcId)}
      </h3>
      {p.description && <p>{p.description}</p>}
      <p className="svc-hint">
        {settlement.name} counts as a {settlement.kind}
        {p.settlement ? " (set by the DM)" : ""}. {p.paused ? `Not taking new orders: “${p.paused.reason}”` : ""}
      </p>
      <ul className="svc-offers" aria-label={`${serviceLabel(p)} offers`}>
        {approvedOffers(p).map((o) => {
          const locked = offerSettlementLock(t, p, o);
          return (
            <li key={o.key} className={locked ? "locked" : undefined}>
              <b>{o.name}</b>
              <span>{formatCopper(o.priceCopper)}</span>
              <small>{locked || offerFlags(o)}</small>
            </li>
          );
        })}
      </ul>
      {!dm && lock && <p role="status">{lock}</p>}
      <AppLink href={`/features/npcs?npc=${encodeURIComponent(p.npcId)}`}>Talk to {npcName(t, p.npcId)} →</AppLink>
      {mine.length > 0 && (
        <>
          <h4>{dm ? "Orders" : "Your orders here"}</h4>
          <ul className="svc-offers">
            {mine
              .slice()
              .reverse()
              .map((o) => (
                <li key={o.id}>
                  <span>
                    <b>{o.terms.offer.name}</b>
                    {o.terms.beneficiaries.length ? ` · ${o.terms.beneficiaries.map((b) => b.name).join(", ")}` : ""}
                  </span>
                  <span>{formatCopper(o.terms.priceCopper)}</span>
                  <small>
                    <span className={`svc-status ${o.status}`}>{o.status}</span> · {t.purses.find((x) => x.id === o.purseId)?.name ?? "A character"} ·
                    ordered {serviceWhen(o.orderedDay, o.orderedMinute)} · {o.message}
                  </small>
                </li>
              ))}
          </ul>
        </>
      )}
      {dm && (
        <Fold title={`Configure ${serviceLabel(p)}`}>
          <ProviderEditor key={canonicalJson(p)} provider={p} table={t} />
          <details>
            <summary>Remove this service</summary>
            <p>Resolve open orders first. Order history is kept.</p>
            <CommandButton input={{ kind: "service-provider", providerId: p.id, before: p, provider: null } as never}>
              Remove service provider
            </CommandButton>
          </details>
        </Fold>
      )}
    </article>
  );
}

function AddProvider({ shop, table: t }: { shop: Shop; table: CloudTable }) {
  const npcs = t.journal?.world?.npcs ?? [];
  const [kind, setKind] = useState<ServiceKind>(addableKinds[0]);
  const [npcId, setNpcId] = useState(npcs.find((n) => n.locationId === shop.locationId)?.id ?? npcs[0]?.id ?? "");
  const [preset, setPreset] = useState<ServicePreset>("srd-5.2.1");
  if (!shop.locationId) return <p>Give this shop a location first; the provider works there.</p>;
  if (!npcs.length) return <p>Create the NPC who provides the service in People & NPCs first.</p>;
  return (
    <CommandForm
      label="Add service provider"
      submit={() => {
        const id = `svc-${shop.id}-${kind}-${Date.now().toString(36)}`;
        return { kind: "service-provider", providerId: id, before: null, provider: newProvider(kind, shop, npcId, id, preset) } as never;
      }}
    >
      <label>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as ServiceKind)}>
          {addableKinds.map((k) => (
            <option key={k} value={k}>
              {kindName[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Provider NPC
        <select value={npcId} onChange={(e) => setNpcId(e.target.value)}>
          {npcs.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <p className="svc-hint">
        Must be present at {shop.name}, visible and not on downtime for players to order. Switch on this kind in the NPC's
        record (People & NPCs) as well.
      </p>
      <PresetChoice value={preset} onChange={setPreset} />
    </CommandForm>
  );
}

function PresetChoice({ value, onChange }: { value: ServicePreset; onChange: (p: ServicePreset) => void }) {
  return (
    <div>
      <span>Price preset</span>
      <div className="svc-seg" role="group" aria-label="Price preset">
        {(["srd-5.2.1", "srd-5.1", "blank"] as const).map((p) => (
          <button key={p} type="button" aria-pressed={value === p} onClick={() => onChange(p)}>
            {presetName[p]}
          </button>
        ))}
      </div>
      <p className="svc-hint">
        {value === "srd-5.1"
          ? "SRD 5.1 gives no fixed rates (1st–2nd level “might cost 10 to 50 gold pieces”). It fills levels 1–2 at 50 gp and leaves higher levels as unpriced drafts for you to set."
          : value === "blank"
            ? "No offers: add your own."
            : "SRD 5.2.1 Spellcasting Services prices plus each spell's component. Applying a preset fills missing offers and unset prices only; edited prices stay."}
      </p>
    </div>
  );
}

const copperLabel = (n: number) => (n ? formatCopper(n) : "unpriced");

function ProviderEditor({ provider, table: t }: { provider: ServiceProvider; table: CloudTable }) {
  const [draft, setDraft] = useState<ServiceProvider>(() => structuredClone(provider));
  const [preset, setPreset] = useState<ServicePreset>(provider.preset);
  const set = (patch: Partial<ServiceProvider>) => setDraft((d) => ({ ...d, ...patch }));
  const setOffer = (key: string, patch: Partial<ServiceOffer>) =>
    setDraft((d) => ({ ...d, offers: d.offers.map((o) => (o.key === key ? { ...o, ...patch } : o)) }));
  const settlement = providerSettlement(t, provider);
  return (
    <CommandForm
      label="Save provider"
      dirty={canonicalJson(draft) !== canonicalJson(provider)}
      submit={() => {
        const parsed = serviceProviderSchema.safeParse(draft);
        if (!parsed.success) throw Error(`Check the provider: ${parsed.error.issues[0]?.message ?? "invalid field"}.`);
        return { kind: "service-provider", providerId: provider.id, before: provider, provider: parsed.data } as never;
      }}
    >
      <div className="svc-editor">
        <div className="svc-grid">
          <label>
            Name players see
            <input value={draft.name} maxLength={160} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            Description
            <input value={draft.description} maxLength={1500} onChange={(e) => set({ description: e.target.value })} />
          </label>
        </div>
        <div>
          <PresetChoice value={preset} onChange={setPreset} />
          <Button variant="secondary" onClick={() => setDraft((d) => applyPreset(d, preset))}>
            Apply {presetName[preset]} preset
          </Button>
        </div>
        <label>
          Settlement
          <select
            value={draft.settlement ?? ""}
            onChange={(e) => set({ settlement: (e.target.value || undefined) as ServiceProvider["settlement"] })}
          >
            <option value="">From Market locations ({settlement.name} · {provider.settlement ? "derived" : settlement.kind})</option>
            <option value="village">Village (spell levels 0–2)</option>
            <option value="town">Town (levels 0–5)</option>
            <option value="city">City (levels 0–9)</option>
          </select>
          <span className="svc-hint">The nearest town or city above the shop in Market locations, otherwise a village.</span>
        </label>
        <div className="svc-grid">
          <label className="svc-check">
            <input
              type="checkbox"
              checked={!!draft.paused}
              onChange={(e) => set({ paused: e.target.checked ? { reason: draft.paused?.reason || "Not taking orders today." } : undefined })}
            />
            Not taking new orders
          </label>
          {draft.paused && (
            <label>
              Reason shown to players
              <input value={draft.paused.reason} maxLength={500} onChange={(e) => set({ paused: { reason: e.target.value } })} />
            </label>
          )}
          <label>
            Review anything above (copper, optional)
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={draft.reviewAboveCopper ?? ""}
              onChange={(e) => set({ reviewAboveCopper: e.target.value === "" ? undefined : Math.max(0, Math.floor(Number(e.target.value))) })}
            />
            <span className="svc-hint">
              {draft.reviewAboveCopper === undefined ? "Off." : `Orders over ${formatCopper(draft.reviewAboveCopper)} wait for your review.`}
            </span>
          </label>
        </div>
        <div>
          <h4>Offers</h4>
          <p className="svc-hint">Switch on to approve. Players never see drafts. Open a row to edit it.</p>
          <ul className="svc-offer-list">
            {draft.offers.map((o) => (
              <li key={o.key}>
                <OfferEditor
                  kind={draft.kind}
                  offer={o}
                  onChange={(patch) => setOffer(o.key, patch)}
                  onRemove={() => setDraft((d) => ({ ...d, offers: d.offers.filter((x) => x.key !== o.key) }))}
                />
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            onClick={() =>
              setDraft((d) => {
                let n = d.offers.length + 1;
                while (d.offers.some((o) => o.key === `custom-${n}`)) n++;
                return {
                  ...d,
                  offers: [
                    ...d.offers,
                    {
                      key: `custom-${n}`,
                      name: "New offer",
                      description: "",
                      approved: false,
                      priceCopper: 0,
                      time: { kind: "instant" },
                      review: "auto",
                      output: { kind: "record" },
                    },
                  ],
                };
              })
            }
          >
            Add offer
          </Button>
        </div>
      </div>
    </CommandForm>
  );
}

function OfferEditor({
  kind,
  offer: o,
  onChange,
  onRemove,
}: {
  kind: ServiceKind;
  offer: ServiceOffer;
  onChange: (patch: Partial<ServiceOffer>) => void;
  onRemove: () => void;
}) {
  const setComponent = (key: string, patch: Partial<ServiceComponent>) =>
    onChange({ components: (o.components ?? []).map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const summary = [
    o.spellLevel !== undefined ? `Level ${o.spellLevel}` : "",
    o.approved ? "" : "Draft",
    o.review === "dm" ? "DM review" : "automatic",
    ...(o.components ?? []).map((c) => `${c.label.toLowerCase()} ${formatCopper(c.minCopper)}+`),
    o.spellLevel !== undefined && settlementNeeded(o.spellLevel) !== "village" ? `needs a ${settlementNeeded(o.spellLevel)}` : "",
  ].filter(Boolean);
  return (
    <details className={`svc-offer-row${o.approved ? "" : " draft"}`}>
      <summary>
        <b>{o.name}</b>
        <span className="svc-price">{copperLabel(o.priceCopper)}</span>
        <small>{summary.join(" · ")}</small>
      </summary>
      <div className="svc-offer-body">
        <label className="svc-check">
          <input type="checkbox" checked={o.approved} onChange={(e) => onChange({ approved: e.target.checked })} />
          Approved: players can order {o.name}
        </label>
        <div className="svc-grid">
          <label>
            Name players see
            <input value={o.name} maxLength={160} onChange={(e) => onChange({ name: e.target.value })} />
          </label>
          <label>
            Price (copper)
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={o.priceCopper}
              onChange={(e) => onChange({ priceCopper: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            />
            <span className="svc-hint">{copperLabel(o.priceCopper)}</span>
          </label>
        </div>
        <label>
          Description
          <textarea value={o.description} maxLength={1500} onChange={(e) => onChange({ description: e.target.value })} />
        </label>
        {kind === "temple" && (
          <div className="svc-grid">
            <label>
              Spell level
              <select
                value={o.spellLevel ?? ""}
                onChange={(e) => onChange({ spellLevel: e.target.value === "" ? undefined : Number(e.target.value) })}
              >
                <option value="">None</option>
                {Array.from({ length: 10 }, (_, i) => (
                  <option key={i} value={i}>
                    {i === 0 ? "Cantrip" : `Level ${i}`} (needs a {settlementNeeded(i)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Casting time noted on the receipt (minutes)
              <input
                type="number"
                min={0}
                max={14400}
                step={1}
                value={o.time.kind === "instant" ? (o.time.castingMinutes ?? 0) : 0}
                onChange={(e) => {
                  const m = Math.min(14400, Math.max(0, Math.floor(Number(e.target.value) || 0)));
                  onChange({ time: { kind: "instant", ...(m ? { castingMinutes: m } : {}) } });
                }}
              />
              <span className="svc-hint">The campaign clock never advances on its own.</span>
            </label>
          </div>
        )}
        <div>
          <span>Review</span>
          <div className="svc-seg" role="group" aria-label={`Review: ${o.name}`}>
            {(["auto", "dm"] as const).map((r) => (
              <button key={r} type="button" aria-pressed={o.review === r} onClick={() => onChange({ review: r })}>
                {r === "auto" ? "Automatic" : "DM review"}
              </button>
            ))}
          </div>
          <p className="svc-hint">
            {o.review === "dm"
              ? "The request waits in your Review Inbox and is charged only when you approve."
              : "Paid and recorded when the player orders."}
          </p>
        </div>
        {(o.components ?? []).map((c) => (
          <fieldset key={c.key} className="svc-grid">
            <legend>Component · {c.label}</legend>
            <label>
              Item
              <input value={c.label} maxLength={160} onChange={(e) => setComponent(c.key, { label: e.target.value })} />
            </label>
            <label>
              Minimum value (copper)
              <input
                type="number"
                min={0}
                step={1}
                value={c.minCopper}
                onChange={(e) => setComponent(c.key, { minCopper: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
              />
              <span className="svc-hint">{formatCopper(c.minCopper)}</span>
            </label>
            <label className="svc-check">
              <input type="checkbox" checked={c.consumed} onChange={(e) => setComponent(c.key, { consumed: e.target.checked })} />
              Consumed when the service is paid
            </label>
            <label>
              Who supplies it
              <select value={c.supply} onChange={(e) => setComponent(c.key, { supply: e.target.value as ServiceComponent["supply"] })}>
                <option value="either">Either: party brings one, or the provider adds its cost</option>
                <option value="party">Party must bring one</option>
                <option value="provider">Provider always supplies (cost added)</option>
              </select>
            </label>
            {c.supply !== "party" && (
              <label>
                Provider's price (copper)
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={c.supplyCopper}
                  onChange={(e) => setComponent(c.key, { supplyCopper: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                />
                <span className="svc-hint">{formatCopper(c.supplyCopper)}</span>
              </label>
            )}
          </fieldset>
        ))}
        <Button variant="danger" onClick={onRemove}>
          Remove {o.name}
        </Button>
      </div>
    </details>
  );
}

/** NPC record: which service kinds this NPC offers. The forge keeps its own checkbox. */
export function NpcServicesToggle({ npc, table: t }: { npc: Npc; table: CloudTable }) {
  const [kinds, setKinds] = useState<ServiceKind[]>(npc.services ?? []);
  useEffect(() => setKinds(npc.services ?? []), [npc.services]);
  const providers = readServices(t.journal?.services).providers.filter((p) => p.npcId === npc.id);
  if (!providers.length && !npc.services?.length) return null;
  return (
    <CommandForm
      label={`Save ${npc.name} service permissions`}
      dirty={canonicalJson(kinds) !== canonicalJson(npc.services ?? [])}
      submit={() => ({ kind: "npc-save", before: npc, npc: { ...npc, services: serviceKinds.filter((k) => kinds.includes(k)) } }) as never}
    >
      <p>Services this NPC provides. Turning a kind off locks it in conversation; orders and history are kept.</p>
      {serviceKinds.map((k) => {
        const mine = providers.filter((p) => p.kind === k);
        return (
          <label key={k}>
            <input
              type="checkbox"
              checked={kinds.includes(k)}
              onChange={(e) => setKinds((c) => (e.target.checked ? [...c, k] : c.filter((x) => x !== k)))}
            />{" "}
            {kindName[k]} · {npc.name}
            {mine.map((p) => (
              <small key={p.id}>
                {" "}
                · {serviceLabel(p)} at{" "}
                <AppLink href={`/shop/${encodeURIComponent(p.shopId)}#services`}>{t.shops.find((s) => s.id === p.shopId)?.name ?? "its shop"}</AppLink>
                {" "}({approvedOffers(p).length} approved)
              </small>
            ))}
          </label>
        );
      })}
    </CommandForm>
  );
}

/** Review Inbox: service requests (DM decides; players see and can withdraw their own). */
export function ServiceRequests() {
  const t = useWorldTable() as unknown as CloudTable,
    seat = useSeat(),
    dm = seat.role === "dm";
  const orders = readServices(t.journal?.services).orders.filter(
    (o) => o.history.some((h) => h.status === "requested") && (dm || seat.purseIds.includes(o.purseId)),
  );
  const pending = orders.filter((o) => o.status === "requested");
  const decided = orders.filter((o) => o.status !== "requested").slice(-5).reverse();
  if (!orders.length) return null;
  return (
    <section aria-label="Service requests">
      <h3>Service requests · {pending.length} pending</h3>
      <p className="svc-hint">
        {dm
          ? "Approving a service request reruns every check, charges the payer once and consumes any components. Denying moves nothing. Effects are recorded only: edit sheets yourself."
          : "Requests wait here for the DM. Nothing is charged until the DM approves."}
      </p>
      {pending.map((o) => (
        <ServiceRequestRow key={o.id} order={o} table={t} dm={dm} />
      ))}
      {decided.length > 0 && (
        <details>
          <summary>Recently decided service requests</summary>
          {decided.map((o) => (
            <p key={o.id}>
              <span className={`svc-status ${o.status}`}>{o.status}</span> {o.terms.offer.name} ·{" "}
              {t.purses.find((p) => p.id === o.purseId)?.name ?? "A character"} · {formatCopper(o.terms.priceCopper)} · {o.message}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}

function ServiceRequestRow({ order: o, table: t, dm }: { order: ServiceOrder; table: CloudTable; dm: boolean }) {
  const { commandOutcome } = useEconomy();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const checks = dm ? reviewChecks(t, o) : [];
  const payer = t.purses.find((p) => p.id === o.purseId)?.name ?? "A character";
  const brought = o.terms.components.map((c) =>
    c.supplied === "party" ? `${c.label}: ${payer}'s own (${c.holdingName ?? c.label})` : `${c.label}: supplied (+${formatCopper(c.copper)})`,
  );
  async function run(input: Record<string, unknown>, id: string) {
    setBusy(true);
    setError("");
    try {
      await commandOutcome({ ...input, id } as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Nothing changed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="svc-inbox-row" aria-label={`Service request ${o.terms.offer.name}`}>
      <span className={`svc-status requested`}>Service request</span> <span className="svc-flag">{o.terms.kind === "temple" ? "Temple" : serviceLabel({ kind: o.terms.kind, specialty: o.terms.specialty })}</span>{" "}
      <span className="svc-flag">{serviceWhen(o.orderedDay, o.orderedMinute)}</span>
      <h4>
        {o.terms.offer.name}
        {o.terms.beneficiaries.length ? ` on ${o.terms.beneficiaries.map((b) => b.name).join(", ")}` : ""} · {formatCopper(o.terms.priceCopper)}
      </h4>
      <p className="svc-meta">
        {payer} asks {o.terms.npcName} at {o.terms.shopName}, {o.terms.placeName}.{brought.length ? ` ${brought.join(". ")}.` : ""}
      </p>
      {dm ? (
        <>
          <p className="svc-hint">Rechecked now (runs again on approve):</p>
          <ul className="svc-checks">
            {checks.map((c, i) => (
              <li key={i} className={c.ok ? undefined : "no"}>
                {c.text}
              </li>
            ))}
          </ul>
          <p className="svc-hint">
            Approving pays {o.terms.shopName} <b>{formatCopper(o.terms.priceCopper)}</b> from {payer} (one ledger line)
            {o.terms.components.some((c) => c.consumed && c.supplied === "party") ? " and consumes the item they bring" : ""}. It does not change any
            sheet.
          </p>
          <label>
            Note to the player (optional on approve, required on deny)
            <textarea value={note} maxLength={900} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="svc-buttons">
            <Button
              disabled={busy || checks.some((c) => !c.ok)}
              onClick={() => void run({ kind: "service-review", orderId: o.id, before: o, decision: "approve", reason: note.trim() }, `${o.id}-approve`)}
            >
              Approve · charge {formatCopper(o.terms.priceCopper)}
            </Button>
            <Button
              variant="danger"
              disabled={busy || !note.trim()}
              onClick={() => void run({ kind: "service-review", orderId: o.id, before: o, decision: "deny", reason: note.trim() }, `${o.id}-deny`)}
            >
              Deny · moves nothing
            </Button>
          </div>
          {checks.some((c) => !c.ok) && <p className="svc-hint">Approve stays disabled until every check passes. Deny with a reason, or leave it open.</p>}
        </>
      ) : (
        <div className="svc-buttons">
          <p className="svc-hint">Waiting for the DM. Nothing has been charged.</p>
          <Button variant="secondary" disabled={busy} onClick={() => void run({ kind: "service-cancel", orderId: o.id, before: o }, `${o.id}-cancel`)}>
            Withdraw request
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
