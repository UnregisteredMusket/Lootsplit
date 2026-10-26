import { CharacterPlacement } from "./character-placement";
import { actingGroups, seatGroups } from "@/lib/quire/party-groups";
import { MapRecordStrip } from "./map-record-strip";
import { characterLocation, characterPosition } from "@/lib/quire/character-position";
import { SearchSelect } from "@/components/search-select";
import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { libraryRecordHref } from "@/lib/quire/library-records";
import { useSeat } from "@/lib/quire/seat";
import { readWorld, npcImportSchema, type Npc } from "@/lib/quire/world-schema";
import { npcAvailableHere, npcController, worldImportFingerprint } from "@/lib/quire/world";
import { readMarketLocations, locationLabel } from "@/lib/quire/shop-locations";
import { canonicalJson } from "@/lib/quire/canonical-json";
import { toCopper, formatCopper } from "@/lib/quire/money";
import { LocationOptions } from "./market-locations";
import { MarketImageUpload } from "./market-image-upload";
import { useWorldTable } from "@/lib/quire/use-world-table";
import { CommandForm, CommandButton } from "./world-tools";
import { Button, Fold } from "./ui";
import { AppLink } from "./app-link";
import type { CloudTable } from "@/lib/quire/cloud";
import { NpcConversation } from "./npc-conversation";
import { npcServices } from "@/lib/quire/service-hub";
import { serviceKinds } from "@/lib/quire/services-schema";
import { NpcServicesToggle } from "./service-providers";
import { ShareRumour } from "./service-talk";
import { NpcBarterConfigForm } from "./npc-barter-desk";
import { npcAnswersBarter } from "@/lib/quire/npc-barter";
import { npcPinOpensHub } from "@/lib/quire/place-hub";
import { requestConfirm } from "@/lib/quire/confirm-store";

