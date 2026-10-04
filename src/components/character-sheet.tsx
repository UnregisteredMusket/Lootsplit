import { Link } from "@tanstack/react-router";
import { characterSheet } from "@/lib/characters/campaign-sheet.mjs";
import { getCloudTable } from "@/lib/quire/cloud-client";
import { useEconomy } from "@/lib/quire/economy-context";
import { formatCoins, toCopper } from "@/lib/quire/money";
import { useSeat } from "@/lib/quire/seat";
import { showMod, type AbilityKey, type CharacterSheet } from "@/lib/quire/sheet";
import { Fold } from "@/components/ui";

const ABILITIES: { key: AbilityKey; label: string }[] = [
  { key: "str", label: "STR" },
  { key: "dex", label: "DEX" },
  { key: "con", label: "CON" },
  { key: "int", label: "INT" },
  { key: "wis", label: "WIS" },
  { key: "cha", label: "CHA" },
];

export function CharacterSheetPanel({ purseId, face = true }: { purseId: string; face?: boolean }) {
  const { sheets, purses, holdings, importSheet, updateSheet } = useEconomy();
  const seat = useSeat();
  const original = sheets.find((item) => item.purseId === purseId);
  const p = purses.find((p) => p.id === purseId);
  const current = p ? characterSheet(p, holdings, original) : null;
  const sheet =
    original && current
      ? {
          ...original,
          name: current.name,
          race: current.species,
          classLevel: current.classes,
          hitPoints: `${current.hp} / ${current.maxHp}`,
          armorClass: String(current.ac),
          speed: current.speed,
          coins: current.coins,
          abilities: Object.fromEntries(
            Object.entries(current.scores).map(([key, score]) => [
              key,
              { score: String(score), modifier: "" },
            ]),
          ) as CharacterSheet["abilities"],
          equipment: current.equipment.map((i) => `${i.name} × ${i.quantity}`).join("\n"),
        }
      : original;
  const readOnly = seat.role === "dm" ? !!p?.sheetReadOnlyForDm : p?.editingAllowed !== true;
  const canImport =
    !readOnly &&
    (seat.role === "dm" || (!getCloudTable().joined && seat.purseIds.includes(purseId)));

  return (
    <div className="mt-4">
      <Link
        to="/characters"
        search={{ id: `party:${purseId}` }}
        className="inline-flex min-h-11 items-center text-sm underline"
      >
        Open character sheet
      </Link>
      {canImport ? (
        <label className="inline-flex min-h-11 cursor-pointer items-center text-sm underline">
          Import a D&D 5e (2014) character sheet
          <input
            type="file"
            accept="application/pdf,application/json,.pdf,.json"
            className="sr-only"
            aria-label="Import a 2014 character sheet"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importSheet(purseId, file);
            }}
          />
        </label>
      ) : null}
      {face && sheet ? <SheetView sheet={sheet} /> : null}
      {sheet ? (
        <BlankFields
          disabled={readOnly}
          sheet={sheet}
          onSave={(next) => void updateSheet(next, sheet)}
        />
      ) : null}
      {!sheet && canImport ? (
        <p className="mt-2 text-sm text-muted">
          A filled PDF or a JSON export. A scan without selectable text cannot be read.
        </p>
      ) : null}
    </div>
  );
}

