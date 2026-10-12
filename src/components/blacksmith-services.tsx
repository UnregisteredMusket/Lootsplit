import { useState } from "react";
import { useSeat } from "@/lib/quire/seat";
import { useWorldTable } from "@/lib/quire/use-world-table";
import {
  smithAvailability,
  smithEnchantments,
  smithQuote,
  smithDate,
  smithDescription,
  smithHere,
} from "@/lib/quire/blacksmith";
import {
  defaultSmith,
  smithProfileSchema,
  smithSkills,
  materialRarities,
  type SmithProfile,
  type SmithDesign,
  type SmithOrder,
} from "@/lib/quire/blacksmith-schema";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { formatCopper } from "@/lib/quire/money";
import { locationLabel, readMarketLocations } from "@/lib/quire/shop-locations";
import type { Shop } from "@/lib/quire/types";
import type { CloudTable } from "@/lib/quire/cloud";
import { CommandForm, CommandButton } from "./world-tools";
import { SearchSelect } from "./search-select";
import { Button, Fold } from "./ui";
import { AppLink } from "./app-link";

export function BlacksmithServices({ shop, purseId }: { shop: Shop; purseId: string }) {
  const t = useWorldTable(),
    seat = useSeat(),
    dm = seat.role === "dm";
  const profile = t.journal.blacksmith?.profiles.find((p) => p.shopId === shop.id);
  const orders = t.journal.blacksmith?.orders.filter((o) => o.terms.shopId === shop.id) ?? [];
  if (!profile && !orders.length && shop.category !== "smith") return null;
  return (
    <section className="smith-services world-card" aria-label="Blacksmith services">
      <h2>Blacksmith services</h2>
      <p>
        Commission a unique weapon or armor. Work advances through DM-approved downtime; completed
        items wait here for collection.
      </p>
      {dm && (
        <Fold title="Configure blacksmith services">
          <SmithEditor
            key={profile ? canonicalJson(profile) : shop.id}
            shop={shop}
            profile={profile}
            table={t}
          />
          {profile && <SmithMaterialIdentification table={t} profile={profile} />}
          {profile && (
            <details>
              <summary>Remove forge configuration</summary>
              <p>Resolve outstanding orders first. Existing order history is retained.</p>
              <CommandButton
                input={{ kind: "smith-profile", shopId: shop.id, before: profile, profile: null }}
              >
                Remove blacksmith configuration
              </CommandButton>
            </details>
          )}
        </Fold>
      )}
      {profile ? (
        <>
          <p>
            {t.journal.world?.npcs.find((n) => n.id === profile.npcId)?.name ?? "Blacksmith"} ·{" "}
            {profile.skill} · {profile.magicalForge ? "Magical forge" : "Ordinary forge"}
          </p>
          <p>{profile.quality}</p>
          {smithAvailability(t, profile, purseId) ? (
            <p role="status">{smithAvailability(t, profile, purseId)}</p>
          ) : (
            <Fold title="Design a custom item">
              <SmithDesignForm
                key={profile.shopId + purseId}
                table={t}
                profile={profile}
                purseId={purseId}
              />
            </Fold>
          )}
        </>
      ) : (
        <p>The DM has not configured commissions for this forge.</p>
      )}
      {dm && <AppLink href="/features/npcs">People & NPCs · enable smith services →</AppLink>}
      <h3>Commission orders</h3>
      {!orders.length && <p>No commissions yet.</p>}
      {orders.map((o) => (
        <SmithOrderCard key={o.id} order={o} table={t} dm={dm} />
      ))}
    </section>
  );
}
function SmithMaterialIdentification({
  table: t,
  profile,
}: {
  table: CloudTable;
  profile: SmithProfile;
}) {
  const lots = t.holdings.filter(
    (h) => h.kind === "item" && !h.service && !h.custody && !h.reservedFor && h.quantity > 0,
  );
  const [holdingId, setHoldingId] = useState(lots[0]?.id ?? ""),
    [materialKey, setMaterialKey] = useState(profile.materials[0]?.materialKey ?? ""),
    [weight, setWeight] = useState(lots[0]?.weight ?? 0);
  return (
    <details>
      <summary>Identify inventory materials for contributions</summary>
      <CommandForm
        label="Identify smith contribution material"
        submitDisabled={!holdingId || !materialKey}
        submit={() => ({ kind: "estate-material", holdingId, materialKey, weight })}
      >
        <label>
          Contribution inventory lot
          <SearchSelect
            aria-label="Contribution inventory lot"
            value={holdingId}
            onValueChange={(id) => {
              setHoldingId(id);
              setWeight(t.holdings.find((h) => h.id === id)?.weight ?? 0);
            }}
          >
            {lots.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} · {t.purses.find((p) => p.id === h.purseId)?.name}
              </option>
            ))}
          </SearchSelect>
        </label>
        <label>
          Contribution material identity
          <SearchSelect
            aria-label="Contribution material identity"
            value={materialKey}
            onValueChange={setMaterialKey}
          >
            {profile.materials.map((m) => (
              <option key={m.materialKey} value={m.materialKey}>
                {m.name} · {m.unit}
              </option>
            ))}
          </SearchSelect>
        </label>
        <label>
          Contribution unit weight
          <input
            type="number"
            min={0}
            max={9999}
            step={0.01}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </label>
        <p>
          The DM confirms that each inventory unit matches the configured material unit.
          Identification changes no quantity or ownership.
        </p>
      </CommandForm>
    </details>
  );
}
export function BlacksmithOrders() {
  const t = useWorldTable(),
    dm = useSeat().role === "dm";
  const orders = t.journal.blacksmith?.orders ?? [];
  if (!orders.length) return null;
  return (
    <Fold title="Blacksmith commission register">
      <p>
        Orders retain their original forge and terms while you travel. Only approved downtime
        advances work.
      </p>
      {orders.map((o) => (
        <div key={o.id} className="smith-services">
          <AppLink href={`/shop/${encodeURIComponent(o.terms.shopId)}`}>
            {o.terms.shopName} →
          </AppLink>
          <SmithOrderCard order={o} table={t} dm={dm} />
        </div>
      ))}
    </Fold>
  );
}