export function LocationNpcs() {
  const t = useWorldTable(),
    world = readWorld(t.journal.world),
    seat = useSeat(),
    dm = seat.role === "dm",
    market = readMarketLocations(t.journal.market);
  const [edit, setEdit] = useState<Npc | null | undefined>(),
    [selected, setSelected] = useState(""),
    [importText, setImportText] = useState(""),
    [importError, setImportError] = useState("");
  const npcs = world.npcs.filter((n) => dm || npcAvailableHere(n, t, seatGroups(t, seat))),
    npc = npcs.find((n) => n.id === selected);
  const requestedNpc = useRouterState({ select: (s) => s.location.search.npc });
  useEffect(() => {
    setSelected(typeof requestedNpc === "string" ? requestedNpc : "");
  }, [requestedNpc]);
  const [query, setQuery] = useState("");
  let imported: ReturnType<typeof npcImportSchema.parse> | undefined;
  try {
    if (importText) imported = npcImportSchema.parse(JSON.parse(importText));
  } catch {
    /* The retained text is reported in the preview. */
  }
  return (
    <div>
      <p>
        Meet people at {locationLabel(market, market.currentLocationId)}. The DM speaks for NPCs
        unless a player character is assigned as their controller.
      </p>
      <AppLink className="settings-link" href="/features/trading">
        Open Trading & Barter →
      </AppLink>
      {dm && (
        <>
          <div className="world-toolbar">
            <Button onClick={() => setEdit(null)}>Create non-party NPC</Button>
          </div>
          {edit !== undefined && (
            <NpcEditor
              key={edit?.id ?? "new"}
              npc={edit ?? undefined}
              table={t}
              close={() => setEdit(undefined)}
            />
          )}
          <Fold title="Import NPCs">
            <p>
              <a href="/download/location-npcs.sample.json" download>
                Download NPC import example
              </a>{" "}
              ·{" "}
              <a href="/download/world-features.md" download>
                Import instructions
              </a>{" "}
              ·{" "}
              <a href="/download/location-npcs.schema.json" download>
                JSON Schema
              </a>
            </p>
            <label>
              NPC JSON file
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  setImportError("");
                  try {
                    if (f.size > 5_000_000) throw Error("Choose a JSON document up to 5 MB.");
                    setImportText(await f.text());
                  } catch (e) {
                    setImportError(e instanceof Error ? e.message : "Import failed.");
                  }
                }}
              />
            </label>
            <CommandForm
              label="Import reviewed NPCs"
              dirty={!!importText}
              submit={() => {
                if (!imported)
                  throw Error("The NPC document is invalid. Check the import format and fields.");
                return {
                  kind: "npc-import",
                  before: worldImportFingerprint(t),
                  document: imported,
                };
              }}
              onDone={() => setImportText("")}
            >
              <label>
                Import document
                <textarea
                  rows={8}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
              </label>
              {importText && (
                <p>
                  {imported
                    ? `${imported.npcs.length} NPCs: ${imported.npcs.map((n) => `${n.name} (${locationLabel(market, n.locationId)}, ${n.inventory.length} inventory lots, ${formatCopper(n.copper)})`).join("; ")}. New accounts and inventory will be created; current NPCs are preserved.`
                    : "Invalid JSON or NPC fields. Your document is retained."}
                </p>
              )}
            </CommandForm>
            {importError && <p role="alert">{importError}</p>}
          </Fold>
          <Fold
            title="Party companion funds"
            hint={`Party ${world.companionFundsVisible ? "can" : "cannot"} see companion NPC funds.`}
          >
            <p>
              A companion is a visible NPC travelling with the party. When this is on, players with
              a character in the party can read each companion's coins and coin history, read-only.
              Hidden NPCs, NPCs elsewhere and exchange treasuries stay private, and an assigned
              controller always sees its NPC's funds.
            </p>
            <p>Party can see companion NPC funds: {world.companionFundsVisible ? "on" : "off"}.</p>
            <CommandButton
              input={{
                kind: "companion-funds-visibility",
                before: world.companionFundsVisible ?? false,
                visible: !world.companionFundsVisible,
              }}
            >
              {world.companionFundsVisible
                ? "Keep companion funds private"
                : "Show companion funds to the party"}
            </CommandButton>
          </Fold>
        </>
      )}
      <label className="block mt-3">
        Find an NPC
        <SearchSelect aria-label="Find an NPC" value={selected} onValueChange={setSelected}>
          <option value="">Choose an NPC</option>
          {npcs.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name} · {locationLabel(market, n.locationId)}
            </option>
          ))}
        </SearchSelect>
      </label>
      <label className="block mt-3">
        Search NPC records
        <input
          className="ledger-search w-full"
          aria-label="Search NPC records"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {npcs
        .filter((n) =>
          `${n.name} ${n.description} ${locationLabel(market, n.locationId)}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        )
        .map((n) => (
          <article className="world-card" key={n.id}>
            <div className="world-row">
              {n.portrait && <img width={64} height={64} src={n.portrait} alt={n.name} />}
              <span>
                <h2>
                  <AppLink href={libraryRecordHref("npc", n.id)}>
                    {n.name} <span aria-hidden="true">→</span>
                  </AppLink>
                </h2>
                <p>
                  {characterPosition(
                    t,
                    t.purses.find((p) => p.id === n.id)!,
                  ).inParty
                    ? "In party"
                    : locationLabel(
                        market,
                        characterLocation(
                          t,
                          t.purses.find((p) => p.id === n.id)!,
                        ),
                      )}{" "}
                  · {npcAvailableHere(n, t, seatGroups(t, seat)) ? "Nearby" : "Away / hidden"} ·{" "}
                  {n.barterAllowed ? "Bartering allowed" : "No bartering"}
                </p>
              </span>
            </div>
            <MapRecordStrip reference={{ kind: "npc", id: n.id }} />
            <details className="npc-record-details">
              <summary aria-label={`Details & actions for ${n.name}`}>Details & actions</summary>
              <div className="world-toolbar">
                <Button onClick={() => setSelected(n.id)}>View & interact</Button>
                {dm && <Button onClick={() => setEdit(n)}>Configure NPC</Button>}
              </div>
              <p>{n.description}</p>
              {t.journal.blacksmith?.profiles
                .filter((p) => p.npcId === n.id)
                .map((p) => (
                  <p key={p.shopId}>
                    {p.skill} blacksmith ·{" "}
                    <AppLink href={`/shop/${encodeURIComponent(p.shopId)}`}>
                      Blacksmith services →
                    </AppLink>
                  </p>
                ))}
              {dm && t.journal.blacksmith?.profiles.some((p) => p.npcId === n.id) && (
                <NpcSmithToggle npc={n} />
              )}
              {dm && <NpcServicesToggle npc={n} table={t as unknown as CloudTable} />}
              {dm && n.barterAllowed && (
                <NpcBarterConfigForm key={JSON.stringify(n.barter ?? null)} npc={n} table={t} />
              )}
            </details>
          </article>
        ))}
      {!npcs.length && <p>No NPCs are available at this location.</p>}
      {npc && (
        <>
          {dm && <CharacterPlacement npcId={npc.id} />}
          <NpcInteraction key={npc.id} npc={npc} table={t} />
        </>
      )}
    </div>
  );
}
function NpcEditor({ npc, table, close }: { npc?: Npc; table: CloudTable; close: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.scrollIntoView({ block: "start" });
    heading.current?.focus({ preventScroll: true });
  }, []);
  const market = readMarketLocations(table.journal?.market),
    [draft, setDraft] = useState<Npc>(
      npc ?? {
        id: crypto.randomUUID(),
        name: "",
        description: "",
        locationId: market.currentLocationId ?? "",
        visible: true,
        barterAllowed: false,
        controllerPurseId: null,
      },
    ),
    [copper, setCopper] = useState("0"),
    [uploadBusy, setUploadBusy] = useState(false);
  return (
    <section className="world-card" aria-label="NPC editor">
      <h2 ref={heading} tabIndex={-1} style={{ scrollMarginTop: "6rem" }}>
        {npc ? "Configure NPC" : "New non-party NPC"}
      </h2>
      <CommandForm
        label={npc ? "Save NPC configuration" : "Create NPC"}
        dirty
        submit={() => {
          if (uploadBusy) throw Error("Wait for the portrait to finish processing.");
          return npc
            ? { kind: "npc-save", before: npc, npc: draft }
            : { kind: "npc-create", npc: draft, copper: Number(copper), inventory: [] };
        }}
        onDone={close}
      >
        <label>
          <input
            type="checkbox"
            checked={draft.blacksmithServices === true}
            onChange={(e) => setDraft({ ...draft, blacksmithServices: e.target.checked })}
          />{" "}
          Offers blacksmith services
        </label>
        <fieldset>
          <legend>Other services</legend>
          {serviceKinds.map((k) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={draft.services?.includes(k) === true}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    services: serviceKinds.filter((x) =>
                      x === k ? e.target.checked : draft.services?.includes(x),
                    ),
                  })
                }
              />{" "}
              Offers {k} services
            </label>
          ))}
          <p>Set up the offers on the shop page where this NPC works (Services · Add a service provider).</p>
        </fieldset>
        <p>
          Enable only when this NPC agrees to accept commissions. Configure the linked forge's
          skill, materials, parts and enchantments in its shop.
        </p>
        <label>
          NPC name
          <input
            required
            maxLength={160}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Description
          <textarea
            maxLength={4000}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </label>
        <label>
          NPC location
          <SearchSelect
            aria-label="NPC location"
            required
            value={draft.locationId}
            onValueChange={(selectedValue) => setDraft({ ...draft, locationId: selectedValue })}
          >
            <option value="">Choose location</option>
            {LocationOptions({ market: market })}
          </SearchSelect>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.visible}
            onChange={(e) => setDraft({ ...draft, visible: e.target.checked })}
          />
          Visible to players at this location
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.barterAllowed}
            onChange={(e) => setDraft({ ...draft, barterAllowed: e.target.checked })}
          />
          Bartering allowed
        </label>
        <label>
          NPC controller
          <SearchSelect
            aria-label="NPC controller"
            value={draft.controllerPurseId ?? ""}
            onValueChange={(selectedValue) =>
              setDraft({ ...draft, controllerPurseId: selectedValue || null })
            }
          >
            <option value="">Dungeon Master (default)</option>
            {table.purses
              .filter((p) => p.kind === "character" && !p.nonParty && p.control !== "npc")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </SearchSelect>
        </label>
        <p className="text-sm text-muted">
          A delegated controller can speak and accept or counter offers for this NPC. Configuration
          and stock remain DM-controlled.
        </p>
        {!npc && (
          <label>
            Starting funds (copper)
            <input
              type="number"
              min={0}
              max={1e12}
              step={1}
              required
              value={copper}
              onChange={(e) => setCopper(e.target.value)}
            />
          </label>
        )}
        <MarketImageUpload
          label="NPC portrait"
          value={draft.portrait}
          onChange={(portrait) => setDraft({ ...draft, portrait })}
          onBusyChange={setUploadBusy}
        />
      </CommandForm>
      <Button
        onClick={() => {
          void requestConfirm({
            title: "Close this unsaved NPC draft?",
            tone: "discard",
            confirmLabel: "Discard draft",
          }).then((discard) => discard && close());
        }}
      >
        Close editor
      </Button>
    </section>
  );
}
function NpcSmithToggle({ npc }: { npc: Npc }) {
  const [allowed, setAllowed] = useState(npc.blacksmithServices === true);
  useEffect(() => setAllowed(npc.blacksmithServices === true), [npc.blacksmithServices]);
  return (
    <CommandForm
      label={`Save ${npc.name} smith permission`}
      dirty={allowed !== (npc.blacksmithServices === true)}
      submit={() => ({
        kind: "npc-save",
        before: npc,
        npc: { ...npc, blacksmithServices: allowed },
      })}
    >
      <label>
        <input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />{" "}
        Offers blacksmith services · {npc.name}
      </label>
    </CommandForm>
  );
}
function NpcInteraction({
  npc,
  table,
  showConversation = true,
}: {
  npc: Npc;
  table: CloudTable;
  /** False where the conversation hub is already shown above (the map's NPC pin). */
  showConversation?: boolean;
}) {
  const seat = useSeat(),
    dm = seat.role === "dm",
    controller = npcController(npc, seat),
    world = readWorld(table.journal?.world);
  const characters = table.purses.filter(
    (p) =>
      p.kind === "character" &&
      !p.nonParty &&
      (dm ||
        seat.purseIds.includes(p.id) ||
        world.conversations.some((c) => c.npcId === npc.id && c.purseId === p.id)),
  );
  // The seat is the default DM seat on the first render (a direct load or refresh), so
  // choices seeded from it follow the seat instead of keeping that first value.
  const [chosenCharacter, setCharacter] = useState(""),
    character = characters.some((p) => p.id === chosenCharacter)
      ? chosenCharacter
      : (characters[0]?.id ?? ""),
    [text, setText] = useState(""),
    [speakAsNpc, setAsNpc] = useState<boolean | null>(null),
    // Only the NPC's controller can speak as the NPC (the server refuses anyone else);
    // a controller starts speaking as the NPC until they untick it.
    asNpc = controller && (speakAsNpc ?? true),
    [itemName, setItemName] = useState(""),
    [qty, setQty] = useState("1"),
    [value, setValue] = useState("0"),
    [notes, setNotes] = useState(""),
    [funds, setFunds] = useState(
      String(toCopper(table.purses.find((p) => p.id === npc.id)!.coins)),
    );
  const conversation = world.conversations.find(
      (c) => c.npcId === npc.id && c.purseId === character,
    ),
    // Split the party: near the chosen character's group.
    near = npcAvailableHere(npc, table, character ? actingGroups(table, character, seat.purseIds) : seatGroups(table, seat)),
    purse = table.purses.find((p) => p.id === npc.id)!;
  return (
    <section className="world-card">
      <h2>{npc.name} · interaction</h2>
      {showConversation &&
        near &&
        (npcAnswersBarter(npc) ||
          (!npc.controllerPurseId && npcServices(table, npc.id, undefined).length > 0)) && (
        <NpcConversation key={npc.id} npc={npc} table={table} />
      )}
      <h3>Inventory</h3>
      {table.holdings
        .filter((h) => h.purseId === npc.id && h.quantity > 0 && !h.custody && !h.reservedFor)
        .map((h) => (
          <div className="world-row" key={h.id}>
            <span>
              {h.quantity} × {h.name} · {formatCopper(h.unitCopper)} each
              {h.kind === "property" ? " · Property deed" : ""}
              <p>{h.notes}</p>
            </span>
            {dm && h.kind === "item" && (
              <CommandButton
                input={{
                  kind: "npc-remove-item",
                  npcId: npc.id,
                  holdingId: h.id,
                  before: canonicalJson(h),
                }}
              >
                Remove NPC item
              </CommandButton>
            )}
          </div>
        ))}
      {dm && (
        <Fold title="Configure NPC inventory & funds">
          <CommandForm
            label="Add NPC inventory lot"
            dirty={!!itemName}
            submit={() => ({
              kind: "npc-item",
              npcId: npc.id,
              item: { name: itemName, quantity: Number(qty), unitCopper: Number(value), notes },
            })}
            onDone={() => {
              setItemName("");
              setNotes("");
            }}
          >
            <label>
              Item name
              <input
                required
                value={itemName}
                maxLength={160}
                onChange={(e) => setItemName(e.target.value)}
              />
            </label>
            <label>
              Quantity
              <input
                required
                type="number"
                min={1}
                max={100000}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </label>
            <label>
              Value per item (copper)
              <input
                required
                type="number"
                min={0}
                max={1e12}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <label>
              Item notes
              <textarea maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </CommandForm>
          <CommandForm
            label="Set NPC funds"
            dirty={funds !== String(toCopper(purse.coins))}
            submit={() => ({
              kind: "npc-funds",
              npcId: npc.id,
              before: toCopper(purse.coins),
              copper: Number(funds),
            })}
          >
            <p>Current funds: {formatCopper(toCopper(purse.coins))}</p>
            <label>
              Funds (copper)
              <input
                required
                type="number"
                min={0}
                max={1e12}
                value={funds}
                onChange={(e) => setFunds(e.target.value)}
              />
            </label>
          </CommandForm>
        </Fold>
      )}
      {npc.barterAllowed && near && (
        <AppLink className="settings-link" href="/features/trading">
          Propose a barter with {npc.name} →
        </AppLink>
      )}
      <h3 id="npc-messages" style={{ scrollMarginTop: "6rem" }}>
        Conversation
      </h3>
      <label>
        Speaking character
        <SearchSelect
          aria-label="Speaking character"
          value={character}
          onValueChange={(selectedValue) => setCharacter(selectedValue)}
        >
          {characters.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SearchSelect>
      </label>
      {conversation?.messages.map((m) => (
        <p key={m.id} className={`world-message${m.id.endsWith("-rumour") ? " svc-rumour" : ""}`}>
          <strong>
            {m.author === "npc" ? npc.name : table.purses.find((p) => p.id === character)?.name}
          </strong>
          {/* A rumour bought from an inn (docs/SERVICES.md) arrives as an NPC message. */}
          {m.id.endsWith("-rumour") && <span className="svc-flag review"> Rumour</span>}: {m.text}
          {m.id.endsWith("-rumour") && conversation && (
            <>
              {" "}
              <ShareRumour text={m.text} npcName={npc.name} purseId={conversation.purseId} />
            </>
          )}
        </p>
      ))}
      {near && character ? (
        <CommandForm
          label={asNpc ? "Send NPC response" : "Speak to NPC"}
          dirty={!!text}
          submit={() => ({ kind: "npc-message", npcId: npc.id, purseId: character, asNpc, text })}
          onDone={() => setText("")}
        >
          <label>
            Message
            <textarea
              required
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {controller && (
            <label>
              <input type="checkbox" checked={asNpc} onChange={(e) => setAsNpc(e.target.checked)} />
              Speak as {npc.name}
            </label>
          )}
        </CommandForm>
      ) : (
        <p>Visit this NPC's location to interact.</p>
      )}
    </section>
  );
}

/** Reuses the same dialogue/barter controls without the NPC directory. An NPC pin opens the
 * conversation hub (Barter, Shop, Services, Talk, Farewell) directly; NPCs a player controls keep
 * the existing interaction (Talk plus the Trading & Barter table). */
export function NpcMapService({ npcId, onFarewell }: { npcId: string; onFarewell?: () => void }) {
  const table = useWorldTable(),
    seat = useSeat();
  const npc = table.journal.world?.npcs.find((n) => n.id === npcId);
  if (!npc || (seat.role !== "dm" && !npcAvailableHere(npc, table, seatGroups(table, seat))))
    return <p>This NPC is unavailable here.</p>;
  if (!npcPinOpensHub(npc))
    return (
      <>
        <p>{npc.description}</p>
        <NpcInteraction key={npc.id} npc={npc} table={table} />
      </>
    );
  return (
    <>
      <NpcConversation key={npc.id} npc={npc} table={table} onFarewell={onFarewell} />
      <Fold title={`More about ${npc.name}`}>
        <p>{npc.description}</p>
        <NpcInteraction key={npc.id} npc={npc} table={table} showConversation={false} />
      </Fold>
    </>
  );
}
