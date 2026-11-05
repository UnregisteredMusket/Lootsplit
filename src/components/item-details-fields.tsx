/**
 * Award item details (item-details.ts): the optional charges, attunement requirement and
 * "award unidentified" record the DM can set while creating an item, in Add loot and in an
 * encounter's loot review. The fields are the holding's own (`uses`, `requiresAttunement`,
 * `unidentified`), with the same limits as Edit item and Identification.
 *
 * Controlled: `value` is always valid except an empty presented name, which the form's submit
 * check (`itemDetailsProblem`) refuses. Text fields commit when they hold a valid value and fall
 * back to the last valid one when left.
 */
import { useEffect, useState } from "react";
import { Field, Segmented, Switch, TextInput } from "./ui";
import { MAX_USES } from "@/lib/quire/item-uses";
import { formatCopper, parsePrice } from "@/lib/quire/money";
import type { ItemDetails } from "@/lib/quire/item-details";

const DEFAULT_REQUIREMENT = "Requires attunement";
const whole = (text: string, min: number, max: number) => {
  const n = Number(text);
  return text.trim() !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** A text box that commits valid text and shows the last valid value when left. */
function CommitText({
  label,
  shown,
  commit,
  hint,
  numeric,
  ariaLabel,
  maxLength,
}: {
  label: string;
  shown: string;
  commit: (text: string) => boolean;
  hint?: string;
  numeric?: boolean;
  ariaLabel: string;
  maxLength?: number;
}) {
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <Field label={label} hint={hint}>
      <TextInput
        aria-label={ariaLabel}
        value={text}
        maxLength={maxLength}
        inputMode={numeric ? "numeric" : undefined}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
        onBlur={() => setText(shown)}
      />
    </Field>
  );
}

export function ItemDetailsFields({
  value,
  onChange,
  itemName,
  identification = true,
}: {
  value: ItemDetails;
  onChange: (next: ItemDetails) => void;
  /** Names the controls for screen readers ("Maximum uses for Wand of sparks"). */
  itemName: string;
  /** False where the form already offers "Award unidentified" (the encounter loot row). */
  identification?: boolean;
}) {
  const set = (patch: Partial<ItemDetails>) => {
    const next: ItemDetails = { ...value, ...patch };
    for (const key of Object.keys(patch) as (keyof ItemDetails)[]) if (patch[key] === undefined) delete next[key];
    onChange(next);
  };
  const uses = value.uses;
  const u = value.unidentified;
  const name = itemName.trim() || "this item";
  return (
    <fieldset className="item-details-fields flex min-w-0 flex-col gap-2 rounded-sm border border-border p-3">
      <legend className="px-1 text-sm font-medium">Charges, attunement{identification ? " & identification" : ""}</legend>
      <Switch
        checked={!!uses}
        onChange={(on) => set({ uses: on ? { current: 1, max: 1, whenEmpty: "remove" } : undefined })}
        label="Track uses"
        hint="For wands, potions, scrolls and kits: Use spends one, Recharge refills."
      />
      {uses ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <CommitText
              label="Maximum uses"
              ariaLabel={`Maximum uses for ${name}`}
              numeric
              shown={String(uses.max)}
              hint={`1 to ${MAX_USES} each.`}
              commit={(text) => {
                const max = whole(text, 1, MAX_USES);
                // Starting full is the usual case: uses left follows the maximum until changed.
                if (max !== null) set({ uses: { ...uses, max, current: uses.current === uses.max ? max : Math.min(uses.current, max) } });
                return max !== null;
              }}
            />
            <CommitText
              label="Uses left"
              ariaLabel={`Uses left for ${name}`}
              numeric
              shown={String(uses.current)}
              hint={`0 to ${uses.max}.`}
              commit={(text) => {
                const current = whole(text, 0, uses.max);
                if (current !== null) set({ uses: { ...uses, current } });
                return current !== null;
              }}
            />
          </div>
          <Segmented
            label={`When the last use of ${name} is spent`}
            value={uses.whenEmpty}
            onChange={(whenEmpty) => set({ uses: { ...uses, whenEmpty } })}
            options={[
              { value: "remove", label: "Remove the item" },
              { value: "keep", label: "Keep it at 0" },
            ]}
          />
        </>
      ) : null}
      <Switch
        checked={value.requiresAttunement !== undefined}
        onChange={(on) => set({ requiresAttunement: on ? DEFAULT_REQUIREMENT : undefined })}
        label="Requires attunement"
        hint="Its character can then attune to it (3 items each unless you change the limit)."
      />
      {value.requiresAttunement !== undefined ? (
        <CommitText
          label="Attunement requirement"
          ariaLabel={`Attunement requirement for ${name}`}
          maxLength={200}
          hint="For example: Requires attunement: by a wizard."
          shown={value.requiresAttunement}
          commit={(text) => {
            const ok = text.trim().length > 0;
            if (ok) set({ requiresAttunement: text.trim() });
            return ok;
          }}
        />
      ) : null}
      {identification ? (
        <>
          <Switch
            checked={!!u}
            onChange={(on) => set({ unidentified: on ? { name: "Unidentified item" } : undefined })}
            label="Award unidentified"
            hint="Players see the name, description and value you give here until you identify it."
          />
          {u ? (
            <>
              <CommitText
                label="Name players see"
                ariaLabel={`Name players see for ${name}`}
                maxLength={160}
                shown={u.name}
                commit={(text) => {
                  const ok = text.trim().length > 0;
                  if (ok) set({ unidentified: { ...u, name: text.trim() } });
                  return ok;
                }}
              />
              <label className="text-sm">
                Description players see
                <textarea
                  aria-label={`Description players see for ${name}`}
                  className="mt-1 min-h-20 w-full rounded-sm border border-border bg-subtle p-3 text-fg"
                  maxLength={4000}
                  value={u.description ?? ""}
                  onChange={(e) => {
                    const { description: _d, ...rest } = u;
                    set({ unidentified: e.target.value ? { ...rest, description: e.target.value } : rest });
                  }}
                />
              </label>
              <CommitText
                label="Value players see"
                ariaLabel={`Value players see for ${name}`}
                hint="Each, for example 25 gp. Empty: unknown value (it can't be sold)."
                shown={u.value === undefined ? "" : formatCopper(u.value)}
                commit={(text) => {
                  const { value: _v, ...rest } = u;
                  if (!text.trim()) {
                    set({ unidentified: rest });
                    return true;
                  }
                  const copper = parsePrice(text);
                  if (copper !== null) set({ unidentified: { ...rest, value: copper } });
                  return copper !== null;
                }}
              />
            </>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
