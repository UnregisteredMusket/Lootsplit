import { SearchSelect } from "@/components/search-select";
import { useState } from "react";
import { z } from "zod";
import { Button } from "../ui";
import { AppLink } from "../app-link";
import { libraryRecordHref } from "@/lib/quire/library-records";
import { combatantSchema, generatorSchema, generateEncounter } from "@/lib/encounters/model.mjs";
import {
  missingCreatureFields,
  packKey,
  resourceCombatant,
  type ResourceLibrary,
} from "@/lib/quire/resource-packs";
export function ResourceCreatures({
  library,
  disabled,
  filters,
  onAdd,
}: {
  library?: ResourceLibrary;
  disabled: boolean;
  filters: z.infer<typeof generatorSchema>;
  onAdd: (creatures: z.infer<typeof combatantSchema>[]) => void;
}) {
  const [selected, setSelected] = useState(""),
    [selectedCreature, setSelectedCreature] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0),
    [error, setError] = useState("");
  const packs = (library?.packs ?? []).filter((p) => p.entries.some((e) => e.kind === "creature"));
  const active = packs.find((p) => packKey(p) === selected) ?? packs[0];
  const creatures =
    active?.entries.filter(
      (e) =>
        e.kind === "creature" &&
        `${e.name} ${e.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  return (
    <section
      className="space-y-3 border border-border rounded-sm p-3 my-3"
      aria-label="Imported creatures"
    >
      <h3>Imported campaign creatures</h3>
      {!active ? (
        <p className="text-sm text-muted">
          Add a reviewed resource pack in{" "}
          <AppLink href="/library#resource-packs">Library → Resource packs</AppLink> to reuse its
          creatures.
        </p>
      ) : (
        <>
          <label className="block">
            Creature resource pack
            <SearchSelect
              className="w-full"
              aria-label="Creature resource pack"
              value={packKey(active)}
              onValueChange={(selectedValue) => {
                setSelected(selectedValue);
                setSelectedCreature("");
                setQuery("");
                setPage(0);
                setError("");
              }}
            >
              {packs.map((p) => (
                <option key={packKey(p)} value={packKey(p)}>
                  {p.title} · {p.revision}
                </option>
              ))}
            </SearchSelect>
          </label>
          <label className="block">
            Find an imported monster
            <SearchSelect
              aria-label="Find an imported monster"
              value={selectedCreature}
              onValueChange={(value) => {
                setSelectedCreature(value);
                setQuery(active.entries.find((e) => e.id === value)?.name ?? "");
                setPage(0);
              }}
            >
              <option value="">All imported monsters</option>
              {active.entries
                .filter((e) => e.kind === "creature")
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </SearchSelect>
          </label>
          <label className="block">
            Search imported creatures
            <input
              className="ledger-search w-full"
              aria-label="Search imported creatures"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              setError("");
              try {
                const candidates = creatures
                  .filter(
                    (e) =>
                      e.kind === "creature" &&
                      !missingCreatureFields(e).length &&
                      (!filters.enemy ||
                        `${e.name} ${e.tags.join(" ")}`
                          .toLowerCase()
                          .includes(filters.enemy.toLowerCase())) &&
                      (!filters.environment ||
                        e.tags.some((t) =>
                          t.toLowerCase().includes(filters.environment.toLowerCase()),
                        )),
                  )
                  .map((e) => {
                    if (e.kind !== "creature") throw Error("Invalid creature.");
                    return resourceCombatant(active, e);
                  });
                onAdd(generateEncounter(candidates, filters));
              } catch (error) {
                setError(error instanceof Error ? error.message : "Could not generate enemies.");
              }
            }}
          >
            Generate from imported creatures
          </Button>
          <p className="text-sm text-muted">
            Uses the generation target above and the current pack filters. Each addition is an
            editable copy; traits, actions and source pages remain in its notes.
          </p>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          {creatures.slice(page * 20, (page + 1) * 20).map(
            (entry) =>
              entry.kind === "creature" && (
                <div className="encounter-index-row" key={entry.id}>
                  <div>
                    <strong>
                      <AppLink
                        href={libraryRecordHref("resource", active.id, active.revision, entry.id)}
                      >
                        {entry.name} →
                      </AppLink>
                    </strong>
                    <p>
                      CR {entry.stats.cr ?? "unknown"} · HP {entry.stats.hp ?? "unknown"} · AC{" "}
                      {entry.stats.ac ?? "unknown"}
                    </p>
                    <small>{entry.sources.map((s) => `PDF p. ${s.pdfPage}`).join(", ")}</small>
                    {missingCreatureFields(entry).length > 0 && (
                      <p className="text-sm text-danger">
                        Incomplete stats. Correct the JSON or add a custom enemy after reviewing the
                        source.
                      </p>
                    )}
                  </div>
                  <Button
                    disabled={disabled || missingCreatureFields(entry).length > 0}
                    onClick={() => {
                      setError("");
                      try {
                        onAdd([resourceCombatant(active, entry)]);
                      } catch (error) {
                        setError(
                          error instanceof Error ? error.message : "Could not add creature.",
                        );
                      }
                    }}
                  >
                    Add imported {entry.name}
                  </Button>
                </div>
              ),
          )}
          {!creatures.length && <p>No imported creatures match.</p>}
          {creatures.length > 20 && (
            <div className="flex justify-between gap-2">
              <Button variant="ghost" disabled={!page} onClick={() => setPage(page - 1)}>
                Previous imported creatures
              </Button>
              <span>
                {page + 1} / {Math.ceil(creatures.length / 20)}
              </span>
              <Button
                variant="ghost"
                disabled={(page + 1) * 20 >= creatures.length}
                onClick={() => setPage(page + 1)}
              >
                More imported creatures
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
