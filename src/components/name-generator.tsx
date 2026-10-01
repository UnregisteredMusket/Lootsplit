import { useState } from "react";
import { toast } from "sonner";
import { Button, Select } from "./ui";
import { useEconomy } from "@/lib/quire/economy-context";
import { useSeat } from "@/lib/quire/seat";
import { LEXEME_KINDS } from "@/lib/quire/labels";
import { fantasyBatch, NAME_STYLES, type NameStyle } from "@/lib/quire/fantasy-names";
import type { LexemeKind } from "@/lib/quire/types";
export function NameGenerator() {
  const [kind, setKind] = useState<LexemeKind>("person"),
    [style, setStyle] = useState<NameStyle>("frontier");
  const [batch, setBatch] = useState<{
      kind: LexemeKind;
      style: NameStyle;
      names: string[];
    } | null>(null),
    [saving, setSaving] = useState("");
  const { addNames, lexicon } = useEconomy(),
    seat = useSeat();
  async function save(name: string) {
    if (!batch || saving) return;
    setSaving(name);
    try {
      const n = await addNames([
        {
          name,
          kind: batch.kind,
          bookId: "",
          notes: `Offline generator · ${NAME_STYLES.find((s) => s.value === batch.style)?.label}`,
        },
      ]);
      toast(n ? "Name saved." : "Already in your saved names.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save name.");
    } finally {
      setSaving("");
    }
  }
  async function copy(name: string) {
    try {
      await navigator.clipboard.writeText(name);
      toast.success("Name copied.");
    } catch {
      toast.error("Copy is unavailable. Select and copy the name instead.");
    }
  }
  return (
    <section className="mb-8 rounded-lg border border-border p-4">
      <p className="text-xs uppercase tracking-widest text-accent">Works offline</p>
      <h2 className="mt-2 font-display text-2xl">Find a name</h2>
      <p className="mt-2 text-sm text-muted">
        Original fantasy names for your world. Generate a handful, copy a favorite, or save it for
        future shops.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="text-sm">
          Name kind
          <Select value={kind} onChange={(e) => setKind(e.target.value as LexemeKind)}>
            {LEXEME_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          Style
          <Select value={style} onChange={(e) => setStyle(e.target.value as NameStyle)}>
            {NAME_STYLES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <Button
        className="mt-3 w-full"
        onClick={() => setBatch({ kind, style, names: fantasyBatch(kind, style) })}
      >
        Generate six names
      </Button>
      {batch ? (
        <div className="mt-4" aria-live="polite">
          <p className="text-xs text-muted">
            {LEXEME_KINDS.find((k) => k.value === batch.kind)?.label} ·{" "}
            {NAME_STYLES.find((s) => s.value === batch.style)?.label}
          </p>
          <ul className="mt-2 divide-y divide-border">
            {batch.names.map((name) => {
              const saved = lexicon.some(
                (n) => n.kind === batch.kind && n.name.toLowerCase() === name.toLowerCase(),
              );
              return (
                <li key={name} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <span className="min-w-0 break-words">{name}</span>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => void copy(name)}
                      aria-label={`Copy ${name}`}
                    >
                      Copy
                    </Button>
                    {seat.role === "dm" ? (
                      <Button
                        variant="secondary"
                        disabled={saved || !!saving}
                        onClick={() => void save(name)}
                        aria-label={`Save ${name}`}
                      >
                        {saved ? "Saved" : saving === name ? "Saving…" : "Save"}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
