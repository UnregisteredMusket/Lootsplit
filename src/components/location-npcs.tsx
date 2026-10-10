import { CharacterPlacement } from "./character-placement";
import { characterLocation, characterPosition } from "@/lib/quire/character-position";
import { SearchSelect } from "@/components/search-select";
import { useEffect, useState } from "react";
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
  const npcs = world.npcs.filter((n) => dm || npcAvailableHere(n, t)),
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
                  <AppLink href={libraryRecordHref("npc", n.id)}>{n.name} <span aria-hidden="true">→</span></AppLink>
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
                  · {npcAvailableHere(n, t) ? "Nearby" : "Away / hidden"} ·{" "}
                  {n.barterAllowed ? "Bartering allowed" : "No bartering"}
                </p>
              </span>
              <Button onClick={() => setSelected(n.id)}>View & interact</Button>
              {dm && <Button onClick={() => setEdit(n)}>Configure NPC</Button>}
            </div>
            <p>{n.description}</p>
          </article>
        ))}
      {!npcs.length && <p>No NPCs are available at this location.</p>}
      {npc && (
        <>
          {dm && <CharacterPlacement npcId={npc.id} />}
          <NpcInteraction key={npc.id} npc={npc} table={t} />
        </>
      )}
      {edit !== undefined && dm && (
        <NpcEditor
          key={edit?.id ?? "new"}
          npc={edit ?? undefined}
          table={t}
          close={() => setEdit(undefined)}
        />
      )}
    </div>
  );
}
function NpcEditor({ npc, table, close }: { npc?: Npc; table: CloudTable; close: () => void }) {
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
    <section className="world-card">
      <h2>{npc ? "Configure NPC" : "New non-party NPC"}</h2>
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
          if (window.confirm("Close this unsaved NPC draft?")) close();
        }}
      >
        Close editor
      </Button>
    </section>
  );
}
function NpcInteraction({ npc, table }: { npc: Npc; table: CloudTable }) {
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
  const [character, setCharacter] = useState(characters[0]?.id ?? ""),
    [text, setText] = useState(""),
    [asNpc, setAsNpc] = useState(controller),
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
    near = npcAvailableHere(npc, table),
    purse = table.purses.find((p) => p.id === npc.id)!;
  return (
    <section className="world-card">
      <h2>{npc.name} · interaction</h2>
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
      <h3>Conversation</h3>
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
        <p key={m.id} className="world-message">
          <strong>
            {m.author === "npc" ? npc.name : table.purses.find((p) => p.id === character)?.name}
          </strong>
          : {m.text}
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
