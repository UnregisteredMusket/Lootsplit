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
  isLinkKind,
  readServices,
  serviceKinds,
  serviceProviderSchema,
  type HireRole,
  type ServiceComponent,
  type ServiceKind,
  type ServiceOffer,
  type ServiceOrder,
  type ServiceProvider,
} from "@/lib/quire/services-schema";
import {
  approvedOffers,
  serviceKindNames,
  offerSettlementLock,
  providerLock,
  providerSettlement,
  reviewChecks,
  serviceLabel,
  settlementNeeded,
} from "@/lib/quire/services";
import { applyPreset, fenceShopPreset, newProvider, workshopSpecialties, type ServicePreset } from "@/lib/quire/services-presets";
import { presentAt } from "@/lib/quire/service-core";
import { CommandForm, CommandButton } from "./world-tools";
import { Button, Fold } from "./ui";
import { AppLink } from "./app-link";
import { offerFlags, serviceWhen } from "./service-talk";

// DM setup and player views of temple, workshop and inn providers (docs/SERVICES.md).

const kindName = serviceKindNames;
/** Kinds the DM can add in this release; later kinds arrive with their own presets. */
const addableKinds: ServiceKind[] = ["temple", "workshop", "inn", "sage", "fence", "bank", "hire"];
/** What each kind's toggle in the NPC record says. */
const kindHint: Partial<Record<ServiceKind, string>> = {
  sage: "Identify a carried item; you write the answer.",
  fence: "Opens a black-market shop's Sell tab.",
  bank: "Opens a loan request naming this bank.",
  hire: "Proposes a property staff contract.",
};
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
      {isLinkKind(p.kind) && <LinkSummary provider={p} table={t} />}
      <ul className="svc-offers" aria-label={`${serviceLabel(p)} offers`} hidden={isLinkKind(p.kind)}>
        {approvedOffers(p).map((o) => {
          const locked = offerSettlementLock(t, p, o);
          return (
            <li key={o.key} className={locked ? "locked" : undefined}>
              <b>{o.name}</b>
              <span>
                {p.kind === "inn" && o.tiers?.length
                  ? `from ${formatCopper(Math.min(...o.tiers.filter((x) => x.offered).map((x) => x.nightCopper)))}/night`
                  : formatCopper(o.priceCopper)}
              </span>
              <small>{locked || offerFlags(o)}</small>
            </li>
          );
        })}
      </ul>
      {(p.rumours?.length ?? 0) > 0 && (
        <p className="svc-hint">
          {p.rumours!.length} {p.rumours!.length === 1 ? "rumour" : "rumours"} for sale. Ask in conversation.
        </p>
      )}
      {!dm && lock && <p role="status">{lock}</p>}
      <AppLink href={`/features/npcs?npc=${encodeURIComponent(p.npcId)}`}>Talk to {npcName(t, p.npcId)} →</AppLink>
      {mine.length > 0 && (
        <>
          <h4>{dm ? "Orders" : "Your orders here"}</h4>
          {mine
            .filter((o) => o.terms.workDays > 0 && o.status !== "requested")
            .slice()
            .reverse()
            .map((o) => (
              <ServiceOrderCard key={o.id} order={o} table={t} dm={dm} />
            ))}
          <ul className="svc-offers">
            {mine
              .filter((o) => !(o.terms.workDays > 0 && o.status !== "requested"))
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
  const [specialty, setSpecialty] = useState<string>(workshopSpecialties[0]);
  if (!shop.locationId) return <p>Give this shop a location first; the provider works there.</p>;
  if (!npcs.length) return <p>Create the NPC who provides the service in People & NPCs first.</p>;
  return (
    <CommandForm
      label="Add service provider"
      submit={() => {
        const id = `svc-${shop.id}-${kind}-${Date.now().toString(36)}`;
        const provider = newProvider(kind, shop, npcId, id, preset, kind === "workshop" ? specialty.trim() || undefined : undefined);
        return { kind: "service-provider", providerId: id, before: null, provider } as never;
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
      {kind === "workshop" && (
        <label>
          Workshop preset
          <select
            value={(workshopSpecialties as readonly string[]).includes(specialty) ? specialty : ""}
            onChange={(e) => setSpecialty(e.target.value)}
          >
            {workshopSpecialties.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
            <option value="">Other (no preset offers)</option>
          </select>
        </label>
      )}
      <p className="svc-hint">
        Must be present at {shop.name}, visible and not on downtime for players to order. Switch on this kind in the NPC's
        record (People & NPCs) as well.
      </p>
      <PresetChoice value={preset} onChange={setPreset} kind={kind} />
    </CommandForm>
  );
}

function PresetChoice({ value, onChange, kind = "temple" }: { value: ServicePreset; onChange: (p: ServicePreset) => void; kind?: ServiceKind }) {
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
        {kind === "sage"
          ? value === "blank"
            ? "No offers: add your own."
            : "Identify at 50 gp (SRD 5.2.1, a level 1 spell; SRD 5.1's top of 10–50 gp). The pearl is the sage's own and isn't consumed. DM review: you write the answer."
          : kind === "fence"
          ? "A fence has no price list: it buys at its shop's rate. Apply the fence preset to the shop below."
          : kind === "bank"
          ? value === "blank"
            ? "No starting terms: you set every loan yourself."
            : "Starting terms for loans that name this bank: 5% simple every 30 days, up to 500 gp (a house default; the SRD has no lending rule)."
          : kind === "hire"
          ? value === "blank"
            ? "No roles: add your own."
            : "SRD 5.2.1 hireling pay: a skilled guard at 2 gp a day and an untrained porter at 2 sp a day (the same in SRD 5.1)."
          : kind === "workshop"
          ? value === "srd-5.1"
            ? "SRD 5.1 has no scroll-scribing rule, so scrolls stay unpriced drafts; brews take the SRD 5.1 crafting pace (5 gp of work a day)."
            : value === "blank"
              ? "No offers: add your own."
              : "SRD 5.2.1: scrolls at twice the scribing cost and its days (the scroll's value); a Potion of Healing takes a day, other brews the crafting rule (price in gp ÷ 10 days). A tailor makes clothes from the SRD 5.1 equipment list by the same rule, with half the price in cloth the party may bring. Applying a preset fills missing offers and unset prices only."
          : value === "srd-5.1"
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
        {isLinkKind(draft.kind) && (
          <LinkEditor provider={draft} table={t} onChange={(link) => set({ link })} />
        )}
        <div>
          <PresetChoice value={preset} onChange={setPreset} kind={draft.kind} />
          <Button variant="secondary" onClick={() => setDraft((d) => applyPreset(d, preset))}>
            Apply {presetName[preset]} preset
          </Button>
        </div>
        <label hidden={isLinkKind(draft.kind)}>
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
          <label hidden={isLinkKind(draft.kind)}>
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
        <div hidden={isLinkKind(draft.kind)}>
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
                      ...(d.kind === "inn"
                        ? {
                            time: { kind: "per-night" as const, maxNights: 14 },
                            output: { kind: "record" as const },
                            tiers: [{ key: "room", name: "Room", nightCopper: 50, mealCopper: 10, offered: true }],
                          }
                        : d.kind === "workshop"
                        ? {
                            time: { kind: "downtime-days" as const, days: 1, perUnit: true },
                            maxUnits: 1,
                            output: { kind: "holding" as const, name: "New item", unitCopper: 0, weight: 0, category: "service", notes: "" },
                          }
                        : d.kind === "sage"
                        ? { time: { kind: "instant" as const }, output: { kind: "record" as const }, target: "held-item" as const }
                        : { time: { kind: "instant" as const }, output: { kind: "record" as const } }),
                      review: d.kind === "sage" ? "dm" : "auto",
                    },
                  ],
                };
              })
            }
          >
            Add offer
          </Button>
        </div>
        {draft.kind === "inn" && (
          <RumourEditor rumours={draft.rumours ?? []} onChange={(rumours) => set({ rumours })} />
        )}
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
        <span className="svc-price">
          {kind === "inn" && o.tiers?.length ? `from ${formatCopper(Math.min(...o.tiers.map((x) => x.nightCopper)))}/night` : copperLabel(o.priceCopper)}
        </span>
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
          {kind !== "inn" && (
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
          )}
        </div>
        {kind === "inn" && <InnFields offer={o} onChange={onChange} />}
        <label>
          Description
          <textarea value={o.description} maxLength={1500} onChange={(e) => onChange({ description: e.target.value })} />
        </label>
        {kind !== "inn" && (
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
            {o.target === "held-item" && (
              <label>
                Target
                <select value="held-item" disabled>
                  <option value="held-item">A carried item of the payer</option>
                </select>
                <span className="svc-hint">DM review: you write what the {kind === "sage" ? "sage" : "priest"} says when you approve.</span>
              </label>
            )}
            {kind === "temple" && <label>
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
            </label>}
          </div>
        )}
        {kind === "workshop" && o.time.kind === "downtime-days" && o.output.kind === "holding" && (
          <WorkshopFields offer={o} onChange={onChange} />
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
      {serviceKinds.filter((k) => addableKinds.includes(k) || kinds.includes(k)).map((k) => {
        const mine = providers.filter((p) => p.kind === k);
        return (
          <label key={k}>
            <input
              type="checkbox"
              checked={kinds.includes(k)}
              onChange={(e) => setKinds((c) => (e.target.checked ? [...c, k] : c.filter((x) => x !== k)))}
            />{" "}
            {kindName[k]} · {npc.name}
            {isLinkKind(k) && <small> · Link only, no new money path. {kindHint[k]}</small>}
            {!isLinkKind(k) && kindHint[k] && <small> · {kindHint[k]}</small>}
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
  /** Identify: the answer, and the two optional item updates. */
  const [answer, setAnswer] = useState("");
  const [appendToNotes, setAppendToNotes] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [rename, setRename] = useState(o.terms.item?.name ?? "");
  const item = o.terms.item ? t.holdings.find((h) => h.id === o.terms.item!.holdingId) : undefined;
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
        {o.terms.item ? ` ${o.terms.item.name}` : ""}
        {o.terms.beneficiaries.length ? ` on ${o.terms.beneficiaries.map((b) => b.name).join(", ")}` : ""} · {formatCopper(o.terms.priceCopper)}
      </h4>
      <p className="svc-meta">
        {payer} asks {o.terms.npcName} at {o.terms.shopName}, {o.terms.placeName}.{brought.length ? ` ${brought.join(". ")}.` : ""}
        {o.terms.item ? ` Item notes now: “${item?.notes || o.terms.item.notesBefore || "none"}”` : ""}
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
          {o.terms.item && (
            <div className="svc-editor">
              <label>
                What {o.terms.npcName} says (the player receives this)
                <textarea value={answer} maxLength={2000} onChange={(e) => setAnswer(e.target.value)} />
              </label>
              <label className="svc-check">
                <input type="checkbox" checked={appendToNotes} onChange={(e) => setAppendToNotes(e.target.checked)} />
                Add this to the item's notes <small>Appends a dated line; the old notes stay.</small>
              </label>
              <label className="svc-check">
                <input type="checkbox" checked={renaming} onChange={(e) => setRenaming(e.target.checked)} />
                Rename the item
              </label>
              {renaming && (
                <label>
                  New name
                  <input value={rename} maxLength={160} onChange={(e) => setRename(e.target.value)} />
                </label>
              )}
            </div>
          )}
          <p className="svc-hint">
            {o.terms.item
              ? `Approving charges ${payer} ${formatCopper(o.terms.priceCopper)} once and posts the answer to ${payer}'s thread with ${o.terms.npcName}${appendToNotes || renaming ? `; the same command updates the item's ${[appendToNotes ? "notes" : "", renaming ? "name" : ""].filter(Boolean).join(" and ")}` : ""}. Attunement and charges are not touched.`
              : null}
          </p>
          <p className="svc-hint" hidden={!!o.terms.item}>
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
              disabled={busy || checks.some((c) => !c.ok) || (!!o.terms.item && (!answer.trim() || (renaming && !rename.trim())))}
              onClick={() =>
                void run(
                  {
                    kind: "service-review",
                    orderId: o.id,
                    before: o,
                    decision: "approve",
                    reason: note.trim(),
                    ...(o.terms.item
                      ? { reveal: { text: answer.trim(), appendToNotes, ...(renaming && rename.trim() ? { rename: rename.trim() } : {}) } }
                      : {}),
                  },
                  `${o.id}-approve`,
                )
              }
            >
              {o.terms.item ? "Answer" : "Approve"} · charge {formatCopper(o.terms.priceCopper)}
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

/** A workshop order: progress over approved downtime, collection at the workshop, DM control. */
export function ServiceOrderCard({ order: o, table: t, dm }: { order: ServiceOrder; table: CloudTable; dm: boolean }) {
  const { commandOutcome } = useEconomy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState<"pause" | "resume" | "cancel">(o.status === "paused" ? "resume" : "pause");
  const [reason, setReason] = useState("");
  const out = o.terms.offer.output;
  const title = `${out.kind === "holding" ? out.name : o.terms.offer.name}${o.terms.units > 1 ? ` ×${o.terms.units}` : ""}`;
  const payer = t.purses.find((p) => p.id === o.purseId)?.name ?? "the paying character";
  const here = presentAt(t, o.terms.locationId, o.purseId);
  const pct = o.terms.workDays ? Math.round((100 * o.progressDays) / o.terms.workDays) : 100;
  const open = ["active", "paused", "ready"].includes(o.status);
  async function run(input: Record<string, unknown>, id: string) {
    setBusy(true);
    setError("");
    try {
      await commandOutcome({ ...input, id } as never);
      setReason("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Nothing changed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="svc-order world-card" aria-label={`Commission ${title}`}>
      <h4>
        {title} <span className={`svc-status ${o.status}`}>{o.status}</span>
      </h4>
      <div
        className={`svc-bar${o.status === "ready" || o.status === "claimed" ? " ready" : o.status === "paused" ? " paused" : ""}`}
        role="progressbar"
        aria-label={`${title} progress`}
        aria-valuemin={0}
        aria-valuemax={o.terms.workDays}
        aria-valuenow={o.progressDays}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="svc-days">
        <span>
          {o.progressDays}/{o.terms.workDays} approved downtime days
        </span>
        <span>
          {payer} · paid {formatCopper(o.terms.priceCopper)}
        </span>
      </div>
      <p className="svc-hint">
        Ordered {serviceWhen(o.orderedDay, o.orderedMinute)} · {o.terms.npcName} · pickup at {o.terms.shopName}, {o.terms.placeName}.
      </p>
      <p className="svc-hint">{o.message}</p>
      <details>
        <summary className="svc-hint">Commission terms & provenance</summary>
        <p className="svc-hint">
          Terms fixed {serviceWhen(o.orderedDay, o.orderedMinute)}: {o.terms.units} × {out.kind === "holding" ? out.name : o.terms.offer.name}
          {out.kind === "holding" ? `, value ${formatCopper(out.unitCopper)} each` : ""}, {o.terms.workDays} days, by {o.terms.npcName} at{" "}
          {o.terms.shopName}.{" "}
          {o.terms.components.map((c) => `${c.quantity} × ${c.label} ${c.supplied === "party" ? `brought by ${payer}` : "supplied"}`).join(", ")}
          {o.terms.components.length ? ". " : ""}Order {o.id}.
        </p>
      </details>
      {o.status === "ready" &&
        (here ? (
          <Button disabled={busy} onClick={() => void run({ kind: "service-claim", orderId: o.id, before: o }, `${o.id}-claim`)}>
            Collect {title}
          </Button>
        ) : (
          <p className="svc-hint">
            Return to {o.terms.shopName} in {o.terms.placeName} with {payer} to collect.
          </p>
        ))}
      {dm && open && (
        <div className="svc-editor">
          <label>
            Commission control
            <select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
              {o.status === "active" && <option value="pause">Pause work</option>}
              {o.status === "paused" && <option value="resume">Resume work</option>}
              <option value="cancel">Cancel · refund or salvage separately</option>
            </select>
          </label>
          <label>
            Reason for commission control
            <textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
          </label>
          <Button
            variant="secondary"
            disabled={busy || !reason.trim()}
            onClick={() =>
              void run({ kind: "service-control", orderId: o.id, before: o, action, reason: reason.trim() }, `${o.id}-${action}-${o.history.length}`)
            }
          >
            Record commission control
          </Button>
          <p className="svc-hint">A reason is required. A cancel never refunds automatically.</p>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}

/** Market: workshop orders keep their workshop and terms while the party travels. */
export function ServiceOrders() {
  const t = useWorldTable() as unknown as CloudTable,
    seat = useSeat(),
    dm = seat.role === "dm";
  const orders = readServices(t.journal?.services).orders.filter(
    (o) => o.terms.workDays > 0 && o.status !== "requested" && (dm || seat.purseIds.includes(o.purseId)),
  );
  if (!orders.length) return null;
  return (
    <Fold title="Service commission register">
      <p>Orders keep their original workshop and terms while you travel. Only approved downtime advances work.</p>
      {orders.map((o) => (
        <div key={o.id}>
          <AppLink href={`/shop/${encodeURIComponent(o.terms.shopId)}#services`}>{o.terms.shopName} →</AppLink>
          <ServiceOrderCard order={o} table={t} dm={dm} />
        </div>
      ))}
    </Fold>
  );
}

const whole = (v: string, min = 0, max = 1e12) => Math.min(max, Math.max(min, Math.floor(Number(v) || 0)));
function WorkshopFields({ offer: o, onChange }: { offer: ServiceOffer; onChange: (patch: Partial<ServiceOffer>) => void }) {
  if (o.time.kind !== "downtime-days" || o.output.kind !== "holding") return null;
  const time = o.time,
    out = o.output;
  return (
    <div className="svc-grid">
      <label>
        Downtime days
        <input type="number" min={1} max={3650} value={time.days} onChange={(e) => onChange({ time: { ...time, days: whole(e.target.value, 1, 3650) } })} />
      </label>
      <label className="svc-check">
        <input type="checkbox" checked={time.perUnit} onChange={(e) => onChange({ time: { ...time, perUnit: e.target.checked } })} />
        Days are per item
      </label>
      <label>
        Most per order
        <input type="number" min={1} max={100} value={o.maxUnits ?? 1} onChange={(e) => onChange({ maxUnits: whole(e.target.value, 1, 100) })} />
      </label>
      <label>
        Item collected
        <input value={out.name} maxLength={160} onChange={(e) => onChange({ output: { ...out, name: e.target.value } })} />
      </label>
      <label>
        Item value each (copper)
        <input type="number" min={0} value={out.unitCopper} onChange={(e) => onChange({ output: { ...out, unitCopper: whole(e.target.value) } })} />
        <span className="svc-hint">{formatCopper(out.unitCopper)}</span>
      </label>
      <label>
        Weight each
        <input
          type="number"
          min={0}
          max={9999}
          step={0.1}
          value={out.weight}
          onChange={(e) => onChange({ output: { ...out, weight: Math.min(9999, Math.max(0, Number(e.target.value) || 0)) } })}
        />
      </label>
    </div>
  );
}

function InnFields({ offer: o, onChange }: { offer: ServiceOffer; onChange: (patch: Partial<ServiceOffer>) => void }) {
  const tiers = o.tiers ?? [];
  const setTier = (key: string, patch: Partial<NonNullable<ServiceOffer["tiers"]>[number]>) =>
    onChange({ tiers: tiers.map((x) => (x.key === key ? { ...x, ...patch } : x)) });
  return (
    <>
      <div className="svc-table-wrap">
        <table className="svc-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Night, cp</th>
              <th>Meal, cp</th>
              <th>On</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((x) => (
              <tr key={x.key}>
                <td>{x.name}</td>
                <td>
                  <input aria-label={`${x.name} night (copper)`} type="number" min={0} value={x.nightCopper} onChange={(e) => setTier(x.key, { nightCopper: whole(e.target.value) })} />
                </td>
                <td>
                  <input aria-label={`${x.name} meal (copper)`} type="number" min={0} value={x.mealCopper} onChange={(e) => setTier(x.key, { mealCopper: whole(e.target.value) })} />
                </td>
                <td>
                  <input aria-label={`Offer ${x.name}`} type="checkbox" checked={x.offered} onChange={(e) => setTier(x.key, { offered: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="svc-hint">Per guest. Booked stays are paid up front; leaving early refunds nothing unless you record an adjustment.</p>
      {o.time.kind === "per-night" && (
        <label>
          Most nights per booking
          <input
            type="number"
            min={1}
            max={365}
            value={o.time.maxNights}
            onChange={(e) => onChange({ time: { kind: "per-night", maxNights: whole(e.target.value, 1, 365) } })}
          />
        </label>
      )}
    </>
  );
}

function RumourEditor({ rumours, onChange }: { rumours: NonNullable<ServiceProvider["rumours"]>; onChange: (r: NonNullable<ServiceProvider["rumours"]>) => void }) {
  const set = (id: string, patch: Partial<(typeof rumours)[number]>) => onChange(rumours.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <div>
      <h4>Rumours</h4>
      <p className="svc-hint">
        Players see the teaser and price. The full text stays with you until a character buys it; then it arrives in that
        character's private thread with this NPC.
      </p>
      <ul className="svc-offer-list">
        {rumours.map((r) => (
          <li key={r.id}>
            <details className="svc-offer-row">
              <summary>
                <b>{r.teaser}</b>
                <span className="svc-price">{formatCopper(r.priceCopper)}</span>
                <small>
                  Once per {r.once} · {r.buyers?.length ? `bought by ${r.buyers.length}` : "not bought"}
                </small>
              </summary>
              <div className="svc-offer-body">
                <label>
                  Teaser (players see this)
                  <input value={r.teaser} maxLength={300} onChange={(e) => set(r.id, { teaser: e.target.value })} />
                </label>
                <label>
                  Full text (DM only until bought)
                  <textarea value={r.text ?? ""} maxLength={2000} onChange={(e) => set(r.id, { text: e.target.value })} />
                </label>
                <div className="svc-grid">
                  <label>
                    Price (copper)
                    <input type="number" min={0} value={r.priceCopper} onChange={(e) => set(r.id, { priceCopper: whole(e.target.value) })} />
                    <span className="svc-hint">{formatCopper(r.priceCopper)}</span>
                  </label>
                  <label>
                    Can be bought
                    <select value={r.once} onChange={(e) => set(r.id, { once: e.target.value as "character" | "party" })}>
                      <option value="character">Once per character</option>
                      <option value="party">Once per party</option>
                    </select>
                  </label>
                </div>
                <Button variant="danger" onClick={() => onChange(rumours.filter((x) => x.id !== r.id))}>
                  Remove rumour
                </Button>
              </div>
            </details>
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        onClick={() =>
          onChange([
            ...rumours,
            { id: `rumour-${Date.now().toString(36)}`, teaser: "A new rumour", text: "What the innkeeper says.", priceCopper: 50, once: "character", buyers: [] },
          ])
        }
      >
        Add rumour
      </Button>
    </div>
  );
}

/** What a link opens, for the shop page's Services section. */
function LinkSummary({ provider: p, table: t }: { provider: ServiceProvider; table: CloudTable }) {
  const shop = t.shops.find((s) => s.id === p.shopId);
  if (p.kind === "fence")
    return (
      <p className="svc-hint">
        Buys at {Math.round((shop?.buyRate ?? 0) * 100)}% of value through this shop's Sell tab, while the black market is
        open. No questions are asked; nothing is flagged.
      </p>
    );
  if (p.kind === "bank") {
    const l = p.link?.loan;
    return (
      <p className="svc-hint">
        Opens a loan request naming {p.name}. {l ? `Starting terms: ${l.rateBps / 100}% ${l.compound ? "compound" : "simple"} every ${l.periodDays} days${l.maxCopper ? `, up to ${formatCopper(l.maxCopper)}` : ""}. ` : ""}
        The DM decides every request.
      </p>
    );
  }
  return (
    <ul className="svc-offers" aria-label={`${serviceLabel(p)} roles`}>
      {(p.link?.roles ?? []).map((r) => (
        <li key={r.key}>
          <b>{r.name}</b>
          <span>
            {formatCopper(r.wageCopper)} / {r.periodDays === 1 ? "day" : `${r.periodDays} days`}
          </span>
          <small>
            Proposes a staff contract for one of the party's properties
            {r.npcId ? ` · ${npcName(t, r.npcId)}` : ""}.
          </small>
        </li>
      ))}
    </ul>
  );
}

/** DM settings of a link: the fence's shop preset, the bank's starting terms, hire roles. */
function LinkEditor({
  provider: p,
  table: t,
  onChange,
}: {
  provider: ServiceProvider;
  table: CloudTable;
  onChange: (link: ServiceProvider["link"]) => void;
}) {
  const shop = t.shops.find((s) => s.id === p.shopId);
  const economy = useEconomy();
  const [status, setStatus] = useState("");
  if (p.kind === "fence")
    return (
      <div>
        <h4>Fence preset</h4>
        <p className="svc-hint">
          {shop?.name ?? "This shop"}: black market {shop?.blackMarket ? "on" : "off"}, premium {shop?.blackMarketPremium ?? 1.5},
          buys at {Math.round((shop?.buyRate ?? 0) * 100)}%.
        </p>
        <Button
          variant="secondary"
          disabled={!shop}
          onClick={async () => {
            if (!shop) return;
            setStatus("");
            try {
              await economy.commandOutcome({
                id: `fence-preset-${shop.id}-${Date.now().toString(36)}`,
                kind: "shop-black-market",
                shopId: shop.id,
                before: { hidden: shop.blackMarket ?? false, premium: shop.blackMarketPremium ?? 1.5 },
                hidden: fenceShopPreset.blackMarket,
                premium: fenceShopPreset.blackMarketPremium,
              } as never);
              await economy.updateShop({ ...shop, blackMarket: true, blackMarketPremium: 1.5, buyRate: fenceShopPreset.buyRate });
              setStatus("Fence preset applied to the shop.");
            } catch (e) {
              setStatus(e instanceof Error ? e.message : "The shop didn't change.");
            }
          }}
        >
          Apply to the shop
        </Button>
        <p className="svc-hint">
          Sets black market on, premium 1.5 and buy rate 30%. Changes only those three shop fields; edit them after. The 30% is a
          house default for a fence (SRD 5.1 “Selling Treasure” gives half for ordinary gear). Selling stays the shop's usual
          sale.
        </p>
        {status && <p role="status">{status}</p>}
      </div>
    );
  if (p.kind === "bank") {
    const l = p.link?.loan ?? { rateBps: 0, periodDays: 30, compound: false, maxCopper: 0 };
    const set = (patch: Partial<typeof l>) => onChange({ ...p.link, loan: { ...l, ...patch } });
    return (
      <div className="svc-grid">
        <label>
          Interest (% per period)
          <input type="number" min={0} max={1000} step={0.01} value={l.rateBps / 100} onChange={(e) => set({ rateBps: whole(String(Number(e.target.value) * 100), 0, 100000) })} />
        </label>
        <label>
          Period (days)
          <input type="number" min={1} max={3650} value={l.periodDays} onChange={(e) => set({ periodDays: whole(e.target.value, 1, 3650) })} />
        </label>
        <label className="svc-check">
          <input type="checkbox" checked={l.compound} onChange={(e) => set({ compound: e.target.checked })} />
          Compound interest
        </label>
        <label>
          Largest loan (copper)
          <input type="number" min={0} value={l.maxCopper} onChange={(e) => set({ maxCopper: whole(e.target.value) })} />
          <span className="svc-hint">{l.maxCopper ? formatCopper(l.maxCopper) : "No limit suggested"}</span>
        </label>
        <p className="svc-hint">
          Only starting values for your loan form when a request names this bank. Loan maths, repayment and settlement are
          unchanged. Deposits and money-changing are not offered.
        </p>
      </div>
    );
  }
  const roles = p.link?.roles ?? [];
  const setRole = (key: string, patch: Partial<HireRole>) =>
    onChange({ ...p.link, roles: roles.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const npcs = t.journal?.world?.npcs ?? [];
  return (
    <div>
      <h4>Roles for hire</h4>
      <ul className="svc-offer-list">
        {roles.map((r) => (
          <li key={r.key}>
            <fieldset className="svc-grid">
              <legend>Role · {r.name}</legend>
              <label>
                Role name
                <input value={r.name} maxLength={160} onChange={(e) => setRole(r.key, { name: e.target.value })} />
              </label>
              <label>
                Wage (copper per period)
                <input type="number" min={0} value={r.wageCopper} onChange={(e) => setRole(r.key, { wageCopper: whole(e.target.value) })} />
                <span className="svc-hint">{formatCopper(r.wageCopper)}</span>
              </label>
              <label>
                Wage period (days)
                <input type="number" min={1} max={3650} value={r.periodDays} onChange={(e) => setRole(r.key, { periodDays: whole(e.target.value, 1, 3650) })} />
              </label>
              <label>
                NPC who takes the job (optional)
                <select
                  value={r.npcId ?? ""}
                  onChange={(e) => {
                    const next = { ...r };
                    if (e.target.value) next.npcId = e.target.value;
                    else delete next.npcId;
                    onChange({ ...p.link, roles: roles.map((x) => (x.key === r.key ? next : x)) });
                  }}
                >
                  <option value="">None</option>
                  {npcs.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="danger" onClick={() => onChange({ ...p.link, roles: roles.filter((x) => x.key !== r.key) })}>
                Remove {r.name}
              </Button>
            </fieldset>
          </li>
        ))}
      </ul>
      <Button
        variant="secondary"
        onClick={() => {
          let n = roles.length + 1;
          while (roles.some((r) => r.key === `role-${n}`)) n++;
          onChange({ ...p.link, roles: [...roles, { key: `role-${n}`, name: "Hireling", wageCopper: 20, periodDays: 1 }] });
        }}
      >
        Add role
      </Button>
      <p className="svc-hint">
        A player's Hire proposes the existing staff contract for one of the party's properties, with this role and wage. You
        approve it in Review Inbox as today. Hirelings who travel with the party are not offered.
      </p>
    </div>
  );
}