const presets = {
  apprentice: {
    priceMultiplier: 0.75,
    valueMultiplier: 0.8,
    quality: "Basic craftsmanship",
    timeMultiplier: 1.5,
  },
  journeyman: {
    priceMultiplier: 1,
    valueMultiplier: 1,
    quality: "Sound, serviceable craftsmanship",
    timeMultiplier: 1,
  },
  expert: {
    priceMultiplier: 1.5,
    valueMultiplier: 1.5,
    quality: "Careful, refined craftsmanship",
    timeMultiplier: 1,
  },
  master: {
    priceMultiplier: 3,
    valueMultiplier: 2,
    quality: "Exceptional finish and precision",
    timeMultiplier: 1,
  },
  legendary: {
    priceMultiplier: 5,
    valueMultiplier: 3,
    quality: "Legendary artistry and craftsmanship",
    timeMultiplier: 1,
  },
};
function SmithEditor({
  shop,
  profile,
  table: t,
}: {
  shop: Shop;
  profile?: SmithProfile;
  table: CloudTable;
}) {
  const [draft, setDraft] = useState(
    () => profile ?? defaultSmith(shop.id, t.journal?.world?.npcs[0]?.id ?? "choose-npc"),
  );
  const [advanced, setAdvanced] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState("");
  const [enchantmentName, setEnchantmentName] = useState("");
  const change = (patch: Partial<SmithProfile>) => setDraft({ ...draft, ...patch });
  return (
    <CommandForm
      label="Save blacksmith services"
      dirty={canonicalJson(draft) !== canonicalJson(profile) || advanced !== null}
      submit={() => ({
        kind: "smith-profile",
        shopId: shop.id,
        before: profile ?? null,
        profile: smithProfileSchema.parse(advanced === null ? draft : JSON.parse(advanced)),
      })}
    >
      <p>
        These are fictional, editable defaults. Configure the base item description with any
        approved combat rules. Craftsmanship never adds hidden combat bonuses.
      </p>
      {!shop.locationId && (
        <p role="alert">
          Assign this shop a physical location in Edit before enabling commissions.
        </p>
      )}
      <label>
        Blacksmith NPC
        <SearchSelect
          aria-label="Blacksmith NPC"
          value={draft.npcId}
          onValueChange={(npcId) => change({ npcId })}
        >
          <option value="choose-npc">Choose the maker</option>
          {t.journal?.world?.npcs.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </SearchSelect>
      </label>
      <p>
        In People & NPCs, check “Offers blacksmith services” for this maker. Legendary smiths also
        require this permission.
      </p>
      <label>
        Blacksmith skill
        <select
          value={draft.skill}
          onChange={(e) => {
            const skill = e.target.value as SmithProfile["skill"];
            change({ skill, ...presets[skill] });
          }}
        >
          {smithSkills.map((skill) => (
            <option key={skill}>{skill}</option>
          ))}
        </select>
      </label>
      <p>Changing skill loads its editable example pricing, quality and work rate.</p>
      <label>
        <input
          type="checkbox"
          checked={draft.magicalForge}
          onChange={(e) => change({ magicalForge: e.target.checked })}
        />{" "}
        Magical forge
      </label>
      {(
        [
          ["priceMultiplier", "Labor price multiplier"],
          ["valueMultiplier", "Item value multiplier"],
          ["timeMultiplier", "Work time multiplier"],
          ["engravingCopper", "Engraving price (cp)"],
          ["engravingDays", "Engraving work days"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            type="number"
            min={key === "timeMultiplier" ? 0.01 : 0}
            step={key.endsWith("Multiplier") ? 0.01 : 1}
            value={draft[key]}
            onChange={(e) => change({ [key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <label>
        Craftsmanship description
        <textarea
          maxLength={1000}
          value={draft.quality}
          onChange={(e) => change({ quality: e.target.value })}
        />
      </label>
      <h3>Smith materials & rarity</h3>
      <p>
        Smith stock is separate from player holdings. Saving supplies is a deliberate DM stock
        adjustment. Inventory contributions use the same material keys as property work.
      </p>
      {draft.materials.map((m, i) => {
        const update = (patch: Partial<typeof m>) =>
          change({ materials: draft.materials.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
        return (
          <fieldset className="smith-part" key={m.materialKey}>
            <legend>
              {m.name} · {m.unit}
            </legend>
            <label>
              {m.name} rarity
              <select
                value={m.rarity}
                onChange={(e) => {
                  const rarity = e.target.value as typeof m.rarity;
                  const defaults = {
                    common: 1,
                    uncommon: 2,
                    rare: 5,
                    "very rare": 10,
                    legendary: 25,
                  };
                  update({ rarity, rarityMultiplier: defaults[rarity] });
                }}
              >
                {materialRarities.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label>
              {m.name} rarity multiplier
              <input
                type="number"
                min={0}
                step={0.01}
                value={m.rarityMultiplier}
                onChange={(e) => update({ rarityMultiplier: Number(e.target.value) })}
              />
            </label>
            <label>
              {m.name} base unit value (cp)
              <input
                type="number"
                min={0}
                value={m.unitCopper}
                onChange={(e) => update({ unitCopper: Number(e.target.value) })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={m.quantity === null}
                onChange={(e) => update({ quantity: e.target.checked ? null : 0 })}
              />{" "}
              {m.name} unlimited stock
            </label>
            {m.quantity !== null && (
              <label>
                {m.name} available units
                <input
                  type="number"
                  min={0}
                  value={m.quantity}
                  onChange={(e) => update({ quantity: Number(e.target.value) })}
                />
              </label>
            )}
          </fieldset>
        );
      })}
      <h3>DM enchantment list</h3>
      <p>
        Only approved enchantments at or below the maker's skill are offered, and only at a magical
        forge.
      </p>
      {draft.enchantments.map((e, i) => {
        const update = (patch: Partial<typeof e>) =>
          change({
            enchantments: draft.enchantments.map((v, j) => (j === i ? { ...v, ...patch } : v)),
          });
        return (
          <fieldset className="smith-part" key={e.key}>
            <legend>{e.name}</legend>
            <label>
              <input
                type="checkbox"
                checked={e.approved}
                onChange={(v) => update({ approved: v.target.checked })}
              />{" "}
              Approve {e.name}
            </label>
            <label>
              {e.name} minimum skill
              <select
                value={e.minimumSkill}
                onChange={(v) => update({ minimumSkill: v.target.value as typeof e.minimumSkill })}
              >
                {smithSkills.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            {(
              [
                ["copper", "price (cp)"],
                ["valueCopper", "added item value (cp)"],
                ["days", "work days"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {e.name} {label}
                <input
                  type="number"
                  min={0}
                  value={e[key]}
                  onChange={(v) => update({ [key]: Number(v.target.value) })}
                />
              </label>
            ))}
            <label>
              {e.name} effect description
              <textarea
                maxLength={1500}
                value={e.description}
                onChange={(v) => update({ description: v.target.value })}
              />
            </label>
            <Button
              type="button"
              onClick={() => change({ enchantments: draft.enchantments.filter((_, j) => j !== i) })}
            >
              Remove {e.name}
            </Button>
          </fieldset>
        );
      })}
      <label>
        New enchantment name
        <input
          value={enchantmentName}
          maxLength={160}
          onChange={(e) => setEnchantmentName(e.target.value)}
        />
      </label>
      <Button
        type="button"
        disabled={!enchantmentName.trim()}
        onClick={() => {
          change({
            enchantments: [
              ...draft.enchantments,
              {
                key: `enchantment-${crypto.randomUUID()}`,
                name: enchantmentName.trim(),
                description: "",
                minimumSkill: "master",
                approved: false,
                copper: 0,
                valueCopper: 0,
                days: 1,
              },
            ],
          });
          setEnchantmentName("");
        }}
      >
        Add enchantment
      </Button>
      <details className="mt-3">
        <summary>Advanced parts, materials & item settings</summary>
        <p>
          Edit the validated configuration to add weapons, armor, any component or style, material
          keys/quantities, base prices, labor, weight and approved effects. Existing orders retain
          their accepted settings. Keep this shop ID.
        </p>
        {advanced === null ? (
          <Button type="button" onClick={() => setAdvanced(JSON.stringify(draft, null, 2))}>
            Edit full forge configuration
          </Button>
        ) : (
          <>
            <label>
              Full forge configuration JSON
              <textarea
                rows={18}
                value={advanced}
                onChange={(e) => setAdvanced(e.target.value)}
                spellCheck={false}
              />
            </label>
            <Button
              type="button"
              onClick={() => {
                try {
                  setDraft(smithProfileSchema.parse(JSON.parse(advanced)));
                  setAdvanced(null);
                  setJsonError("");
                } catch (e) {
                  setJsonError(e instanceof Error ? e.message : "Invalid configuration.");
                }
              }}
            >
              Apply JSON to editor
            </Button>
            <Button type="button" onClick={() => setAdvanced(null)}>
              Discard JSON edits
            </Button>
            {jsonError && <p role="alert">{jsonError}</p>}
          </>
        )}
      </details>
      <p>
        Price = base + smith-supplied material value + multiplied labor/style/engraving fees +
        enchantment fee. Value = (base + all material value + style fees) × item value multiplier +
        enchantment value. Material value = unit value × rarity multiplier × units. Work days round
        up after the work time multiplier.
      </p>
    </CommandForm>
  );
}
function initialDesign(p: SmithProfile, itemKey = p.items[0].key): SmithDesign {
  const i = p.items.find((i) => i.key === itemKey)!;
  return {
    itemKey,
    name: i.name,
    engraving: "",
    enchantmentKey: null,
    parts: i.parts.map((part) => ({
      partKey: part.key,
      optionKey: part.options[0].key,
      materialKey: part.materialKeys[0],
      holdingId: null,
    })),
  };
}
function SmithDesignForm({
  table: t,
  profile,
  purseId,
}: {
  table: CloudTable;
  profile: SmithProfile;
  purseId: string;
}) {
  const [design, setDesign] = useState(() => initialDesign(profile)),
    [review, setReview] = useState<ReturnType<typeof smithQuote> | null>(null),
    [error, setError] = useState("");
  const item = profile.items.find((i) => i.key === design.itemKey);
  const change = (v: SmithDesign) => {
    setDesign(v);
    setReview(null);
    setError("");
  };
  const partChange = (key: string, patch: Partial<SmithDesign["parts"][number]>) =>
    change({
      ...design,
      parts: design.parts.map((p) => (p.partKey === key ? { ...p, ...patch } : p)),
    });
  return (
    <CommandForm
      label="Place paid commission"
      dirty={!!review || !!design.engraving || design.name !== item?.name}
      submitDisabled={!review}
      submit={() => {
        if (!review) throw Error("Review the commission first.");
        return {
          kind: "smith-order",
          shopId: profile.shopId,
          purseId,
          design: review.terms.design,
          before: review.before,
        };
      }}
      onDone={() => {
        setReview(null);
        setDesign(initialDesign(profile));
      }}
    >
      <label>
        Item design
        <SearchSelect
          aria-label="Item design"
          value={design.itemKey}
          onValueChange={(key) => change(initialDesign(profile, key))}
        >
          {profile.items.map((i) => (
            <option key={i.key} value={i.key}>
              {i.name} · {i.kind}
            </option>
          ))}
        </SearchSelect>
      </label>
      <label>
        Unique item name
        <input
          required
          maxLength={160}
          value={design.name}
          onChange={(e) => change({ ...design, name: e.target.value })}
        />
      </label>
      {item?.parts.map((part) => {
        const c = design.parts.find((c) => c.partKey === part.key);
        if (!c) return <p key={part.key}>The forge design changed. Select an item design again.</p>;
        const materials = profile.materials.filter((m) =>
          part.materialKeys.includes(m.materialKey),
        );
        const holdings = t.holdings.filter(
          (h) =>
            h.purseId === purseId &&
            h.kind === "item" &&
            !h.service &&
            !h.custody &&
            !h.reservedFor &&
            !h.equipped &&
            h.quantity >= part.quantity &&
            h.materialKey === c.materialKey,
        );
        return (
          <fieldset key={part.key} className="smith-part">
            <legend>
              {part.name} · {part.quantity} material units
            </legend>
            <label>
              {part.name} style
              <SearchSelect
                aria-label={`${part.name} style`}
                value={c.optionKey}
                onValueChange={(optionKey) => partChange(part.key, { optionKey })}
              >
                {part.options.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.name} · {formatCopper(o.copper)} · +{o.days} days
                  </option>
                ))}
              </SearchSelect>
            </label>
            <label>
              {part.name} material
              <SearchSelect
                aria-label={`${part.name} material`}
                value={c.materialKey}
                onValueChange={(materialKey) =>
                  partChange(part.key, { materialKey, holdingId: null })
                }
              >
                {materials.map((m) => (
                  <option key={m.materialKey} value={m.materialKey}>
                    {m.name} · {m.rarity}
                  </option>
                ))}
              </SearchSelect>
            </label>
            <label>
              {part.name} material source
              <SearchSelect
                aria-label={`${part.name} material source`}
                value={c.holdingId ?? "smith"}
                onValueChange={(key) =>
                  partChange(part.key, { holdingId: key === "smith" ? null : key })
                }
              >
                <option value="smith">
                  Smith stock ·{" "}
                  {materials.find((m) => m.materialKey === c.materialKey)?.quantity ?? "unlimited"}{" "}
                  available
                </option>
                {holdings.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} · your inventory · {h.quantity} available
                  </option>
                ))}
              </SearchSelect>
            </label>
          </fieldset>
        );
      })}
      <label>
        Engraving
        <textarea
          maxLength={500}
          value={design.engraving}
          onChange={(e) => change({ ...design, engraving: e.target.value })}
        />
      </label>
      <label>
        Enchantment
        <SearchSelect
          aria-label="Enchantment"
          value={design.enchantmentKey ?? "none"}
          onValueChange={(key) =>
            change({ ...design, enchantmentKey: key === "none" ? null : key })
          }
        >
          <option value="none">No enchantment</option>
          {smithEnchantments(profile).map((e) => (
            <option key={e.key} value={e.key}>
              {e.name} · {formatCopper(e.copper)} · +{e.days} days
            </option>
          ))}
        </SearchSelect>
      </label>
      {!profile.magicalForge && <p>Enchantments require a DM-enabled magical forge.</p>}
      <Button
        type="button"
        onClick={() => {
          try {
            setReview(smithQuote(t, profile.shopId, purseId, design));
            setError("");
          } catch (e) {
            setReview(null);
            setError(e instanceof Error ? e.message : "Review failed.");
          }
        }}
      >
        Review commission
      </Button>
      {error && <p role="alert">{error}</p>}
      {review && (
        <div className="smith-review" role="region" aria-label="Commission review">
          <h3>{review.terms.design.name}</h3>
          <p>
            Pay {formatCopper(review.terms.costCopper)} now · {review.terms.workDays} approved
            downtime days · item value {formatCopper(review.terms.valueCopper)}.
          </p>
          <p>
            Labor, styles & engraving: {formatCopper(review.laborCopper)}. Smith materials:{" "}
            {formatCopper(review.smithMaterialCopper)}. Your offered material value:{" "}
            {formatCopper(review.contributedMaterialValue)}.
          </p>
          <p className="whitespace-pre-wrap">{review.terms.description}</p>
          <p>
            Maker: {review.terms.makerName}. Collection: {review.terms.shopName}. Materials are
            handed over and consumed for this commission; they cannot be reused. Cancellation
            refunds or salvage require a recorded DM adjustment.
          </p>
        </div>
      )}
    </CommandForm>
  );
}
function SmithOrderCard({
  order: o,
  table: t,
  dm,
}: {
  order: SmithOrder;
  table: CloudTable;
  dm: boolean;
}) {
  const [reason, setReason] = useState("");
  const [selectedAction, setAction] = useState<"pause" | "resume" | "cancel" | null>(null);
  return (
    <article className="world-card" aria-label={`Commission ${o.terms.design.name}`}>
      <h4>
        {o.terms.design.name} · {o.status}
      </h4>
      <p>
        {o.progressDays}/{o.terms.workDays} approved downtime days · paid{" "}
        {formatCopper(o.terms.costCopper)} · {o.terms.makerName}, {o.terms.skill}
      </p>
      <p>
        Ordered {smithDate(o.orderedDay, o.orderedMinute)} · pickup at{" "}
        {locationLabel(readMarketLocations(t.journal?.market), o.terms.locationId)}.
      </p>
      <p>{o.message}</p>
      <details>
        <summary>Commission specifications & provenance</summary>
        <p className="whitespace-pre-wrap">
          {o.completedDay === undefined ? o.terms.description : smithDescription(o)}
        </p>
      </details>
      {o.status === "ready" &&
        (smithHere(t, o.terms.locationId, o.purseId) ? (
          <CommandButton input={{ kind: "smith-claim", orderId: o.id, before: o }}>
            Collect crafted item
          </CommandButton>
        ) : (
          <p>Return to the original forge with the ordering account to collect.</p>
        ))}
      {dm && ["active", "paused", "ready"].includes(o.status) && (
        <CommandForm
          label="Record commission control"
          dirty={!!reason}
          submit={() => ({
            kind: "smith-control",
            orderId: o.id,
            before: o,
            action: action(o),
            reason,
          })}
          onDone={() => {
            setReason("");
            setAction(null);
          }}
        >
          <label>
            Commission control
            <select
              name="action"
              value={action(o)}
              onChange={(e) => setAction(e.target.value as "pause" | "resume" | "cancel")}
            >
              {o.status === "active" && <option value="pause">Pause work</option>}
              {o.status === "paused" && <option value="resume">Resume work</option>}
              <option value="cancel">Cancel · refund/salvage separately</option>
            </select>
          </label>
          <label>
            Reason for commission control
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </CommandForm>
      )}
    </article>
  );
  function action(order: SmithOrder) {
    return (
      selectedAction ??
      (order.status === "active" ? "pause" : order.status === "paused" ? "resume" : "cancel")
    );
  }
}