export function SheetBody({ sheet }: { sheet: CharacterSheet }) {
  const facts = [
    ["Background", sheet.background],
    ["Alignment", sheet.alignment],
    ["Experience", sheet.experience],
    ["Armor class", sheet.armorClass],
    ["Initiative", showMod(sheet.initiative)],
    ["Speed", sheet.speed],
    ["Hit points", sheet.hitPoints],
    ["Hit dice", sheet.hitDice],
    ["Proficiency", showMod(sheet.proficiency)],
    ["Passive Perception", sheet.passivePerception],
  ].filter((row) => row[1]);
  const saves = ABILITIES.filter((ability) => sheet.saves[ability.key]);
  const coins = toCopper(sheet.coins) > 0 ? formatCoins(sheet.coins) : "";

  return (
    <div>
      <div className="grid grid-cols-6 gap-1 text-center">
        {ABILITIES.map((ability) => {
          const row = sheet.abilities[ability.key];
          return (
            <div key={ability.key} className="rounded-sm border border-border px-1 py-2">
              <p className="text-[10px] tracking-wide text-muted">{ability.label}</p>
              <p className="font-display text-lg leading-tight">{row.score || "–"}</p>
              <p className="text-xs tabular-nums text-muted">
                {showMod(row.modifier, row.score) || ""}
              </p>
            </div>
          );
        })}
      </div>
      {facts.length > 0 ? (
        <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {facts.map(([label, value]) => (
            <li key={label} className="min-w-0">
              <span className="text-muted">{label}</span>
              <span className="mt-0.5 block">{value}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {saves.length > 0 ? (
        <Line
          label="Saves"
          value={saves
            .map((ability) => `${ability.label} ${showMod(sheet.saves[ability.key])}`)
            .join(" · ")}
        />
      ) : null}
      {sheet.skills.length > 0 ? (
        <Line
          label="Skills"
          value={sheet.skills.map((skill) => `${skill.name} ${showMod(skill.bonus)}`).join(", ")}
        />
      ) : null}
      {coins ? <Line label="Coins on the sheet" value={coins} /> : null}
      <Block label="Traits" value={sheet.traits} />
      <Block label="Ideals" value={sheet.ideals} />
      <Block label="Bonds" value={sheet.bonds} />
      <Block label="Flaws" value={sheet.flaws} />
      <Block label="Features" value={sheet.features} />
      <Block label="Proficiencies" value={sheet.proficiencies} />
      <Block label="Attacks" value={sheet.attacks} />
      <Block label="Equipment" value={sheet.equipment} />
      <Block label="Spells" value={sheet.spells} />
    </div>
  );
}

function BlankFields({
  disabled,
  sheet,
  onSave,
}: {
  disabled?: boolean;
  sheet: CharacterSheet;
  onSave: (sheet: CharacterSheet) => void;
}) {
  const fields: Array<{ label: string; value: string; set: (value: string) => CharacterSheet }> = [
    { label: "Name", value: sheet.name, set: (value) => ({ ...sheet, name: value }) },
    { label: "Class", value: sheet.classLevel, set: (value) => ({ ...sheet, classLevel: value }) },
    { label: "Race", value: sheet.race, set: (value) => ({ ...sheet, race: value }) },
    {
      label: "Armor class",
      value: sheet.armorClass,
      set: (value) => ({ ...sheet, armorClass: value }),
    },
    {
      label: "Hit points",
      value: sheet.hitPoints,
      set: (value) => ({ ...sheet, hitPoints: value }),
    },
  ];
  const abilities: Array<{ key: AbilityKey; label: string }> = [
    { key: "str", label: "Strength" },
    { key: "dex", label: "Dexterity" },
    { key: "con", label: "Constitution" },
    { key: "int", label: "Intelligence" },
    { key: "wis", label: "Wisdom" },
    { key: "cha", label: "Charisma" },
  ];
  const blanks = [
    ...fields.filter((field) => !field.value.trim()),
    ...abilities
      .filter((ability) => !sheet.abilities[ability.key].score.trim())
      .map((ability) => ({
        label: ability.label,
        value: "",
        set: (value: string) => ({
          ...sheet,
          abilities: { ...sheet.abilities, [ability.key]: { score: value, modifier: "" } },
        }),
      })),
  ];
  if (blanks.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-sm text-muted">
        Still blank: {blanks.map((field) => field.label).join(", ")}.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {blanks.map((field) => (
          <label key={field.label} className="text-xs text-muted">
            {field.label}
            <input
              aria-label={field.label}
              defaultValue=""
              disabled={disabled}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value) onSave(field.set(value));
              }}
              className="mt-1 min-h-11 w-full rounded-sm border border-border bg-transparent px-2 text-base text-fg"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function SheetView({ sheet }: { sheet: CharacterSheet }) {
  const hint = [sheet.classLevel, sheet.race].filter(Boolean).join(" · ") || "2014";
  return (
    <div className="mt-3">
      <Fold title="2014 character sheet" hint={hint}>
        <SheetBody sheet={sheet} />
      </Fold>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <p className="mt-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="mt-0.5 block">{value}</span>
    </p>
  );
}

function Block({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="mt-3">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-sm">{value}</p>
    </div>
  );
}
